#!/usr/bin/env bun
import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { verifyTrustedInteractionReceipt } from "./application-state-interaction-receipts"

const args = new Map<string, string>()
for (let index = 2; index < process.argv.length; index += 2) args.set(process.argv[index], process.argv[index + 1])
const basePath = resolve(args.get("--default") ?? "")
const candidatePath = resolve(args.get("--candidate") ?? "")
if (!basePath || !candidatePath) throw new Error("missing composed verification arguments")
const [baseBytes, candidateBytes] = await Promise.all([readFile(basePath), readFile(candidatePath)])
const base = JSON.parse(baseBytes.toString("utf8"))
const candidate = JSON.parse(candidateBytes.toString("utf8"))
if (candidate.schema !== "pulp-composed-application-state-candidate-v1") throw new Error("unexpected composed candidate schema")
const sha256 = createHash("sha256").update(baseBytes).digest("hex")
if (candidate.defaultSource?.sha256 !== sha256) throw new Error("default source hash mismatch")

const stable = (value: unknown) => JSON.stringify(value, (_key, child) => child && typeof child === "object" && !Array.isArray(child)
	? Object.fromEntries(Object.entries(child).sort(([a], [b]) => a.localeCompare(b))) : child)
const collect = (root: unknown, predicate: (value: any) => boolean, project: (value: any) => unknown) => {
	const found: string[] = []
	const visit = (value: any) => {
		if (!value || typeof value !== "object") return
		if (predicate(value)) found.push(stable(project(value)))
		for (const child of Array.isArray(value) ? value : Object.values(value)) visit(child)
	}
	visit(root); return found.sort()
}
const receipts = (root: unknown) => collect(root, (value) => value.transitionToNext !== undefined,
	(value) => ({ anchor: value.stable_anchor_id ?? null, transitionToNext: value.transitionToNext }))
const responsive = (root: unknown) => collect(root,
	(value) => Array.isArray(value.layoutVariants) || Array.isArray(value.sampledViewports),
	(value) => ({ anchor: value.stable_anchor_id ?? null, layoutVariants: value.layoutVariants ?? [], sampledViewports: value.sampledViewports ?? [] }))
const requiredActions = (root: unknown) => new Set(collect(root,
	(value) => typeof value.actionBindingId === "string" || typeof value["data-pulp-action"] === "string",
	(value) => value.actionBindingId ?? value["data-pulp-action"]).map(JSON.parse))
const assertMultisetEqual = (label: string, expected: string[], actual: string[]) => {
	if (expected.length !== actual.length || expected.some((value, index) => value !== actual[index]))
		throw new Error(`${label} changed: expected ${expected.length}, found ${actual.length}`)
}
assertMultisetEqual("motion receipt", receipts(base), receipts(candidate.default))
assertMultisetEqual("responsive variant", responsive(base), responsive(candidate.default))
const actions = requiredActions(base)
for (const state of Object.values(candidate.stateCandidates ?? {}) as any[]) {
	for (const action of state.applicationActions ?? []) actions.add(action)
	for (const action of requiredActions(state.root)) actions.add(action)
}
const composedActions = new Set<string>()
for (const state of Object.values(candidate.stateCandidates ?? {}) as any[]) {
	for (const action of state.applicationActions ?? []) composedActions.add(action)
	for (const action of requiredActions(state.root)) composedActions.add(action)
}
for (const action of requiredActions(base)) composedActions.add(action)
for (const action of actions) if (!composedActions.has(action)) throw new Error(`lost required action key: ${action}`)

let trustedPointers = 0
let trustedKeyActivations = 0
const trustedActivationActions = new Set<string>()
for (const evidence of candidate.interactionEvidence ?? []) for (const scenario of evidence.scenarios ?? []) {
	const receipt = verifyTrustedInteractionReceipt(scenario)
	if (receipt.pointer) {
		trustedPointers++
		if (scenario.binding?.action) trustedActivationActions.add(scenario.binding.action)
	} else if (receipt.keyboard) {
		trustedKeyActivations++
		if (scenario.binding?.action) trustedActivationActions.add(scenario.binding.action)
	}
}
if (trustedPointers === 0) throw new Error("composed candidate has no trusted pointer receipts")

const expectedContracts = (Object.values(candidate.stateCandidates ?? {}) as any[])
	.flatMap((state) => state.stateTransitions ?? [])
if (stable(expectedContracts) !== stable(candidate.actionStateContracts ?? []))
	throw new Error("top-level action-state contracts do not exactly preserve state candidates")
const classifications = new Map<string, string>((candidate.actionClassifications ?? [])
	.map((entry: any) => [entry.action, entry.classification]))
for (const state of Object.values(candidate.stateCandidates ?? {}) as any[]) {
	const names = new Set(Object.keys(state.pageUrls ?? {}))
	for (const action of state.applicationActions ?? [])
		if (!classifications.has(action)) throw new Error(`action lacks explicit classification: ${action}`)
	for (const contract of state.stateTransitions ?? []) {
		if (contract.key !== state.key || !names.has(contract.before) || !names.has(contract.after) ||
			contract.before === contract.after)
			throw new Error(`invalid exact transition contract: ${contract.action}:${contract.before}>${contract.after}`)
	}
}
for (const [action, classification] of classifications) {
	const contracts = expectedContracts.filter((contract: any) => contract.action === action)
	if (classification === "source-observed-visual-state") {
		if (contracts.length === 0) throw new Error(`visual-state action lacks exact transition: ${action}`)
		if (!trustedActivationActions.has(action)) throw new Error(`visual-state action lacks trusted pointer or keyboard activation receipt: ${action}`)
	} else if (classification === "route-native-service-only") {
		if (contracts.length !== 0) throw new Error(`route/native-only action unexpectedly claims visual state: ${action}`)
	} else if (classification === "uncaptured") {
		if (contracts.length !== 0) throw new Error(`uncaptured action unexpectedly claims visual state: ${action}`)
	} else throw new Error(`unknown action classification for ${action}: ${classification}`)
}

const stateValues = Object.values(candidate.stateCandidates ?? {}) as any[]
const rectOf = (node: any) => node?.raw_source?.node?.rect
const walkNodes = (root: any) => {
	const nodes: any[] = []; const visit = (node: any) => { if (!node || typeof node !== "object") return; nodes.push(node); for (const child of node.children ?? []) visit(child) }
	visit(root); return nodes
}
for (const state of stateValues) {
	const viewport = state.cohort?.viewport
	if (!viewport?.width || !viewport?.height) throw new Error(`state candidate ${state.key} lacks viewport geometry`)
	for (const node of walkNodes(state.root)) {
		const rect = rectOf(node)
		if (node.interaction?.required && (!rect || rect.width <= 0 || rect.height <= 0))
			throw new Error(`required action has no positive hit geometry: ${node.interaction.actionBindingId}`)
		if (node.raw_source?.node?.tagName?.toLowerCase() === "textarea" &&
			(!rect || rect.x < 0 || rect.y < 0 || rect.x + rect.width > viewport.width || rect.y + rect.height > viewport.height))
			throw new Error(`composer is not fully visible for ${state.key}`)
	}
}

// A collapsible leading pane must invalidate its parent layout. Derive the expected
// trailing gutter and reclaimed width from the observed expanded state; do not use
// application-specific width constants.
const sidebar = stateValues.find((state) => /sidebar/i.test(state.key))
if (sidebar) {
	const nodes = walkNodes(sidebar.root)
	const branches = nodes.filter((node) => node.responsive?.visibilityByApplicationState)
	const branchFor = (name: string) => branches.find((node) => node.responsive.visibilityByApplicationState[name] === true)
	const names = [...new Set(branches.flatMap((node) => Object.keys(node.responsive.visibilityByApplicationState)))]
	const expandedName = names.find((name) => /expanded|open/i.test(name)), collapsedName = names.find((name) => /collapsed|closed/i.test(name))
	if (!expandedName || !collapsedName) throw new Error("sidebar candidate lacks expanded/collapsed states")
	// Minimal state composition may place visibility directly on the surviving
	// geometry node instead of retaining a synthetic whole-state ancestor. Resolve
	// the pane by state membership first, then fall back to a retained branch.
	const insetFor = (name: string) => nodes.find((node) =>
		node.raw_source?.node?.attributes?.["data-slot"] === "sidebar-inset" &&
		node.responsive?.visibilityByApplicationState?.[name] === true) ??
		walkNodes(branchFor(name)).find((node) => node.raw_source?.node?.attributes?.["data-slot"] === "sidebar-inset")
	const expanded = rectOf(insetFor(expandedName)), collapsed = rectOf(insetFor(collapsedName))
	if (!expanded || !collapsed) throw new Error("sidebar states lack surviving main-pane geometry")
	const viewportWidth = sidebar.cohort.viewport.width
	const expandedRightGutter = viewportWidth - (expanded.x + expanded.width)
	const collapsedRightGutter = viewportWidth - (collapsed.x + collapsed.width)
	if (!(collapsed.x < expanded.x && collapsed.width > expanded.width &&
		Math.abs((expanded.x - collapsed.x) - (collapsed.width - expanded.width)) <= .5 &&
		Math.abs(collapsedRightGutter - expandedRightGutter) <= .5))
		throw new Error(`collapsed sidebar did not reflow surviving main pane: expanded ${expanded.x}+${expanded.width}, collapsed ${collapsed.x}+${collapsed.width}`)
}

console.log(`${receipts(base).length} motion receipts, ${responsive(base).length} responsive records, ${actions.size} action keys, ${trustedPointers} trusted pointer receipts, ${trustedKeyActivations} trusted keyboard receipts, ${expectedContracts.length} exact action-state contracts preserved`)
