#!/usr/bin/env bun

import { readFile, writeFile } from "node:fs/promises"
import { pathToFileURL } from "node:url"
import { resolve } from "node:path"

const args = new Map<string, string>()
for (let index = 2; index < process.argv.length; index += 2) {
	args.set(process.argv[index], process.argv[index + 1])
}

const burlSource = resolve(args.get("--burl-source") ?? "")
const semanticsPath = resolve(args.get("--semantics") ?? "")
const outputPath = resolve(args.get("--output") ?? "")
const sourceRevision = args.get("--source-revision") ?? ""
const importedAt = args.get("--imported-at") ?? ""
const bindingPolicyPath = resolve(args.get("--binding-policy") ?? "")
if (!burlSource || !semanticsPath || !outputPath || !sourceRevision || !importedAt || !bindingPolicyPath) {
	throw new Error("required: --burl-source --semantics --output --source-revision --imported-at --binding-policy")
}

const modulePath = resolve(burlSource, "packages/pulp-import-ir/src/index.ts")
const importer = await import(pathToFileURL(modulePath).href)
const semantics = JSON.parse(await readFile(semanticsPath, "utf8"))
if (!semantics.observedDom) throw new Error("source semantics has no observedDom tree")
const removeFormattingWhitespace = (node: any) => {
	if (Array.isArray(node.content)) node.content = node.content.filter((item: any) => item.kind !== "text" || item.text?.trim())
	if (Array.isArray(node.orderedPaintContent)) node.orderedPaintContent = node.orderedPaintContent.filter((item: any) => item.kind !== "text" || item.text?.trim())
	for (const child of node.children ?? []) removeFormattingWhitespace(child)
}
removeFormattingWhitespace(semantics.observedDom)

const lowered = importer.lowerObservedDom(semantics.observedDom, importedAt)
const designIr = importer.toNativeDesignIrV1(lowered, {
	sourceFile: semanticsPath,
	importedAt,
	sourceRevision,
	platformFonts: importer.macosSkiaPlatformFontContract,
})

interface ObservedNode {
	sourceId: string
	tagName: string
	attributes?: Record<string, string>
	text?: string
	content?: Array<{ kind: string; text?: string }>
	children?: ObservedNode[]
}
interface PolicyRule {
	id: string
	match: { tagName?: string; role?: string; accessibleName?: string; textExact?: string; attribute?: { name: string; present?: boolean; value?: string } }
	attributes: Record<string, string>
}

const policy = JSON.parse(await readFile(bindingPolicyPath, "utf8")) as { version: number; rules: PolicyRule[] }
if (policy.version !== 1 || !Array.isArray(policy.rules)) throw new Error("invalid binding policy")
const observed = new Map<string, { node: ObservedNode; text: string }>()
const collect = (node: ObservedNode): string => {
	const text = [node.text ?? "", ...(node.content ?? []).filter((item) => item.kind === "text").map((item) => item.text ?? ""), ...(node.children ?? []).map(collect)].join(" ").replace(/\s+/g, " ").trim()
	observed.set(node.sourceId, { node, text })
	return text
}
collect(semantics.observedDom)
const matches = (entry: { node: ObservedNode; text: string }, rule: PolicyRule) => {
	const { node, text } = entry, match = rule.match
	if (match.tagName && node.tagName !== match.tagName) return false
	if (match.role && (node.attributes?.role ?? (node.tagName === "button" ? "button" : node.tagName === "textarea" ? "textbox" : "")) !== match.role) return false
	if (match.accessibleName && node.attributes?.["aria-label"] !== match.accessibleName) return false
	if (match.textExact && text !== match.textExact) return false
	if (match.attribute) {
		const value = node.attributes?.[match.attribute.name]
		if (match.attribute.present && value === undefined) return false
		if (match.attribute.value !== undefined && value !== match.attribute.value) return false
	}
	return true
}
const applied = new Map(policy.rules.map((rule) => [rule.id, 0]))
const stamp = (node: any) => {
	const entry = observed.get(node.name)
	if (entry) for (const rule of policy.rules) if (matches(entry, rule)) {
		node.attributes = { ...(node.attributes ?? {}), ...rule.attributes, pulpBindingPolicyRule: rule.id }
		applied.set(rule.id, (applied.get(rule.id) ?? 0) + 1)
	}
	for (const child of node.children ?? []) stamp(child)
}
stamp(designIr.root)
for (const rule of policy.rules) {
	const count = applied.get(rule.id) ?? 0
	if (count !== 1) throw new Error(`binding policy ${rule.id} matched ${count} nodes; expected exactly one`)
}
await writeFile(outputPath, JSON.stringify(designIr, null, 2) + "\n")
