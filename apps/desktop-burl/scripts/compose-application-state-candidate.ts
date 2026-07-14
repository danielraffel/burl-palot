#!/usr/bin/env bun
import { createHash } from "node:crypto"
import { readFile, writeFile } from "node:fs/promises"
import { resolve } from "node:path"

const args = new Map<string, string>()
for (let index = 2; index < process.argv.length; index += 2) args.set(process.argv[index], process.argv[index + 1])
const defaultPath = resolve(args.get("--default") ?? "")
const outputPath = resolve(args.get("--output") ?? "")
const candidatePaths = (args.get("--state-candidates") ?? "").split(",").filter(Boolean).map((path) => resolve(path))
const interactionPaths = (args.get("--interaction-evidence") ?? "").split(",").filter(Boolean).map((path) => resolve(path))
const routeNativeActions = new Set((args.get("--route-native-actions") ?? "").split(",").filter(Boolean))
const applicabilityPath = args.get("--applicability-contract") ? resolve(args.get("--applicability-contract")!) : ""
if (!defaultPath || !outputPath || candidatePaths.length === 0) throw new Error("missing composed candidate arguments")

const readJson = async (path: string) => {
	const bytes = await readFile(path)
	return { path, sha256: createHash("sha256").update(bytes).digest("hex"), value: JSON.parse(bytes.toString("utf8")) }
}
const base = await readJson(defaultPath)
const states = await Promise.all(candidatePaths.map(readJson))
const interactions = await Promise.all(interactionPaths.map(readJson))
const applicability = applicabilityPath ? await readJson(applicabilityPath) : undefined
if (applicability && applicability.value.schema !== "pulp-application-state-applicability-contract-v1")
	throw new Error("unexpected application-state applicability contract schema")
const keys = states.map(({ value }) => value.key)
if (keys.some((key) => typeof key !== "string" || !key)) throw new Error("state candidate without application-state key")
if (new Set(keys).size !== keys.length) throw new Error(`duplicate application-state key: ${keys.join(", ")}`)
for (const [key, predicates] of Object.entries(applicability?.value.dimensions ?? {})) {
	if (!keys.includes(key)) throw new Error(`applicability contract references unknown dimension ${key}`)
	if (!Array.isArray(predicates) || predicates.some((predicate: any) => !predicate?.key || !predicate?.value || predicate.key === key))
		throw new Error(`invalid applicability predicates for ${key}`)
}
const actionStateContracts = states.flatMap(({ value }) => value.stateTransitions ?? [])
const actions = new Set<string>()
for (const { value } of states) for (const action of value.applicationActions ?? []) actions.add(action)
for (const action of routeNativeActions) actions.add(action)
for (const contract of actionStateContracts) {
	const state = states.find(({ value }) => value.key === contract.key)?.value
	const names = new Set(Object.keys(state?.pageUrls ?? {}))
	if (!state || contract.action === "" || contract.before === contract.after ||
		!names.has(contract.before) || !names.has(contract.after))
		throw new Error(`invalid action-state contract: ${contract.action}:${contract.before}>${contract.after}`)
}
const actionClassifications = [...actions].sort().map((action) => ({ action,
	classification: actionStateContracts.some((contract) => contract.action === action)
		? "source-observed-visual-state"
		: routeNativeActions.has(action) ? "route-native-service-only" : "uncaptured",
}))

await writeFile(outputPath, JSON.stringify({
	schema: "pulp-composed-application-state-candidate-v1",
	defaultSource: { path: base.path, sha256: base.sha256 },
	stateSources: states.map(({ path, sha256, value }) => ({ path, sha256, key: value.key,
		applicability: applicability?.value.dimensions?.[value.key] ?? [] })),
	applicabilitySource: applicability && { path: applicability.path, sha256: applicability.sha256 },
	interactionSources: interactions.map(({ path, sha256 }) => ({ path, sha256 })),
	default: base.value,
	stateCandidates: Object.fromEntries(states.map(({ value }) => [value.key, {
		...value, applicability: applicability?.value.dimensions?.[value.key] ?? [],
	}])),
	actionStateContracts,
	actionClassifications,
	interactionEvidence: interactions.map(({ value }) => value),
}, null, 2) + "\n")
console.log(`${keys.length} application-state dimensions composed at ${outputPath}`)
