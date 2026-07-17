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
const applicationBindingsPath = args.get("--application-bindings") ? resolve(args.get("--application-bindings")!) : undefined
const allowStateOnlyPolicyRules = args.get("--allow-state-only-policy-rules") === "true"
const fontReceiptPath = resolve(args.get("--font-receipt") ?? "")
const semanticRoleSemanticsPath = args.get("--semantic-role-semantics")
	? resolve(args.get("--semantic-role-semantics")!) : undefined
const motionSemanticsPath = args.get("--motion-semantics") ? resolve(args.get("--motion-semantics")!) : undefined
const provenanceSemanticsPaths = (args.get("--provenance-semantics") ?? "")
	.split(",").filter(Boolean).map((path) => resolve(path))
const responsiveSemantics = (args.get("--responsive-semantics") ?? "").split(",").filter(Boolean).map((path) => resolve(path))
const applicationStateKey = args.get("--application-state-key")
const applicationStateSemantics = (args.get("--application-state-semantics") ?? "").split(",").filter(Boolean).map((entry) => {
	const split = entry.indexOf("=")
	if (split <= 0 || split === entry.length - 1) throw new Error("application state semantics must be state=path")
	return { state: entry.slice(0, split), path: resolve(entry.slice(split + 1)) }
})
const applicationOverlayHosts = (args.get("--application-overlay-hosts") ?? "").split(",").filter(Boolean)
if (!!applicationStateKey !== !!applicationStateSemantics.length)
	throw new Error("application state key and semantics must be provided together")
if (!burlSource || !semanticsPath || !outputPath || !sourceRevision || !importedAt || !bindingPolicyPath || !fontReceiptPath) {
	throw new Error("required: --burl-source --semantics --output --source-revision --imported-at --binding-policy --font-receipt")
}

const modulePath = resolve(burlSource, "packages/pulp-import-ir/src/index.ts")
const importer = await import(pathToFileURL(modulePath).href)
const semantics = JSON.parse(await readFile(semanticsPath, "utf8"))
if (!semantics.observedDom) throw new Error("source semantics has no observedDom tree")
const semanticRoleSemantics = semanticRoleSemanticsPath
	? JSON.parse(await readFile(semanticRoleSemanticsPath, "utf8")) : semantics
if (semanticRoleSemanticsPath && (
	semanticRoleSemantics.policy?.sourceRevision !== semantics.policy?.sourceRevision ||
	semanticRoleSemantics.page?.url !== semantics.page?.url ||
	semanticRoleSemantics.policy?.clock !== semantics.policy?.clock ||
	JSON.stringify(semanticRoleSemantics.policy?.viewport) !== JSON.stringify(semantics.policy?.viewport)))
	throw new Error("semantic role semantics crosses source revision, page, clock, or viewport provenance")
const renderRoot = semantics.observedDom.tagName?.toLowerCase() === "html"
	? semantics.observedDom.children?.find((child: any) => child.tagName?.toLowerCase() === "body")
	: semantics.observedDom
if (!renderRoot) throw new Error("source semantics has no renderable body")
const styleProvenance = semantics.styleProvenanceByDomOrder as Array<{
	declarations?: Record<string, unknown>
	matchedStylesCapture?: string
	matchedStylesCompleteProperties?: string[]
	winningDeclarations?: Record<string, string>
	motion?: unknown[]
}> | undefined
const attachStyleProvenance = (node: any, receipts = styleProvenance) => {
	if (Number.isInteger(node.provenanceIndex) && node.provenanceIndex >= 0) {
		const receipt = receipts?.[node.provenanceIndex]
		if (!receipt) throw new Error(`source semantics has no style provenance at DOM order ${node.provenanceIndex}`)
		node.styleProvenance = receipt.declarations ?? {}
		node.styleProvenanceComplete = receipt.matchedStylesCapture === "complete"
		node.styleProvenanceCompleteProperties = receipt.matchedStylesCompleteProperties ?? []
		node.styleProvenanceWinners = receipt.winningDeclarations ?? {}
		if (receipt.motion?.length) node.motion = receipt.motion
	}
	for (const child of node.children ?? []) attachStyleProvenance(child, receipts)
}
if (styleProvenance) attachStyleProvenance(renderRoot)
let supplementalProvenanceBySourceId = new Map<string, {
	declarations?: Record<string, unknown>
	matchedStylesCapture?: string
	matchedStylesCompleteProperties?: string[]
	winningDeclarations?: Record<string, string>
}>()
const joinSupplementalProvenance = (root: any) => {
	let joined = 0
	const visit = (node: any) => {
		const receipt = supplementalProvenanceBySourceId.get(node.sourceId)
		if (receipt) {
			node.styleProvenance = receipt.declarations ?? {}
			node.styleProvenanceComplete = receipt.matchedStylesCapture === "complete"
			node.styleProvenanceCompleteProperties = receipt.matchedStylesCompleteProperties ?? []
			node.styleProvenanceWinners = receipt.winningDeclarations ?? {}
			joined++
		}
		for (const child of node.children ?? []) visit(child)
	}
	visit(root)
	return joined
}
for (const provenanceSemanticsPath of provenanceSemanticsPaths) {
	const supplemental = JSON.parse(await readFile(provenanceSemanticsPath, "utf8"))
	const supplementalReceipts = supplemental.styleProvenanceByDomOrder as Array<{
		declarations?: Record<string, unknown>
		matchedStylesCapture?: string
		matchedStylesCompleteProperties?: string[]
		winningDeclarations?: Record<string, string>
	}> | undefined
	if (!supplementalReceipts ||
		importer.captureCohortKey(supplemental, { includeViewport: true }) !==
			importer.captureCohortKey(semantics, { includeViewport: true }) ||
		supplemental.page?.url !== semantics.page?.url ||
		supplemental.policy?.clock !== semantics.policy?.clock ||
		JSON.stringify(supplemental.policy?.viewport) !== JSON.stringify(semantics.policy?.viewport))
		throw new Error("supplemental provenance must match the canonical page, clock, and viewport")
	const indexSupplemental = (node: any) => {
		if (node.sourceId && Number.isInteger(node.provenanceIndex) && node.provenanceIndex >= 0) {
			const receipt = supplementalReceipts[node.provenanceIndex]
			if (!receipt) throw new Error(`supplemental semantics has no style provenance at DOM order ${node.provenanceIndex}`)
			if (receipt.matchedStylesCapture === "complete" || receipt.matchedStylesCapture === "property-scoped") {
				const prior = supplementalProvenanceBySourceId.get(node.sourceId)
				const nodeWideComplete = prior?.matchedStylesCapture === "complete" ||
					receipt.matchedStylesCapture === "complete"
				supplementalProvenanceBySourceId.set(node.sourceId, {
					declarations: { ...(prior?.declarations ?? {}), ...(receipt.declarations ?? {}) },
					matchedStylesCapture: nodeWideComplete ? "complete" : "property-scoped",
					matchedStylesCompleteProperties: [...new Set([
						...(prior?.matchedStylesCompleteProperties ?? []),
						...(receipt.matchedStylesCompleteProperties ?? []),
					])].sort(),
					winningDeclarations: {
						...(prior?.winningDeclarations ?? {}),
						...(receipt.winningDeclarations ?? {}),
					},
				})
			}
		}
		for (const child of node.children ?? []) indexSupplemental(child)
	}
	indexSupplemental(supplemental.observedDom)
}
if (provenanceSemanticsPaths.length) {
	const joined = joinSupplementalProvenance(renderRoot)
	if (!joined) throw new Error("supplemental provenance did not join the canonical source tree")
	console.error(`[supplemental-provenance] ${JSON.stringify({
		captures: provenanceSemanticsPaths.length,
		candidates: supplementalProvenanceBySourceId.size,
		joined,
	})}`)
}
const motionBySourceId = new Map<string, unknown[]>()
if (motionSemanticsPath) {
	const motionSemantics = JSON.parse(await readFile(motionSemanticsPath, "utf8"))
	const visit = (node: any) => {
		if (node.sourceId && node.motion?.length) {
			if (motionBySourceId.has(node.sourceId)) throw new Error(`duplicate motion source identity ${node.sourceId}`)
			motionBySourceId.set(node.sourceId, node.motion)
		}
		for (const child of node.children ?? []) visit(child)
	}
	visit(motionSemantics.observedDom)
	if (!motionBySourceId.size) throw new Error(`motion semantics has no animation receipts: ${motionSemanticsPath}`)
}
const applyMotionReceipts = (root: any) => {
	let joined = 0
	const visit = (node: any) => {
		const motion = motionBySourceId.get(node.sourceId)
		if (motion) {
			node.motion = motion
			joined++
		}
		for (const child of node.children ?? []) visit(child)
	}
	visit(root)
	return joined
}
let importPolicy = JSON.parse(await readFile(bindingPolicyPath, "utf8")) as {
	version: number
	rules: PolicyRule[]
	collections?: Array<{ id: string; containerSourceId: string; firstChildSourceId: string; lastChildSourceId: string; collectionKey: string; routeId: string }>
	semanticRoleBindings?: Array<{ bindingSourceId: string; containerSelector: string }>
	svgExclusions?: Array<{ sourceId: string; reason: string }>
}
const capturedSourceIds: string[] = []
const collectSourceIds = (node: any) => {
	if (node.sourceId) capturedSourceIds.push(node.sourceId)
	for (const child of node.children ?? []) collectSourceIds(child)
}
collectSourceIds(renderRoot)
const resolvePolicySourceId = (sourceId: string) => {
	if (allowStateOnlyPolicyRules) {
		const suffix = importer.stableAuthoredSourceSuffix(sourceId)
		if (!capturedSourceIds.some((candidate) =>
			importer.stableAuthoredSourceSuffix(candidate) === suffix)) return sourceId
	}
	return importer.resolveUniqueStableSourceId(sourceId, capturedSourceIds)
}
importPolicy = {
	...importPolicy,
	rules: importPolicy.rules.map((rule) => ({
		...rule,
		match: rule.match.sourceId
			? { ...rule.match, sourceId: resolvePolicySourceId(rule.match.sourceId) }
			: rule.match,
	})),
	collections: importPolicy.collections?.map((collection) => ({
		...collection,
		containerSourceId: resolvePolicySourceId(collection.containerSourceId),
		firstChildSourceId: resolvePolicySourceId(collection.firstChildSourceId),
		lastChildSourceId: resolvePolicySourceId(collection.lastChildSourceId),
	})),
	semanticRoleBindings: importPolicy.semanticRoleBindings?.map((binding) => ({
		...binding,
		bindingSourceId: resolvePolicySourceId(binding.bindingSourceId),
	})),
	svgExclusions: importPolicy.svgExclusions?.map((exclusion) => ({
		...exclusion,
		sourceId: resolvePolicySourceId(exclusion.sourceId),
	})),
}
const fontReceipt = JSON.parse(await readFile(fontReceiptPath, "utf8")) as {
	usedFaces?: Array<{ family: string; postScriptName: string; custom: boolean; glyphCount: number }>
}
if (!fontReceipt.usedFaces?.some((face) => face.glyphCount > 0)) throw new Error("font receipt has no runtime-used faces")
const applicationActions = [...new Set([...(applicationBindingsPath
	? (JSON.parse(await readFile(applicationBindingsPath, "utf8")).actions ?? []).map((action: any) => action.id)
	: []), ...(args.get("--application-actions") ?? "").split(",").filter(Boolean)])]
const removeFormattingWhitespace = (node: any) => {
	if (node.tagName?.toLowerCase() === "svg") {
		node.content = []
		node.orderedPaintContent = []
		delete node.text
		node.children = []
		return
	}
	node.children = (node.children ?? []).filter((child: any) => !["script", "style", "template", "link", "meta"].includes(child.tagName?.toLowerCase()))
	const retainedChildren = new Set(node.children.map((child: any) => child.sourceId))
	const retainContent = (item: any) => item.kind === "child"
		? retainedChildren.has(item.sourceId)
		: item.kind !== "text" || item.text?.trim()
	if (Array.isArray(node.content)) node.content = node.content.filter(retainContent)
	if (Array.isArray(node.orderedPaintContent)) node.orderedPaintContent = node.orderedPaintContent.filter(retainContent)
	if ((node.content?.length || node.orderedPaintContent?.length) && node.text !== undefined) delete node.text
	for (const child of node.children ?? []) removeFormattingWhitespace(child)
}
removeFormattingWhitespace(renderRoot)
if (motionBySourceId.size && !applyMotionReceipts(renderRoot))
	throw new Error("motion receipts did not join the canonical source tree")

const lowerOptions = { applicationActions }
let lowered = importer.lowerObservedDom(renderRoot, importedAt, lowerOptions)
const applicationStateRoots: any[] = []
if (applicationStateSemantics.length) {
	if (responsiveSemantics.length) throw new Error("application state captures must be responsive-unioned per state before cross-state union")
	const baseCaptureCohort = importer.captureCohortKey(semantics, { includeViewport: true })
	const captures = await Promise.all(applicationStateSemantics.map(async ({ state, path }) => {
		const capture = JSON.parse(await readFile(path, "utf8"))
		const stateCaptureCohort = importer.captureCohortKey(capture, { includeViewport: true })
		const hashedCohort = baseCaptureCohort.startsWith("sha256:") || stateCaptureCohort.startsWith("sha256:")
		if ((hashedCohort && baseCaptureCohort !== stateCaptureCohort) ||
			!capture.policy?.sourceRevision || capture.policy.sourceRevision !== sourceRevision ||
			capture.page?.url !== semantics.page?.url || capture.policy?.clock !== semantics.policy?.clock ||
			JSON.stringify(capture.policy?.viewport) !== JSON.stringify(semantics.policy?.viewport))
			throw new Error(`application state capture ${state} crosses capture cohort or build/page/clock/viewport provenance`)
		const root = capture.observedDom?.tagName?.toLowerCase() === "html"
			? capture.observedDom.children?.find((child: any) => child.tagName?.toLowerCase() === "body")
			: capture.observedDom
		if (!root) throw new Error(`application state capture ${state} has no renderable root`)
		if (capture.styleProvenanceByDomOrder) attachStyleProvenance(root, capture.styleProvenanceByDomOrder)
		removeFormattingWhitespace(root)
		applicationStateRoots.push(root)
		return { state, root: importer.lowerObservedDom(root, importedAt, lowerOptions) }
	}))
	lowered = importer.unionApplicationStateTrees(applicationStateKey!, captures,
		{ overlayHostIds: applicationOverlayHosts })
}
if (responsiveSemantics.length) {
	let captures = await Promise.all(responsiveSemantics.map(async (path) => {
		const capture = JSON.parse(await readFile(path, "utf8"))
		const root = capture.observedDom?.tagName?.toLowerCase() === "html"
			? capture.observedDom.children?.find((child: any) => child.tagName?.toLowerCase() === "body")
			: capture.observedDom
		const viewport = capture.policy?.viewport ?? (Number.isFinite(capture.capture?.innerWidth) &&
			Number.isFinite(capture.capture?.innerHeight) ? {
				width: capture.capture.innerWidth, height: capture.capture.innerHeight,
			} : undefined)
		if (!root || !viewport) throw new Error(`invalid responsive semantics ${path}`)
		if (capture.styleProvenanceByDomOrder)
			attachStyleProvenance(root, capture.styleProvenanceByDomOrder)
		// Matched-rule provenance contains authored media qualifiers, so it is
		// declaration ownership evidence for the stable source node across the
		// cohort rather than a second used-value sample at one viewport.
		if (supplementalProvenanceBySourceId.size)
			joinSupplementalProvenance(root)
		removeFormattingWhitespace(root)
		applyMotionReceipts(root)
		const cohort = importer.captureCohortKey(capture)
		return { viewport, root, path, cohort }
	}))
	const cohorts = new Set(captures.map((capture) => capture.cohort))
	if (cohorts.size !== 1)
		throw new Error(`responsive captures cross source/build/state cohorts: ${JSON.stringify([...cohorts].sort())}`)
	// unionResponsiveTrees takes its canonical literal/style tree from the last
	// capture. Make that choice explicit and independent of CLI list ordering.
	const reference = captures.findIndex((capture) => capture.path === semanticsPath)
	if (reference < 0) throw new Error("reference semantics must be included in responsive captures")
	captures = [...captures.slice(0, reference), ...captures.slice(reference + 1), captures[reference]]
	const alignment = importer.alignStableObservedDomIdentitiesWithReport(captures)
	const alignedCaptures = alignment.captures
	if (alignment.report.refusedCollisions !== alignment.report.collisions)
		throw new Error(`responsive identity collision accounting mismatch: ${JSON.stringify(alignment.report)}`)
	if (alignment.report.aligned !== 0)
		throw new Error(`canonical captures must not require identity remapping: ${JSON.stringify(alignment.report)}`)
	console.error(`[responsive-identity] ${JSON.stringify(alignment.report)}`)
	const reconciliation = importer.reconcileResponsiveConstraints(alignedCaptures)
	const fatalResponsiveDiagnostics = reconciliation.diagnostics.filter(
		(diagnostic: any) => diagnostic.severity === "error")
	if (fatalResponsiveDiagnostics.length)
		throw new Error(`responsive import error diagnostics: ${JSON.stringify(fatalResponsiveDiagnostics)}`)
	const loweredCaptures = alignedCaptures.map((capture: any) => importer.lowerObservedDom(capture.root, importedAt, lowerOptions))
	lowered = importer.unionResponsiveTrees(loweredCaptures, reconciliation)
}
const inlineSvgCaptureBySourceId = new Map<string, { sourceId: string; outerHTML: string; computedColor?: string }>()
const collectInlineSvg = (node: any) => {
	if (node.tagName?.toLowerCase() === "svg") {
		const outerHTML = node.outerHtml ?? node.outerHTML ?? node.inlineSvg
		if (!outerHTML) throw new Error(`SVG ${node.sourceId} has no captured outerHTML`)
		if (!inlineSvgCaptureBySourceId.has(node.sourceId))
			inlineSvgCaptureBySourceId.set(node.sourceId, { sourceId: node.sourceId, outerHTML, computedColor: node.computedStyle?.color })
	}
	for (const child of node.children ?? []) collectInlineSvg(child)
}
collectInlineSvg(renderRoot)
for (const root of applicationStateRoots) collectInlineSvg(root)
const inlineSvgCaptures = [...inlineSvgCaptureBySourceId.values()]
const runtimeFontsBySourceId = new Map<string, Array<{
	family: string; postScriptName: string; custom: boolean; glyphCount: number
}>>()
const collectRuntimeFonts = (node: any) => {
	const used = (node.usedFonts ?? []).filter((face: any) => face.glyphCount > 0)
	if (node.sourceId && used.length) runtimeFontsBySourceId.set(node.sourceId, used)
	for (const child of node.children ?? []) collectRuntimeFonts(child)
}
collectRuntimeFonts(renderRoot)
const exclusions = new Map((importPolicy.svgExclusions ?? []).map((item) => [item.sourceId, item.reason]))
for (const [sourceId, reason] of exclusions) {
	if (!reason.trim() || !inlineSvgCaptures.some((capture) => capture.sourceId === sourceId))
		throw new Error(`invalid SVG exclusion ${sourceId}`)
}
const projectedSvgCaptures = inlineSvgCaptures.filter((capture) => !exclusions.has(capture.sourceId))
// Apply the reviewed public binding policy to the portable IR before native
// projection.  The framework materializes both the portable metadata and the
// typed executable interaction; stamping attributes onto already-native JSON
// would make controls look bound while leaving hit dispatch inert.
const bindingPolicyReceipts = importer.applySourceBindingPolicy(lowered, importPolicy, {
	requireAllRules: !allowStateOnlyPolicyRules,
})
const designIr = importer.toNativeDesignIrV1(lowered, {
	sourceFile: semanticsPath,
	importedAt,
	sourceRevision,
	platformFonts: importer.macosSkiaPlatformFontContract,
	observedFontUses: importer.projectAggregateRuntimeFontFaces(
		importer.collectObservedFontUses(lowered).map((use: any) => ({
			...use,
			runtimeUsedFonts: runtimeFontsBySourceId.get(use.sourceId) ?? use.runtimeUsedFonts,
		})),
		fontReceipt.usedFaces,
	),
	inlineSvgCaptures: projectedSvgCaptures,
})

const faithfulSvgSourceIds = (node: any, found = new Set<string>()): Set<string> => {
	if (node.render_mode === "faithful_svg") found.add(node.name)
	for (const child of node.children ?? []) faithfulSvgSourceIds(child, found)
	return found
}
if (designIr.diagnostics.some((item: any) => item.severity === "error"))
	throw new Error(`source import error diagnostics: ${JSON.stringify(designIr.diagnostics)}`)
const expectedSvgSourceIds = new Set(projectedSvgCaptures.map((capture) => capture.sourceId))
const resolvedSvgSourceIds = faithfulSvgSourceIds(designIr.root)
const missingSvgSourceIds = [...expectedSvgSourceIds].filter((sourceId) => !resolvedSvgSourceIds.has(sourceId))
const unexpectedSvgSourceIds = [...resolvedSvgSourceIds].filter((sourceId) => !expectedSvgSourceIds.has(sourceId))
if (missingSvgSourceIds.length || unexpectedSvgSourceIds.length)
	throw new Error(`inline SVG invariant failed: ${JSON.stringify({ captured: inlineSvgCaptures.length,
		excluded: exclusions.size, resolved: resolvedSvgSourceIds.size, missingSvgSourceIds, unexpectedSvgSourceIds })}`)

interface PolicyRule {
	id: string
	match: { sourceId?: string; tagName?: string; role?: string; accessibleName?: string; textExact?: string; attribute?: { name: string; present?: boolean; value?: string } }
	attributes: Record<string, string>
	applicationState?: { key: string; visibility: Record<string, boolean> }
}
if (importPolicy.semanticRoleBindings?.length) {
	if (!Array.isArray(semanticRoleSemantics.semanticRoleReceipts))
		throw new Error("source semantics has no semantic role receipts")
	importer.attachSemanticRoleReceipts(
		designIr.root, semanticRoleSemantics.semanticRoleReceipts, importPolicy.semanticRoleBindings)
}

const collectionDiagnostics: Array<{ id: string; code: string; detail: string }> = []
const emitCollectionSlot = (node: any, spec: NonNullable<typeof importPolicy.collections>[number]): boolean => {
	if (node.name === spec.containerSourceId) {
		const first = node.children?.findIndex((child: any) => child.name === spec.firstChildSourceId) ?? -1
		const last = node.children?.findIndex((child: any) => child.name === spec.lastChildSourceId) ?? -1
		if (first < 0 || last < first) throw new Error(`collection ${spec.id} has invalid/noncontiguous child range`)
		const selected = node.children.slice(first, last + 1).map((child: any) => ({
			...child,
			attributes: { ...(child.attributes ?? {}), pulpCollectionSampleRoot: "true" },
		}))
		if (!selected.length) throw new Error(`collection ${spec.id} selected no children`)
		node.attributes = { ...(node.attributes ?? {}),
			source_revision: node.attributes?.source_revision ?? sourceRevision,
			pulpRouteId: spec.routeId, pulpCollectionKey: spec.collectionKey }
		node.children = [...node.children.slice(0, first), ...selected, ...node.children.slice(last + 1)]
		collectionDiagnostics.push({ id: spec.id, code: "collection-slot-emitted", detail: `${selected.length} contiguous children` })
		return true
	}
	return (node.children ?? []).some((child: any) => emitCollectionSlot(child, spec))
}
for (const collection of importPolicy.collections ?? []) {
	if (!emitCollectionSlot(designIr.root, collection)) throw new Error(`collection ${collection.id} container not found`)
}
console.error(`[binding-policy] ${JSON.stringify({
	rules: importPolicy.rules.length,
	matched: bindingPolicyReceipts.filter((receipt: any) => receipt.matchedNodes > 0).length,
	stateOnly: bindingPolicyReceipts.filter((receipt: any) => receipt.matchedNodes === 0).length,
})}`)
await writeFile(outputPath, JSON.stringify(designIr, null, 2) + "\n")
