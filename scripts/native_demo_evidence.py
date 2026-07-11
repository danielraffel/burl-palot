#!/usr/bin/env python3
"""Collect and validate fail-closed evidence for the native Burl Palot demo."""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
import pathlib
import plistlib
import subprocess
import sys
import tempfile
import time

FORBIDDEN = ("electron", "chromium", "chrome framework", "webkit", "webview")
REQUIRED_KINDS = {
    "build", "launch", "screenshot", "trace", "benchmark", "accessibility",
    "security", "opencode_integration", "architecture_review", "adversarial_review",
}
REQUIRED_ACCESSIBILITY_LABELS = {"Palot chat workspace", "Project folder", "Message composer"}


def sha256(path: pathlib.Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def audit_bundle(app: pathlib.Path) -> dict:
    if app.suffix != ".app" or not app.is_dir():
        raise ValueError(f"not a macOS app bundle: {app}")
    plist_path = app / "Contents/Info.plist"
    with plist_path.open("rb") as stream:
        plist = plistlib.load(stream)
    executable = app / "Contents/MacOS" / plist["CFBundleExecutable"]
    if not executable.is_file():
        raise ValueError(f"bundle executable missing: {executable}")
    names = [str(path.relative_to(app)) for path in app.rglob("*")]
    linked = subprocess.run(
        ["otool", "-L", str(executable)], check=True, text=True,
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
    ).stdout.splitlines()
    haystack = "\n".join(names + linked).lower()
    leaked = sorted(token for token in FORBIDDEN if token in haystack)
    if leaked:
        raise ValueError("forbidden browser runtime found: " + ", ".join(leaked))
    return {"status": "pass", "bundle": app.name, "executable": executable.name,
            "file_count": len(names), "linked_libraries": linked[1:]}


def launch_probe(app: pathlib.Path, seconds: float) -> dict:
    executable_name = plistlib.loads((app / "Contents/Info.plist").read_bytes())["CFBundleExecutable"]
    executable = app / "Contents/MacOS" / executable_name
    process = subprocess.Popen([str(executable)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    started = time.monotonic()
    try:
        time.sleep(seconds)
        if process.poll() is not None:
            raise ValueError(f"application exited early with status {process.returncode}")
        os.kill(process.pid, 0)
        with tempfile.NamedTemporaryFile() as sample:
            subprocess.run(["sample", str(process.pid), "1", "1", "-file", sample.name],
                           check=True, timeout=10, stdout=subprocess.DEVNULL,
                           stderr=subprocess.PIPE)
            sampled_bytes = pathlib.Path(sample.name).stat().st_size
        if sampled_bytes == 0:
            raise ValueError("process sample was empty")
        return {"status": "pass", "pid": process.pid,
                "responsive_window_seconds": round(time.monotonic() - started, 3),
                "process_sample_bytes": sampled_bytes}
    finally:
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=5)


def validate_accessibility(path: pathlib.Path) -> dict:
    data = json.loads(path.read_text(encoding="utf-8"))
    nodes = data.get("nodes")
    if not isinstance(nodes, list):
        raise ValueError("accessibility dump must contain a nodes array")
    labels = {node.get("label") for node in nodes if isinstance(node, dict)}
    missing = sorted(REQUIRED_ACCESSIBILITY_LABELS - labels)
    transcript = [node for node in nodes if isinstance(node, dict) and node.get("kind") == "message"]
    if missing or not transcript:
        raise ValueError(f"accessibility dump incomplete; missing={missing}, messages={len(transcript)}")
    if any(not node.get("label") or not node.get("role") for node in transcript):
        raise ValueError("every transcript message needs a role and label")
    return {"status": "pass", "required_labels": sorted(REQUIRED_ACCESSIBILITY_LABELS),
            "message_nodes": len(transcript)}


def validate_json_evidence(path: pathlib.Path, kind: str) -> dict:
    data = json.loads(path.read_text(encoding="utf-8"))
    if data.get("status") != "pass":
        raise ValueError(f"{kind} evidence does not report pass")
    if kind == "opencode_integration":
        required = {"project", "session_id", "prompt", "stream_chunks", "response"}
        missing = sorted(required - data.keys())
        if missing or not data.get("stream_chunks") or not data.get("response"):
            raise ValueError(f"real-chat evidence incomplete: {missing}")
    if kind == "persistence" and not all(data.get(key) for key in ("multiline", "tabs", "truncated_recovery")):
        raise ValueError("persistence evidence must prove multiline, tabs, and truncated recovery")
    return data


def copy_artifact(source: pathlib.Path, destination: pathlib.Path) -> pathlib.Path:
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(source.read_bytes())
    return destination


def collect(args: argparse.Namespace) -> pathlib.Path:
    out = args.output.resolve()
    out.mkdir(parents=True, exist_ok=True)
    app = args.app.resolve()
    if not (len(args.commit) == len(args.dependency_lock) == 40
            and all(char in "0123456789abcdef" for char in args.commit + args.dependency_lock)):
        raise ValueError("commit and dependency lock must be full lowercase Git object IDs")
    if not args.repository.startswith("https://"):
        raise ValueError("repository must be an https URL")
    persistence = validate_json_evidence(args.persistence, "persistence")
    security = audit_bundle(app)
    security["persistence_sha256"] = sha256(args.persistence)
    generated = {
        "security": ("security.json", security),
        "launch": ("launch.json", launch_probe(app, args.launch_seconds)),
        "accessibility": ("accessibility-validation.json", validate_accessibility(args.accessibility)),
        "build": ("build.json", validate_json_evidence(args.build, "build")),
    }
    artifacts: list[dict] = []
    for kind, (name, data) in generated.items():
        path = out / name
        path.write_text(json.dumps(data, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        artifacts.append(entry(kind, path, out))
    supplied = {
        "screenshot": args.screenshot, "trace": args.trace, "benchmark": args.benchmark,
        "opencode_integration": args.chat, "architecture_review": args.architecture_review,
        "adversarial_review": args.adversarial_review,
    }
    validate_json_evidence(args.trace, "trace")
    validate_json_evidence(args.benchmark, "benchmark")
    validate_json_evidence(args.chat, "opencode_integration")
    if args.screenshot.stat().st_size == 0 or args.screenshot.suffix.lower() not in {".png", ".jpg", ".jpeg"}:
        raise ValueError("screenshot must be a nonempty PNG or JPEG")
    for review in (args.architecture_review, args.adversarial_review):
        if review.stat().st_size < 20:
            raise ValueError(f"review artifact is empty or incomplete: {review}")
    copy_artifact(args.persistence, out / "persistence.json")
    for kind, source in supplied.items():
        target = copy_artifact(source, out / (kind + source.suffix.lower()))
        artifacts.append(entry(kind, target, out))
    manifest = {
        "schema_version": 1,
        "run_id": args.run_id,
        "created_at": dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z"),
        "source": {"repository": args.repository, "commit": args.commit,
                   "dependency_lock": args.dependency_lock},
        "artifacts": artifacts,
    }
    errors = validate_manifest(manifest, out)
    if errors:
        raise ValueError("; ".join(errors))
    path = out / "evidence-manifest.json"
    path.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return path


def entry(kind: str, path: pathlib.Path, root: pathlib.Path) -> dict:
    return {"kind": kind, "path": path.relative_to(root).as_posix(), "sha256": sha256(path), "status": "pass"}


def validate_manifest(data: dict, root: pathlib.Path) -> list[str]:
    errors: list[str] = []
    kinds = {item.get("kind") for item in data.get("artifacts", [])}
    if kinds != REQUIRED_KINDS:
        errors.append("artifact kinds mismatch: missing=" + ",".join(sorted(REQUIRED_KINDS - kinds)))
    for item in data.get("artifacts", []):
        relative = pathlib.PurePosixPath(item.get("path", ""))
        if relative.is_absolute() or ".." in relative.parts:
            errors.append(f"unsafe artifact path: {relative}")
            continue
        path = root / relative
        if not path.is_file() or item.get("sha256") != sha256(path):
            errors.append(f"missing or digest-mismatched artifact: {relative}")
    return errors


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(description=__doc__)
    result.add_argument("--app", required=True, type=pathlib.Path)
    result.add_argument("--output", required=True, type=pathlib.Path)
    result.add_argument("--run-id", required=True)
    result.add_argument("--repository", required=True)
    result.add_argument("--commit", required=True)
    result.add_argument("--dependency-lock", required=True)
    result.add_argument("--launch-seconds", type=float, default=5.0)
    for name in ("accessibility", "build", "screenshot", "trace", "benchmark", "chat",
                 "persistence", "architecture-review", "adversarial-review"):
        result.add_argument("--" + name, required=True, type=pathlib.Path,
                            dest=name.replace("-", "_"))
    return result


def main() -> int:
    try:
        print(collect(parser().parse_args()))
        return 0
    except (OSError, ValueError, KeyError, subprocess.SubprocessError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
