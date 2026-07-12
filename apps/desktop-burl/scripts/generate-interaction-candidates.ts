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

const sourceText = (node: any): string => [node.text ?? "",
	...(node.content ?? []).filter((item: any) => item.kind === "text").map((item: any) => item.text ?? ""),
	...(node.children ?? []).map(sourceText)].join(" ").replace(/\s+/g, " ").trim()
const observed: any[] = []
const collect = (node: any) => { observed.push(node); for (const child of node.children ?? []) collect(child) }
collect(semantics.observedDom)
const reviewed = policy.rules.flatMap((rule: any) => {
	const applicationAction = rule.attributes?.pulpHostAction
	if (!applicationAction) return []
	const matches = observed.filter((node) => {
		const match = rule.match ?? {}
		const role = node.attributes?.role ?? (node.tagName === "button" ? "button" :
			node.tagName === "textarea" || node.tagName === "input" ? "textbox" : "")
		if (match.sourceId && node.sourceId !== match.sourceId) return false
		if (match.tagName && node.tagName !== match.tagName) return false
		if (match.role && role !== match.role) return false
		if (match.accessibleName && node.attributes?.["aria-label"] !== match.accessibleName) return false
		if (match.textExact && sourceText(node) !== match.textExact) return false
		if (match.attribute) {
			const value = node.attributes?.[match.attribute.name]
			if (match.attribute.present && value === undefined) return false
			if (match.attribute.value !== undefined && value !== match.attribute.value) return false
		}
		return true
	})
	if (matches.length !== 1) throw new Error(`reviewed interaction rule ${rule.id} matched ${matches.length} nodes`)
	return [{ sourceId: matches[0].sourceId, applicationAction }]
})
const report = importer.extractInteractionCandidates(semantics.observedDom, reviewed)
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`)
console.log(`interaction candidates: total=${report.summary.total} mapped=${report.summary.mapped} unmapped=${report.summary.unmapped} missingEvidence=${report.summary.missingEvidence}`)
