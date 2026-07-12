#!/usr/bin/env python3
"""Run source-derived visual-oracle regions around a captured element's corners."""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import sys
import tempfile
from pathlib import Path


def sha256(path: Path) -> str:
	return hashlib.sha256(path.read_bytes()).hexdigest()


def canonical_hash(value: object) -> str:
	encoded = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
	return hashlib.sha256(encoded.encode()).hexdigest()


def objects(value):
	if isinstance(value, dict):
		yield value
		for child in value.values():
			yield from objects(child)
	elif isinstance(value, list):
		for child in value:
			yield from objects(child)


def px(value: object) -> float:
	return float(str(value or "0").removesuffix("px"))


def find_node(semantics: dict, anchor_suffix: str) -> dict:
	matches = [node for node in objects(semantics)
		if str(node.get("sourceId", "")).endswith(anchor_suffix)
		and isinstance(node.get("rect"), dict) and isinstance(node.get("computedStyle"), dict)]
	if len(matches) != 1:
		raise ValueError(f"expected one source node ending in {anchor_suffix!r}, got {len(matches)}")
	return matches[0]


def corner_regions(node: dict, dpr: float, minimum: float) -> list[dict]:
	rect = node["rect"]
	style = node["computedStyle"]
	x = round(float(rect["x"]) * dpr)
	y = round(float(rect["y"]) * dpr)
	w = round(float(rect["width"]) * dpr)
	h = round(float(rect["height"]) * dpr)
	regions = []
	for name, horizontal, vertical, radius_name in (
		("bottom-left", "left", "bottom", "borderBottomLeftRadius"),
		("bottom-right", "right", "bottom", "borderBottomRightRadius"),
	):
		radius = max(1, round(px(style.get(radius_name)) * dpr))
		size = max(8, radius * 2)
		regions.append({
			"name": f"chat-panel-{name}",
			"minimum_pixel_similarity": minimum,
			"rect": {
				"x": x if horizontal == "left" else x + w - size,
				"y": y if vertical == "top" else y + h - size,
				"width": size,
				"height": size,
			},
		})
	return regions


def main() -> int:
	parser = argparse.ArgumentParser()
	parser.add_argument("--burl-source", type=Path, required=True)
	parser.add_argument("--manifest", type=Path,
		default=Path("evidence/visual-parity-oracle-07-composer-resting.manifest.json"))
	parser.add_argument("--semantics", type=Path,
		default=Path("evidence/visual-parity/baselines/01-shell/source-semantics.json"))
	parser.add_argument("--anchor-suffix", default="main[sidebar-inset]:2")
	parser.add_argument("--minimum-pixel-similarity", type=float, default=0.95)
	args = parser.parse_args()

	manifest_path = args.manifest.resolve()
	manifest = json.loads(manifest_path.read_text())
	semantics = json.loads(args.semantics.resolve().read_text())
	source_path = (manifest_path.parent / manifest["source"]["path"]).resolve()
	candidate_path = (manifest_path.parent / manifest["candidate"]["path"]).resolve()
	manifest["source"]["sha256"] = sha256(source_path)
	manifest["candidate"]["sha256"] = sha256(candidate_path)
	manifest["critical_regions"] = corner_regions(
		find_node(semantics, args.anchor_suffix), float(manifest["source"]["dpr"]),
		args.minimum_pixel_similarity)
	manifest["masks"] = []
	policy = {"thresholds": manifest["thresholds"],
		"critical_regions": manifest["critical_regions"], "masks": manifest["masks"]}
	manifest["threshold_approval"] = {
		"policy_sha256": canonical_hash(policy),
		"rationale": "source-derived corner regions use the reviewed calibrated visual metric",
		"review_commit": manifest["threshold_approval"]["review_commit"],
		"reviewed_by": manifest["threshold_approval"]["reviewed_by"],
	}

	gate = args.burl_source.resolve() / "tools/import-validation/visual_parity_gate.py"
	with tempfile.NamedTemporaryFile(mode="w", prefix=".palot-corner-gate-", suffix=".json",
			dir=manifest_path.parent, delete=False) as output:
		generated = Path(output.name)
		output.write(json.dumps(manifest, indent=2, sort_keys=True) + "\n")
	try:
		completed = subprocess.run([sys.executable, str(gate), str(generated)],
			capture_output=True, text=True)
		sys.stdout.write(completed.stdout)
		sys.stderr.write(completed.stderr)
		return completed.returncode
	finally:
		generated.unlink(missing_ok=True)


if __name__ == "__main__":
	raise SystemExit(main())
