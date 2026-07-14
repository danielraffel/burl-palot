#!/usr/bin/env bun
import { readFile } from "node:fs/promises"
import { resolve } from "node:path"

const args = new Map<string, string>()
for (let index = 2; index < process.argv.length; index += 2) args.set(process.argv[index], process.argv[index + 1])
const policyPath = resolve(args.get("--policy") ?? "")
const extensionsPath = resolve(args.get("--extensions") ?? "")
const candidatePath = resolve(args.get("--candidate") ?? "")
if (!policyPath || !extensionsPath || !candidatePath)
	throw new Error("required: --policy --extensions --candidate")

const [policy, extensionDocument, candidate] = await Promise.all([
	readFile(policyPath, "utf8").then(JSON.parse),
	readFile(extensionsPath, "utf8").then(JSON.parse),
	readFile(candidatePath, "utf8").then(JSON.parse),
])
if (extensionDocument.schema !== "pulp-application-state-extension-contract-v1")
	throw new Error("unexpected application-state extension schema")

const publicRules = (policy.rules ?? []).filter((rule: any) => rule.attributes?.pulpHostAction)
const publicByAction = new Map<string, any>()
for (const rule of publicRules) {
	const action = rule.attributes.pulpHostAction
	if (publicByAction.has(action) && rule.attributes.pulpStateKey &&
		publicByAction.get(action).attributes?.pulpStateKey !== rule.attributes.pulpStateKey)
		throw new Error(`public action has conflicting state keys: ${action}`)
	if (!publicByAction.has(action) || rule.attributes.pulpStateKey) publicByAction.set(action, rule)
}
const extensions = new Map<string, any>()
for (const extension of extensionDocument.extensions ?? []) {
	if (extensions.has(extension.action)) throw new Error(`duplicate application-state extension: ${extension.action}`)
	if (!extension.action || !extension.stateKey || !Array.isArray(extension.values) || extension.values.length < 2)
		throw new Error(`invalid application-state extension: ${extension.action ?? "<missing>"}`)
	extensions.set(extension.action, extension)
}

const normalizeSourceId = (value: string) => value.replace(/^dom\/html-shape-[^/]+:\d+\//, "dom/")
const policyBySourceId = new Map<string, any>()
for (const rule of publicRules) if (rule.match?.sourceId)
	policyBySourceId.set(normalizeSourceId(rule.match.sourceId), rule)
const actionNodes = (root: any) => {
	const found: Array<{ action: string; sourceId: string }> = []
	const visit = (node: any) => {
		if (!node || typeof node !== "object") return
		const action = node.raw_source?.node?.attributes?.["data-pulp-action"] ?? node.actionBindingId
		const sourceId = node.raw_source?.node?.sourceId
		if (action && sourceId) found.push({ action, sourceId })
		for (const child of node.children ?? []) visit(child)
	}
	visit(root); return found
}
const expectedValues = (rule: any, extension: any) => {
	if (extension) return extension.values
	const transition = String(rule?.attributes?.pulpStateTransition ?? "")
	if (transition === "toggle") return ["closed", "open"]
	if (transition === "set:true") return ["false", "true"]
	if (transition.startsWith("cycle:")) return transition.slice(6).split(",")
	if (transition.startsWith("set:")) return []
	return []
}

const states = candidate.schema === "pulp-composed-application-state-candidate-v1"
	? Object.values(candidate.stateCandidates ?? {}) : [candidate]
let checked = 0
for (const state of states as any[]) {
	for (const { action, sourceId } of actionNodes(state.root)) {
		const publicRule = policyBySourceId.get(normalizeSourceId(sourceId))
		if (publicRule && publicRule.attributes.pulpHostAction !== action)
			throw new Error(`public action mismatch at ${sourceId}: expected ${publicRule.attributes.pulpHostAction}, found ${action}`)
	}
	for (const action of state.applicationActions ?? []) {
		const rule = publicByAction.get(action)
		const extension = extensions.get(action)
		if (!rule && !extension) throw new Error(`application-state action is neither public nor an explicit extension: ${action}`)
		const publicKey = rule?.attributes?.pulpStateKey
		if (publicKey && extension && extension.stateKey !== publicKey)
			throw new Error(`extension conflicts with public state key for ${action}: ${extension.stateKey} != ${publicKey}`)
		const expectedKey = publicKey ?? extension?.stateKey
		if (!expectedKey) throw new Error(`application-state action lacks a public or extension state key: ${action}`)
		if (state.key !== expectedKey) throw new Error(`state key mismatch for ${action}: expected ${expectedKey}, found ${state.key}`)
		const values = new Set(expectedValues(rule, extension))
		const publicTransition = String(rule?.attributes?.pulpStateTransition ?? "")
		const actionTransitions = (state.stateTransitions ?? []).filter((transition: any) => transition.action === action)
		if (actionTransitions.length === 0) throw new Error(`transition contract is not reconciled for ${action}`)
		for (const transition of actionTransitions) {
			if (transition.key !== expectedKey) throw new Error(`transition contract is not reconciled for ${action}`)
			if (values.size && (!values.has(transition.before) || !values.has(transition.after)))
				throw new Error(`state value mismatch for ${action}: ${transition.before}>${transition.after}; expected ${[...values].join(",")}`)
			if (publicTransition.startsWith("set:") && publicTransition !== "set:true" &&
				transition.after !== publicTransition.slice(4))
				throw new Error(`set-state value mismatch for ${action}: expected ${publicTransition.slice(4)}, found ${transition.after}`)
		}
		checked++
	}
}
if (candidate.schema === "pulp-composed-application-state-candidate-v1") {
	const trustedPointerActions = new Set<string>()
	for (const evidence of candidate.interactionEvidence ?? []) for (const scenario of evidence.scenarios ?? []) {
		const events = (scenario.events ?? []).filter((event: any) => event.isTrusted).map((event: any) => event.type)
		if (scenario.binding?.action && events.indexOf("pointerdown") >= 0 &&
			events.indexOf("pointerup") > events.indexOf("pointerdown") &&
			events.indexOf("click") > events.indexOf("pointerup")) trustedPointerActions.add(scenario.binding.action)
	}
	for (const entry of candidate.actionClassifications ?? []) {
		const rule = publicByAction.get(entry.action)
		const extension = extensions.get(entry.action)
		if (!rule && !extension) throw new Error(`classified action is neither public nor an explicit extension: ${entry.action}`)
		if (entry.classification === "route-native-service-only") {
			if (!rule) throw new Error(`route/native action is not declared by the public binding policy: ${entry.action}`)
			if (rule.attributes?.pulpStateKey) throw new Error(`stateful public action was misclassified as route/native-only: ${entry.action}`)
			if (!trustedPointerActions.has(entry.action)) throw new Error(`route/native action lacks trusted pointer evidence: ${entry.action}`)
		}
	}
}
if (!checked) throw new Error("candidate has no public application-state contracts")
console.log(`${checked} application-state contract(s) reconciled with public action IDs, state keys, and values`)
