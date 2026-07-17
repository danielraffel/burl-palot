#!/usr/bin/env python3
"""Run capability coverage, state evidence, then Burl visual gates for all 11 passes."""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import sys
from pathlib import Path

REQUIRED_BEHAVIOR_CLASSES = {
	"accessibility", "active/pressed", "cancellation", "clipboard", "disabled",
	"focus-visible", "hover", "ime-composition", "keyboard-navigation",
	"loading/streaming", "persistence", "responsive-layout", "retry",
	"scroll-anchor", "selection",
}


def file_hash(path: Path) -> str:
	return hashlib.sha256(path.read_bytes()).hexdigest()


CONTEXT_PROPERTIES = {"alignContent": ("display",), "alignItems": ("display",)}
SIDE_COLOR_WIDTH = {"borderBottomColor": "borderBottomWidth"}


def computed_property_values(path: Path) -> dict[str, set[tuple[str, tuple[tuple[str, str], ...]]]]:
	payload = json.loads(path.read_text())
	result: dict[str, set[tuple[str, tuple[tuple[str, str], ...]]]] = {}
	def walk(value, parent_style=None):
		if isinstance(value, dict):
			style = value.get("computedStyle")
			if isinstance(style, dict):
				for name, observed in style.items():
					if name in SIDE_COLOR_WIDTH:
						context = (("width", str(style.get(SIDE_COLOR_WIDTH[name], ""))),)
					elif name == "alignSelf":
						context = tuple((field, str((parent_style or {}).get(source, "")))
							for field, source in (
								("parentAlignItems", "alignItems"), ("parentDisplay", "display"),
							))
					else:
						context = tuple((field, str(style.get(field, "")))
							for field in CONTEXT_PROPERTIES.get(name, ()))
					result.setdefault(name, set()).add((str(observed), context))
			for key, child in value.items():
				if key == "children" and isinstance(child, list):
					for descendant in child:
						walk(descendant, style if isinstance(style, dict) else parent_style)
				elif key != "children":
					walk(child, parent_style)
		elif isinstance(value, list):
			for child in value:
				walk(child, parent_style)
	walk(payload)
	return result


def resolve_evidence(burl_source: Path, evidence_id: str, route: str,
	registry: dict) -> str | None:
	record = registry.get(evidence_id)
	if not isinstance(record, dict):
		return f"unknown evidence ID {evidence_id}"
	if record.get("route") != route:
		return f"evidence route mismatch for {evidence_id}"
	if record.get("repository") not in {"burl", "burl-palot"}:
		return f"evidence repository mismatch for {evidence_id}"
	for field in ("owner", "endpoint", "path", "command"):
		if not isinstance(record.get(field), str) or not record[field]:
			return f"malformed evidence ownership for {evidence_id}"
	source_root = Path(record.get("_source_root", burl_source)).resolve()
	artifact = (source_root / record["path"]).resolve()
	try:
		artifact.relative_to(source_root)
	except ValueError:
		return f"evidence path escapes repository for {evidence_id}"
	if not artifact.exists():
		return f"evidence artifact is missing for {evidence_id}"
	return None


def coverage_failure(root: Path, coverage_path: Path, burl_source: Path) -> str | None:
	coverage = json.loads(coverage_path.read_text())
	if coverage.get("schema") != "palot-capability-coverage-v1":
		return "capability coverage schema is invalid"
	semantics = root / coverage["sourceSemantics"]
	if not semantics.is_file() or file_hash(semantics) != coverage.get("sourceSemanticsSha256"):
		return "capability source semantics hash is stale"
	scenarios = root / coverage["scenarioManifest"]
	if not scenarios.is_file() or file_hash(scenarios) != coverage.get("scenarioManifestSha256"):
		return "capability behavior manifest hash is stale"
	actual = computed_property_values(semantics)
	records = coverage.get("computedProperties", [])
	declared = {record.get("name") for record in records if isinstance(record, dict)}
	if set(actual) != declared:
		missing = sorted(set(actual) - declared)
		extra = sorted(declared - set(actual))
		return f"capability closure mismatch: missing={missing} extra={extra}"
	registry_path = burl_source / "tools/import-design/catalogs/compat-evidence-index.json"
	if not registry_path.is_file():
		return "capability evidence registry is missing"
	registry_payload = json.loads(registry_path.read_text())
	if registry_payload.get("schema") != "pulp-compat-evidence-index-v1":
		return "capability evidence registry schema is invalid"
	registry = registry_payload.get("entries", {})
	consumer_registry_path = root / "evidence/visual-parity/compat-evidence-index.json"
	if not consumer_registry_path.is_file():
		return "consumer capability evidence registry is missing"
	consumer_payload = json.loads(consumer_registry_path.read_text())
	if consumer_payload.get("schema") != "pulp-compat-evidence-index-v1":
		return "consumer capability evidence registry schema is invalid"
	for evidence_id, evidence in consumer_payload.get("entries", {}).items():
		if evidence_id in registry:
			return f"duplicate evidence ID {evidence_id}"
		registry[evidence_id] = {**evidence, "_source_root": str(root)}
	for record in records:
		name = record.get("name", "<unnamed>")
		declared_values = record.get("values", [])
		value_map = {
			(item.get("value"), tuple(sorted((item.get("context") or {}).items()))): item
			for item in declared_values if isinstance(item, dict)
		}
		if set(value_map) != actual[name]:
			return f"capability value closure mismatch: {name}"
		for value, context in sorted(actual[name]):
			context_label = "".join(f" [{field}={observed}]" for field, observed in context)
			failure = decision_failure(
				f"{name}={value}{context_label}", value_map[(value, context)], burl_source, registry)
			if failure:
				return failure
	behavior_records = coverage.get("behaviorClasses", [])
	if {record.get("name") for record in behavior_records if isinstance(record, dict)} != REQUIRED_BEHAVIOR_CLASSES:
		return "behavior capability closure mismatch"
	for record in behavior_records:
		failure = decision_failure(record.get("name", "<unnamed>"), record, burl_source, registry)
		if failure:
			return failure
	return None


def decision_failure(name: str, record: dict, burl_source: Path, registry: dict) -> str | None:
	decision = record.get("decision")
	if record.get("observation") != "observed":
		return f"capability prerequisite failed: {name} is unobserved"
	if decision not in {"supported", "lowered", "platform", "unsupported"}:
		return f"capability prerequisite failed: {name} has no exact decision"
	if decision == "unsupported":
		return f"capability prerequisite failed: {name} is unsupported"
	route = record.get("route")
	if not isinstance(route, str) or not route:
		return f"capability prerequisite failed: {name} has no owned route"
	evidence_ids = record.get("evidenceIds")
	if not isinstance(evidence_ids, list) or not evidence_ids:
		return f"capability prerequisite failed: {name} has no evidence IDs"
	for evidence_id in evidence_ids:
		if not isinstance(evidence_id, str):
			return f"capability prerequisite failed: {name} has malformed evidence ID"
		failure = resolve_evidence(burl_source, evidence_id, route, registry)
		if failure:
			return f"capability prerequisite failed: {name}: {failure}"
	return None


def first_region_failure(manifest: dict, result: dict) -> str | None:
	regions = result.get("regions", {})
	for region in manifest.get("critical_regions", []):
		name = region["name"]
		if name in regions and not regions[name].get("passed", False):
			return name
	return None


def run(index_path: Path, burl_source: Path) -> dict:
	root = index_path.resolve().parents[2]
	index = json.loads(index_path.read_text())
	if index.get("schema") != "palot-visual-oracle-index-v1" or len(index.get("scenarios", [])) != 11:
		return {"ok": False, "stage": "index", "failure": "oracle index must contain 11 scenarios"}
	coverage = root / index["capabilityCoverage"]
	failure = coverage_failure(root, coverage, burl_source)
	if failure:
		return {"ok": False, "stage": "capability", "failure": failure}
	gate = burl_source / "tools/import-validation/visual_parity_gate.py"
	if not gate.is_file():
		return {"ok": False, "stage": "framework", "failure": f"missing Burl visual gate: {gate}"}
	for scenario in index["scenarios"]:
		if scenario.get("stateEvidence") != "available":
			return {"ok": False, "stage": "state-evidence", "scenario": scenario["id"],
				"failure": scenario.get("gap", "scenario-specific capture is unavailable")}
		manifest_path = root / scenario["manifest"]
		manifest = json.loads(manifest_path.read_text())
		completed = subprocess.run(
			[sys.executable, str(gate), str(manifest_path)], capture_output=True, text=True,
		)
		try:
			result = json.loads(completed.stdout)
		except json.JSONDecodeError:
			return {"ok": False, "stage": "visual", "scenario": scenario["id"],
				"failure": completed.stderr or "visual gate emitted invalid JSON"}
		region = first_region_failure(manifest, result)
		if region:
			return {"ok": False, "stage": "critical-region", "scenario": scenario["id"],
				"region": region, "failure": f"first critical-region failure: {region}",
				"gate": result}
		if not result.get("ok"):
			return {"ok": False, "stage": "visual", "scenario": scenario["id"],
				"failure": result.get("errors", ["visual gate failed"])[0], "gate": result}
	return {"ok": True, "scenarios": 11}


def main() -> int:
	parser = argparse.ArgumentParser()
	parser.add_argument("--index", type=Path,
		default=Path("evidence/visual-parity/oracle-index.v1.json"))
	parser.add_argument("--burl-source", type=Path, required=True)
	parser.add_argument("--output", type=Path)
	args = parser.parse_args()
	result = run(args.index, args.burl_source)
	rendered = json.dumps(result, indent=2, sort_keys=True) + "\n"
	if args.output:
		args.output.write_text(rendered)
	else:
		print(rendered, end="")
	return 0 if result["ok"] else 2


if __name__ == "__main__":
	raise SystemExit(main())
