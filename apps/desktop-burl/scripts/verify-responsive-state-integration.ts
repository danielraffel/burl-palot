#!/usr/bin/env bun

import { createHash } from "node:crypto"
import { readFile, writeFile } from "node:fs/promises"
import { resolve } from "node:path"

const args = new Map<string, string>()
for (let index = 2; index < process.argv.length; index += 2)
	args.set(process.argv[index], process.argv[index + 1])

const basePath = resolve(args.get("--base") ?? "")
const integratedPath = resolve(args.get("--integrated") ?? "")
const manifestPath = resolve(args.get("--responsive-manifest") ?? "")
const compositionReportPath = resolve(args.get("--composition-report") ?? "")
const bindingsPath = resolve(args.get("--bindings") ?? "")
const outputPath = resolve(args.get("--output") ?? "")
if (!basePath || !integratedPath || !manifestPath || !compositionReportPath || !bindingsPath || !outputPath)
	throw new Error("required: --base --integrated --responsive-manifest --composition-report --bindings --output")

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex")
const stable = (value: unknown): string => JSON.stringify(value, (_key, child) =>
	child && typeof child === "object" && !Array.isArray(child)
		? Object.fromEntries(Object.entries(child).sort(([a], [b]) => a.localeCompare(b)))
		: child)
const readJson = async (path: string) => {
	const bytes = await readFile(path)
	return { path, bytes, sha256: sha256(bytes), value: JSON.parse(bytes.toString("utf8")) }
}
const [base, integrated, manifest, compositionReport, bindings] = await Promise.all([
	readJson(basePath), readJson(integratedPath), readJson(manifestPath), readJson(compositionReportPath), readJson(bindingsPath),
])
const violations: string[] = []
if (manifest.value.schema !== "palot-responsive-application-state-layer-v1")
	throw new Error("unexpected responsive layer manifest schema")

const walk = (root: any): any[] => {
	const nodes: any[] = []
	const visit = (node: any) => {
		if (!node || typeof node !== "object") return
		nodes.push(node)
		for (const child of node.children ?? []) visit(child)
	}
	visit(root)
	return nodes
}
const normalizedAnchor = (node: any): string => String(node.source_node_id ?? node.stable_anchor_id ?? "")
	.replace(/^(?:application-state(?:-instance)?:[^:]+(?::[^:]+){0,2}::)+/, "")
const action = (node: any): string | undefined => node.interaction?.actionBindingId
	?? node.attributes?.action_binding_id ?? node.attributes?.pulpHostAction
const subtreeText = (node: any): string => {
	const text = [typeof node.content === "string" ? node.content : "",
		typeof node.text?.text === "string" ? node.text.text : "",
		...(node.children ?? []).map(subtreeText)].filter(Boolean).join(" ")
	return text.replace(/\s+/g, " ").trim()
}
const emptyActionDetails = (nodes: any[]) => nodes.filter((node) => action(node) === "").map((node) => ({
	sourceNodeId: node.source_node_id ?? node.stable_anchor_id ?? "",
	sourceDataSlot: node.attributes?.sourceDataSlot ?? null,
	role: node.attributes?.role ?? null,
	text: subtreeText(node),
}))
const criticalInteraction = (node: any) => {
	const attributes = Object.fromEntries(Object.entries(node.attributes ?? {}).filter(([key]) =>
		key === "action_binding_id" || key === "pulpHostAction" || key === "pulpRouteId" ||
		key === "pulpStateKey" || key === "pulpStateTransition" || key.startsWith("pulpOverlay")))
	if (!Object.keys(attributes).length && !node.interaction?.actionBindingId &&
		!node.meta?.imported_state_key && !node.meta?.imported_state_transition) return undefined
	return { anchor: normalizedAnchor(node), attributes,
		actionBindingId: node.interaction?.actionBindingId ?? null,
		importedStateKey: node.meta?.imported_state_key ?? null,
		importedStateTransition: node.meta?.imported_state_transition ?? null }
}
const multiset = (values: unknown[]) => values.map(stable).sort()
const assertEqual = (label: string, expected: unknown, actual: unknown) => {
	if (stable(expected) !== stable(actual)) throw new Error(`${label} changed`)
}
const assertMultiset = (label: string, expected: unknown[], actual: unknown[]) => {
	const before = multiset(expected), after = multiset(actual)
	if (before.length !== after.length || before.some((value, index) => value !== after[index]))
		throw new Error(`${label} changed: ${before.length} -> ${after.length}`)
}

assertEqual("font family assets", base.value.fontFamilyAssets ?? [], integrated.value.fontFamilyAssets ?? [])
assertEqual("native asset manifest", base.value.assetManifest ?? null, integrated.value.assetManifest ?? null)
const baseNodes = walk(base.value.root), integratedNodes = walk(integrated.value.root)
assertMultiset("critical interaction and overlay records",
	baseNodes.map(criticalInteraction).filter(Boolean),
	integratedNodes.map(criticalInteraction).filter(Boolean))

const baseActions = [...new Set(baseNodes.map(action).filter((item): item is string => !!item))].sort()
const integratedActions = [...new Set(integratedNodes.map(action).filter((item): item is string => !!item))].sort()
assertEqual("imported action set", baseActions, integratedActions)
const baseEmptyActionBindings = baseNodes.filter((node) => action(node) === "").length
const integratedEmptyActionBindings = integratedNodes.filter((node) => action(node) === "").length
if (integratedEmptyActionBindings)
	violations.push(`integrated IR contains ${integratedEmptyActionBindings} empty action bindings (${baseEmptyActionBindings} inherited from the protected base)`)
const requiredActions = (bindings.value.actions ?? []).filter((item: any) => item.required !== false)
	.map((item: any) => item.id).sort()
const nativeComposerActions = new Set(["prompt.send", "prompt.retry"])
const missingRequiredActions = requiredActions.filter((id: string) =>
	!integratedActions.includes(id) && !nativeComposerActions.has(id))
if (missingRequiredActions.length)
	violations.push(`required imported actions are absent: ${missingRequiredActions.join(", ")}`)

const layerEntries: Array<{ dimension: string; value: string; path: string; sha256: string }> = []
for (const [dimension, values] of Object.entries(manifest.value.dimensions ?? {}))
	for (const [value, entry] of Object.entries(values as Record<string, any>))
		layerEntries.push({ dimension, value, path: entry.path, sha256: entry.sha256 })
const responsiveFields = (responsive: any) => responsive && {
	horizontal: responsive.horizontal,
	vertical: responsive.vertical,
	horizontalVariants: responsive.horizontalVariants,
	verticalVariants: responsive.verticalVariants,
	visibility: responsive.visibility,
	layoutVariants: responsive.layoutVariants,
	sampledViewports: responsive.sampledViewports,
}
const integratedResponsive = new Map<string, Set<string>>()
for (const node of integratedNodes) {
	const fields = responsiveFields(node.responsive)
	if (!fields) continue
	const values = integratedResponsive.get(normalizedAnchor(node)) ?? new Set<string>()
	values.add(stable(fields)); integratedResponsive.set(normalizedAnchor(node), values)
}
const layerReports = []
for (const entry of layerEntries) {
	const layer = await readJson(entry.path)
	if (layer.sha256 !== entry.sha256)
		throw new Error(`responsive layer hash mismatch: ${entry.dimension}:${entry.value}`)
	const errors = (layer.value.diagnostics ?? []).filter((item: any) => item.severity === "error")
	if (errors.length) throw new Error(`responsive layer has error diagnostics: ${entry.dimension}:${entry.value}`)
	let responsiveRecords = 0, projectedRecords = 0
	for (const node of walk(layer.value.root)) {
		const fields = responsiveFields(node.responsive)
		if (!fields) continue
		responsiveRecords++
		if (integratedResponsive.get(normalizedAnchor(node))?.has(stable(fields))) projectedRecords++
	}
	const label = `${entry.dimension}:${entry.value}`
	const composedProjectedRecords = compositionReport.value.composition
		?.projectedResponsiveRecordsByLayer?.[label] ?? 0
	const matchedFrontiers = compositionReport.value.composition?.matchedFrontiers?.[label] ?? 0
	const matchedAbsentFrontiers = compositionReport.value.composition
		?.matchedAbsentFrontiers?.[label] ?? 0
	// Some application states are represented by structural absence (a closed
	// popover or side panel). The framework composer accepts that only after an
	// exact/stable source-identity check proves the owner is absent from this
	// state's capture. Such a layer has no responsive subtree to project.
	if (matchedAbsentFrontiers < 1 && (composedProjectedRecords < 1 || matchedFrontiers < 1))
		violations.push(`responsive layer was not composed into an eligible state frontier: ${label}`)
	layerReports.push({ ...entry, actualSha256: layer.sha256, responsiveRecords,
		directAnchorMatches: projectedRecords, composedProjectedRecords, matchedFrontiers,
		matchedAbsentFrontiers })
}
if (compositionReport.value.output?.sha256 !== integrated.sha256)
	violations.push("composition report output hash does not match integrated IR")
if (compositionReport.value.responsiveManifest?.sha256 !== manifest.sha256)
	violations.push("composition report responsive manifest hash does not match")

const sourceRevisions = [...new Set(integratedNodes.map((node) => node.attributes?.source_revision)
	.filter((item): item is string => typeof item === "string" && item.length > 0))].sort()
if (sourceRevisions.length !== 1 || sourceRevisions[0] !== manifest.value.sourceRevision)
	violations.push(`integrated source revision mismatch: ${sourceRevisions.join(", ")}`)
const errorDiagnostics = (integrated.value.diagnostics ?? []).filter((item: any) => item.severity === "error")
if (errorDiagnostics.length) violations.push(`integrated IR has ${errorDiagnostics.length} error diagnostics`)
const deferredAssetDiagnostics = (integrated.value.diagnostics ?? []).filter((item: any) =>
	String(item.kind ?? item.code ?? "").includes("unsupported_observed_image_deferred"))
if (deferredAssetDiagnostics.length)
	violations.push(`integrated IR has ${deferredAssetDiagnostics.length} deferred image diagnostics`)

const report = {
	schema: "palot-responsive-state-integration-verification-v1",
	passed: violations.length === 0,
	violations,
	inputs: {
		base: { path: base.path, sha256: base.sha256 },
		integrated: { path: integrated.path, sha256: integrated.sha256 },
		responsiveManifest: { path: manifest.path, sha256: manifest.sha256 },
		compositionReport: { path: compositionReport.path, sha256: compositionReport.sha256 },
		bindings: { path: bindings.path, sha256: bindings.sha256 },
	},
	preservation: {
		fontFamilyAssets: (integrated.value.fontFamilyAssets ?? []).length,
		assets: integrated.value.assetManifest?.assets?.length ?? 0,
		importedActions: integratedActions,
		emptyActionBindings: {
			protectedBase: baseEmptyActionBindings,
			integrated: integratedEmptyActionBindings,
			introducedByComposition: integratedEmptyActionBindings - baseEmptyActionBindings,
			details: emptyActionDetails(integratedNodes),
		},
		requiredActions,
		nativeComposerActions: [...nativeComposerActions].sort(),
		criticalInteractionAndOverlayRecords: integratedNodes.map(criticalInteraction).filter(Boolean).length,
		sourceRevisions,
	},
	responsiveLayers: layerReports,
}
await writeFile(outputPath, JSON.stringify(report, null, 2) + "\n")
if (violations.length) {
	console.error(`responsive/state integration RED (${violations.length} violations): ${outputPath}`)
	process.exitCode = 1
} else console.log(`responsive/state integration verified: ${outputPath}`)
