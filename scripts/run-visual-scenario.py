#!/usr/bin/env python3
"""Validate and compare an exact-geometry source/native scenario capture."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image, ImageOps


def canonical(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load_manifest(path: Path) -> dict[str, Any]:
    data = json.loads(path.read_text())
    if data.get("schemaVersion") != 1:
        raise ValueError("unsupported scenario schema")
    scenarios = data.get("scenarios")
    if not isinstance(scenarios, list) or len(scenarios) != 11:
        raise ValueError("manifest must contain exactly 11 scenarios")
    ids = [item.get("id") for item in scenarios]
    if len(set(ids)) != 11 or ids != sorted(ids):
        raise ValueError("scenario IDs must be unique and ordered")
    defaults = data["captureDefaults"]
    if defaults.get("resizePolicy") != "reject":
        raise ValueError("capture resizing must be rejected")
    for item in scenarios:
        if not item.get("regions") or not item.get("postconditions"):
            raise ValueError(f"{item.get('id')}: regions and postconditions are required")
    return data


def select_scenario(manifest: dict[str, Any], scenario_id: str) -> dict[str, Any]:
    for scenario in manifest["scenarios"]:
        if scenario["id"] == scenario_id:
            return scenario
    raise ValueError(f"unknown scenario: {scenario_id}")


def effective_capture(manifest: dict[str, Any], scenario: dict[str, Any]) -> dict[str, Any]:
    result = dict(manifest["captureDefaults"])
    result.update(scenario.get("capture", {}))
    return result


def read_image(path: Path, expected: dict[str, Any]) -> np.ndarray:
    with Image.open(path) as source:
        image = ImageOps.exif_transpose(source).convert("RGB")
    required = (expected["pixelWidth"], expected["pixelHeight"])
    if image.size != required:
        raise ValueError(f"{path}: expected exact pixels {required}, got {image.size}")
    return np.asarray(image, dtype=np.float64)


def lookup(value: Any, path: str) -> Any:
    current = value
    for component in path.split("."):
        if not isinstance(current, dict) or component not in current:
            raise ValueError(f"semantic path missing: {path}")
        current = current[component]
    return current


def validate_metadata(meta: dict[str, Any], expected: dict[str, Any], manifest: dict[str, Any], lane: str) -> None:
    keys = ("logicalWidth", "logicalHeight", "pixelWidth", "pixelHeight", "deviceScaleFactor", "boundary")
    for key in keys:
        if meta.get(key) != expected.get(key):
            raise ValueError(f"capture metadata mismatch for {key}")
    if meta.get("clock") != manifest["clock"] or meta.get("route") != manifest["route"]:
        raise ValueError("capture clock/route does not match manifest")
    if meta.get("lane") != lane or not meta.get("captureMethod") or not meta.get("osBuild"):
        raise ValueError("capture provenance is incomplete")
    revision = meta.get("revision", "")
    if len(revision) != 40 or any(character not in "0123456789abcdef" for character in revision):
        raise ValueError("capture revision must be a full Git commit")
    if lane == "source" and revision != manifest["source"]["revision"]:
        raise ValueError("source capture revision does not match manifest")


def metrics(reference: np.ndarray, candidate: np.ndarray, threshold: int) -> dict[str, Any]:
    delta = np.abs(reference - candidate)
    mse = float(np.square(reference - candidate).mean())
    rmse = math.sqrt(mse)
    return {
        "differentPixelPercent": round(float((delta.max(axis=2) > threshold).mean() * 100), 6),
        "maximumChannelDelta": int(delta.max()),
        "meanAbsoluteError": round(float(delta.mean()), 6),
        "peakSignalToNoiseRatioDb": "infinity" if mse == 0 else round(20 * math.log10(255 / rmse), 6),
        "rootMeanSquareError": round(rmse, 6),
    }


def source_bootstrap(manifest: dict[str, Any]) -> dict[str, Any]:
    bootstrap = manifest["sourceBootstrap"]
    return {
        "cdpEndpoint": manifest["source"]["cdpEndpoint"],
        "addScriptToEvaluateOnNewDocument": {
            "clock": manifest["clock"],
            "localStorage": bootstrap["localStorage"],
            "disableAnimations": bootstrap["disableAnimations"],
        },
        "navigate": manifest["route"],
        "ready": {
            "fonts": bootstrap["waitForFonts"],
            "animationFrames": bootstrap["animationFramesAfterReady"],
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--scenario", required=True)
    parser.add_argument("--emit-source-plan", action="store_true")
    parser.add_argument("--reference", type=Path)
    parser.add_argument("--candidate", type=Path)
    parser.add_argument("--reference-meta", type=Path)
    parser.add_argument("--candidate-meta", type=Path)
    parser.add_argument("--reference-semantics", type=Path)
    parser.add_argument("--candidate-semantics", type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--threshold", type=int, default=16)
    args = parser.parse_args()

    manifest = load_manifest(args.manifest)
    scenario = select_scenario(manifest, args.scenario)
    if args.emit_source_plan:
        print(json.dumps(source_bootstrap(manifest), indent=2, sort_keys=True))
        return 0
    required = (args.reference, args.candidate, args.reference_meta, args.candidate_meta,
                args.reference_semantics, args.candidate_semantics, args.output)
    if any(value is None for value in required):
        parser.error("comparison mode requires both images, metadata, semantics, and output")

    expected = effective_capture(manifest, scenario)
    reference_meta = json.loads(args.reference_meta.read_text())
    candidate_meta = json.loads(args.candidate_meta.read_text())
    validate_metadata(reference_meta, expected, manifest, "source")
    validate_metadata(candidate_meta, expected, manifest, "native")
    reference_semantics = json.loads(args.reference_semantics.read_text())
    candidate_semantics = json.loads(args.candidate_semantics.read_text())
    for condition in scenario["postconditions"]:
        expected_value = condition["equals"]
        if lookup(reference_semantics, condition["path"]) != expected_value:
            raise ValueError(f"reference postcondition failed: {condition['path']}")
        if lookup(candidate_semantics, condition["path"]) != expected_value:
            raise ValueError(f"candidate postcondition failed: {condition['path']}")

    reference = read_image(args.reference, expected)
    candidate = read_image(args.candidate, expected)
    scale = expected["deviceScaleFactor"]
    region_results = {}
    for region in scenario["regions"]:
        x, y = int(region["x"] * scale), int(region["y"] * scale)
        width, height = int(region["width"] * scale), int(region["height"] * scale)
        if x < 0 or y < 0 or x + width > reference.shape[1] or y + height > reference.shape[0]:
            raise ValueError(f"region outside capture: {region['id']}")
        region_results[region["id"]] = metrics(
            reference[y:y + height, x:x + width],
            candidate[y:y + height, x:x + width], args.threshold)

    result = {
        "schemaVersion": 1,
        "scenario": scenario["id"],
        "manifestSha256": digest(args.manifest),
        "capture": expected,
        "inputs": {"referenceSha256": digest(args.reference), "candidateSha256": digest(args.candidate)},
        "fullMetrics": metrics(reference, candidate, args.threshold),
        "regionMetrics": region_results,
        "semanticPostconditions": scenario["postconditions"],
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n")
    print(args.output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
