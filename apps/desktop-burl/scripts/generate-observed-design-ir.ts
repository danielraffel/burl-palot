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
const responsiveSemantics = (args.get("--responsive-semantics") ?? "").split(",").filter(Boolean).map((path) => resolve(path))
if (!burlSource || !semanticsPath || !outputPath || !sourceRevision || !importedAt || !bindingPolicyPath) {
	throw new Error("required: --burl-source --semantics --output --source-revision --imported-at --binding-policy")
}

const modulePath = resolve(burlSource, "packages/pulp-import-ir/src/index.ts")
const importer = await import(pathToFileURL(modulePath).href)
const semantics = JSON.parse(await readFile(semanticsPath, "utf8"))
if (!semantics.observedDom) throw new Error("source semantics has no observedDom tree")
const renderRoot = semantics.observedDom.tagName?.toLowerCase() === "html"
	? semantics.observedDom.children?.find((child: any) => child.tagName?.toLowerCase() === "body")
	: semantics.observedDom
if (!renderRoot) throw new Error("source semantics has no renderable body")
const importPolicy = JSON.parse(await readFile(bindingPolicyPath, "utf8")) as {
	version: number
	rules: PolicyRule[]
	collections?: Array<{ id: string; containerSourceId: string; firstChildSourceId: string; lastChildSourceId: string; collectionKey: string; routeId: string }>
	svgExclusions?: Array<{ sourceId: string; reason: string }>
}
const removeFormattingWhitespace = (node: any) => {
	if (node.tagName?.toLowerCase() === "svg") {
		node.content = []
		node.orderedPaintContent = []
		delete node.text
		node.children = []
		return
	}
	node.children = (node.children ?? []).filter((child: any) => !["script", "style", "template", "link", "meta"].includes(child.tagName?.toLowerCase()))
	if (Array.isArray(node.content)) node.content = node.content.filter((item: any) => item.kind !== "text" || item.text?.trim())
	if (Array.isArray(node.orderedPaintContent)) node.orderedPaintContent = node.orderedPaintContent.filter((item: any) => item.kind !== "text" || item.text?.trim())
	if ((node.content?.length || node.orderedPaintContent?.length) && node.text !== undefined) delete node.text
	for (const child of node.children ?? []) removeFormattingWhitespace(child)
}
removeFormattingWhitespace(renderRoot)

let lowered = importer.lowerObservedDom(renderRoot, importedAt)
if (responsiveSemantics.length) {
	const captures = await Promise.all(responsiveSemantics.map(async (path) => {
		const capture = JSON.parse(await readFile(path, "utf8"))
		const root = capture.observedDom?.tagName?.toLowerCase() === "html"
			? capture.observedDom.children?.find((child: any) => child.tagName?.toLowerCase() === "body")
			: capture.observedDom
		if (!root || !capture.policy?.viewport) throw new Error(`invalid responsive semantics ${path}`)
		removeFormattingWhitespace(root)
		return { viewport: capture.policy.viewport, root }
	}))
	const reconciliation = importer.reconcileResponsiveConstraints(captures)
	for (const [sourceId, constraint] of reconciliation.constraints) {
		const transitions = [...constraint.visibility, ...constraint.layoutVariants]
		if (transitions.some((variant: any) => variant.transitionToNext?.confidence === "bounded"))
			reconciliation.constraints.delete(sourceId)
	}
	const loweredCaptures = captures.map((capture) => importer.lowerObservedDom(capture.root, importedAt))
	lowered = importer.unionResponsiveTrees(loweredCaptures, reconciliation)
}
const inlineSvgCaptures: Array<{ sourceId: string; outerHTML: string; computedColor?: string }> = []
const collectInlineSvg = (node: any) => {
	if (node.tagName?.toLowerCase() === "svg") {
		const outerHTML = node.outerHtml ?? node.outerHTML ?? node.inlineSvg
		if (!outerHTML) throw new Error(`SVG ${node.sourceId} has no captured outerHTML`)
		inlineSvgCaptures.push({ sourceId: node.sourceId, outerHTML, computedColor: node.computedStyle?.color })
	}
	for (const child of node.children ?? []) collectInlineSvg(child)
}
collectInlineSvg(renderRoot)
const exclusions = new Map((importPolicy.svgExclusions ?? []).map((item) => [item.sourceId, item.reason]))
for (const [sourceId, reason] of exclusions) {
	if (!reason.trim() || !inlineSvgCaptures.some((capture) => capture.sourceId === sourceId))
		throw new Error(`invalid SVG exclusion ${sourceId}`)
}
const projectedSvgCaptures = inlineSvgCaptures.filter((capture) => !exclusions.has(capture.sourceId))
const designIr = importer.toNativeDesignIrV1(lowered, {
	sourceFile: semanticsPath,
	importedAt,
	sourceRevision,
	platformFonts: importer.macosSkiaPlatformFontContract,
	inlineSvgCaptures: projectedSvgCaptures,
})

const faithfulSvgCount = (node: any): number => (node.render_mode === "faithful_svg" ? 1 : 0) +
	(node.children ?? []).reduce((sum: number, child: any) => sum + faithfulSvgCount(child), 0)
if (designIr.diagnostics.some((item: any) => item.severity === "error"))
	throw new Error(`source import error diagnostics: ${JSON.stringify(designIr.diagnostics)}`)
if (faithfulSvgCount(designIr.root) !== projectedSvgCaptures.length)
	throw new Error(`inline SVG invariant failed: captured ${inlineSvgCaptures.length}, excluded ${exclusions.size}, resolved ${faithfulSvgCount(designIr.root)}`)

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
	match: { sourceId?: string; tagName?: string; role?: string; accessibleName?: string; textExact?: string; attribute?: { name: string; present?: boolean; value?: string } }
	attributes: Record<string, string>
}

const policy = importPolicy
if (policy.version !== 1 || !Array.isArray(policy.rules)) throw new Error("invalid binding policy")
const observed = new Map<string, { node: ObservedNode; text: string }>()
const collect = (node: ObservedNode): string => {
	const text = [node.text ?? "", ...(node.content ?? []).filter((item) => item.kind === "text").map((item) => item.text ?? ""), ...(node.children ?? []).map(collect)].join(" ").replace(/\s+/g, " ").trim()
	observed.set(node.sourceId, { node, text })
	return text
}
collect(renderRoot)
const matches = (entry: { node: ObservedNode; text: string }, rule: PolicyRule) => {
	const { node, text } = entry, match = rule.match
	if (match.sourceId && node.sourceId !== match.sourceId) return false
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

const collectionDiagnostics: Array<{ id: string; code: string; detail: string }> = []
const emitCollectionSlot = (node: any, spec: NonNullable<typeof importPolicy.collections>[number]): boolean => {
	if (node.name === spec.containerSourceId) {
		const first = node.children?.findIndex((child: any) => child.name === spec.firstChildSourceId) ?? -1
		const last = node.children?.findIndex((child: any) => child.name === spec.lastChildSourceId) ?? -1
		if (first < 0 || last < first) throw new Error(`collection ${spec.id} has invalid/noncontiguous child range`)
		const selected = node.children.slice(first, last + 1)
		if (!selected.length) throw new Error(`collection ${spec.id} selected no children`)
		const slotName = `${node.name}::collection-slot:${spec.id}`
		const slot = {
			...node,
			name: slotName,
			children: selected,
			attributes: { source_revision: node.attributes?.source_revision ?? sourceRevision,
				pulpRouteId: spec.routeId, pulpCollectionKey: spec.collectionKey },
			stable_anchor_id: `observed-dom:${slotName}`,
			source_node_id: slotName,
			raw_source: JSON.stringify({ kind: "generated-collection-slot", containerSourceId: spec.containerSourceId,
				firstChildSourceId: spec.firstChildSourceId, lastChildSourceId: spec.lastChildSourceId })
		}
		node.children = [...node.children.slice(0, first), slot, ...node.children.slice(last + 1)]
		collectionDiagnostics.push({ id: spec.id, code: "collection-slot-emitted", detail: `${selected.length} contiguous children` })
		return true
	}
	return (node.children ?? []).some((child: any) => emitCollectionSlot(child, spec))
}
for (const collection of importPolicy.collections ?? []) {
	if (!emitCollectionSlot(designIr.root, collection)) throw new Error(`collection ${collection.id} container not found`)
}
for (const rule of policy.rules) {
	const count = applied.get(rule.id) ?? 0
	if (count !== 1) throw new Error(`binding policy ${rule.id} matched ${count} nodes; expected exactly one`)
}
await writeFile(outputPath, JSON.stringify(designIr, null, 2) + "\n")
