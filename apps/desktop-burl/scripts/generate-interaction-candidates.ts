#!/usr/bin/env bun

import { readFile, writeFile } from "node:fs/promises"
import { pathToFileURL } from "node:url"
import { resolve } from "node:path"

const args = new Map<string, string>()
for (let index = 2; index < process.argv.length; index += 2)
	args.set(process.argv[index], process.argv[index + 1])

const burlSource = resolve(args.get("--burl-source") ?? "")
const semanticsPath = resolve(args.get("--semantics") ?? "")
const policyPath = resolve(args.get("--policy") ?? "")
const outputPath = resolve(args.get("--output") ?? "")
if (!burlSource || !semanticsPath || !policyPath || !outputPath)
	throw new Error("required: --burl-source --semantics --policy --output")

const importer = await import(pathToFileURL(resolve(burlSource, "packages/pulp-import-ir/src/index.ts")).href)
const semantics = JSON.parse(await readFile(semanticsPath, "utf8"))
const policy = JSON.parse(await readFile(policyPath, "utf8"))
if (!semantics.observedDom || !Array.isArray(policy.rules))
	throw new Error("semantics or policy document is invalid")

const viewport = semantics.capture && Number.isFinite(semantics.capture.innerWidth) &&
	Number.isFinite(semantics.capture.innerHeight)
	? { x: 0, y: 0, width: semantics.capture.innerWidth, height: semantics.capture.innerHeight }
	: undefined
// Preserve the authored policy rules and their match specificity. Flattening
// them to source/action pairs discards the provenance required to resolve an
// exact source binding ahead of broader semantic fallbacks.
const report = importer.extractInteractionCandidates(semantics.observedDom, policy, { viewport })
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`)
console.log(`interaction candidates: total=${report.summary.total} mapped=${report.summary.mapped} unmapped=${report.summary.unmapped} missingEvidence=${report.summary.missingEvidence}`)
