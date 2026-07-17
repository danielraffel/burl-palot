#!/usr/bin/env python3
"""Extract immutable Palot CSS custom properties into an authored-token sidecar."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
from pathlib import Path

SOURCE_PATH = "packages/ui/src/styles/globals.css"
SOURCE_REVISION = "fd63a75dad3d0e8555ba22a47e720d285889fbf0"
PROPERTY = re.compile(r"(--[a-zA-Z0-9_-]+)\s*:\s*([^;]+);")


def source_at_revision(repo: Path) -> str:
	return subprocess.run(
		["git", "show", f"{SOURCE_REVISION}:{SOURCE_PATH}"],
		cwd=repo,
		check=True,
		capture_output=True,
		text=True,
	).stdout


def matching_block(text: str, opening_brace: int) -> str:
	depth = 0
	for index in range(opening_brace, len(text)):
		if text[index] == "{":
			depth += 1
		elif text[index] == "}":
			depth -= 1
			if depth == 0:
				return text[opening_brace + 1 : index]
	raise ValueError("unterminated CSS block")


def blocks(text: str, selector: re.Pattern[str]) -> list[str]:
	return [matching_block(text, match.end() - 1) for match in selector.finditer(text)]


def declarations(block_texts: list[str], scope: str) -> list[dict[str, str]]:
	result: list[dict[str, str]] = []
	for block_index, block in enumerate(block_texts):
		for match in PROPERTY.finditer(block):
			result.append(
				{
					"scope": scope,
					"block": str(block_index),
					"name": match.group(1),
					"value": match.group(2).strip(),
				},
			)
	return result


def token(value: str) -> dict[str, object]:
	if re.fullmatch(r"#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?", value):
		return {"$type": "color", "$value": value.lower()}
	if re.fullmatch(r"-?[0-9]+(?:\.[0-9]+)?(?:px|rem|em|%)", value):
		return {"$type": "dimension", "$value": value}
	if re.fullmatch(r"-?[0-9]+(?:\.[0-9]+)?", value):
		return {"$type": "number", "$value": value}
	return {"$type": "string", "$value": value}


def mode_document(base: list[dict[str, str]], overrides: list[dict[str, str]]) -> dict[str, object]:
	values: dict[str, str] = {}
	for item in [*base, *overrides]:
		values[item["name"][2:]] = item["value"]
	return {name: token(value) for name, value in sorted(values.items())}


def generate(repo: Path) -> dict[str, object]:
	css = source_at_revision(repo)
	root = declarations(blocks(css, re.compile(r"(?m)^\s*:root\s*\{")), ":root")
	dark = declarations(blocks(css, re.compile(r"(?m)^\s*\.dark\s*\{")), ".dark")
	inline = declarations(blocks(css, re.compile(r"(?m)^\s*@theme\s+inline\s*\{")), "@theme inline")
	authored = {
		"$extensions": {
			"com.pulp.authoredTokens": {
				"collections": [
					{"id": "appearance", "defaultMode": "light", "modes": ["light", "dark"]},
				],
				"modeDocuments": {
					"appearance/light": mode_document(root, []),
					"appearance/dark": mode_document(root, dark),
				},
			},
			"com.palot.cssSource": {
				"path": SOURCE_PATH,
				"revision": SOURCE_REVISION,
				"sha256": hashlib.sha256(css.encode()).hexdigest(),
				"customProperties": [*inline, *root, *dark],
			},
		},
	}
	authored_json = json.dumps(authored, indent=2, sort_keys=True) + "\n"
	return {
		"schemaVersion": 1,
		"authoredDtcgJson": authored_json,
		"themeProjection": "lossy",
		"source": {
			"uri": f"git:{SOURCE_PATH}",
			"revision": SOURCE_REVISION,
			"contentHash": f"sha256:{hashlib.sha256(css.encode()).hexdigest()}",
			"adapter": "palot-css-custom-properties-v1",
		},
		"selectedModes": {"appearance": "dark"},
		"diagnostics": [],
	}


def main() -> None:
	parser = argparse.ArgumentParser()
	parser.add_argument("--repo", type=Path, required=True)
	destination = parser.add_mutually_exclusive_group(required=True)
	destination.add_argument("--output", type=Path)
	destination.add_argument("--check", type=Path)
	args = parser.parse_args()
	generated = json.dumps(generate(args.repo), indent=2, sort_keys=True) + "\n"
	if args.check:
		if args.check.read_text() != generated:
			raise SystemExit(f"authored-token sidecar is stale: {args.check}")
	else:
		args.output.write_text(generated)


if __name__ == "__main__":
	main()
