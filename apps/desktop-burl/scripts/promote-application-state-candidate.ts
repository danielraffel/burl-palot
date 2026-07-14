#!/usr/bin/env bun
import { createHash } from "node:crypto"
import { readFile, writeFile } from "node:fs/promises"
import { pathToFileURL } from "node:url"
import { resolve } from "node:path"

const args = new Map<string, string>()
for (let index = 2; index < process.argv.length; index += 2) args.set(process.argv[index], process.argv[index + 1])
const defaultPath = resolve(args.get("--default") ?? "")
const candidatePath = resolve(args.get("--candidate") ?? "")
const outputPath = resolve(args.get("--output") ?? "")
const reportPath = resolve(args.get("--report") ?? "")
const burl = resolve(args.get("--burl-source") ?? "")
const overlayCandidatePath = args.get("--overlay-contract-candidate")
	? resolve(args.get("--overlay-contract-candidate")!) : ""
if (!defaultPath || !candidatePath || !outputPath || !reportPath || !burl)
	throw new Error("required: --default --candidate --output --report --burl-source")

const [defaultBytes, candidateBytes] = await Promise.all([readFile(defaultPath), readFile(candidatePath)])
const document = JSON.parse(defaultBytes.toString("utf8"))
const candidate = JSON.parse(candidateBytes.toString("utf8"))
if (candidate.schema !== "pulp-composed-application-state-candidate-v1")
	throw new Error("unexpected protected candidate schema")
const defaultSha256 = createHash("sha256").update(defaultBytes).digest("hex")
if (candidate.defaultSource?.sha256 !== defaultSha256)
	throw new Error("protected candidate is not based on the fresh default DesignIR")
const importer = await import(pathToFileURL(resolve(burl, "packages/pulp-import-ir/src/index.ts")).href)
const deferredAssets: Array<{ dimension: string; sourceRevision: string; source_node_id: string; uri: string }> = []
const stateAssetManifests: Array<{ version: 1; assets: Array<{ asset_id: string; [key: string]: unknown }> }> = []
const actionTransitionAttachments: Array<{ dimension: string; attachments: unknown[] }> = []
const dimensions = Object.values(candidate.stateCandidates ?? {}).map((state: any) => {
	const attachments = importer.attachApplicationStateActionTransitions(
		state.root, state.stateTransitions ?? [])
	actionTransitionAttachments.push({ dimension: state.key, attachments })
	const converted = importer.toNativeDesignIrV1(state.root, {
		sourceFile: document.sourceFile ?? defaultPath,
		importedAt: document.imported_at,
		sourceRevision: state.revision,
		unsupportedObservedImagePolicy: "defer",
	})
	stateAssetManifests.push(converted.assetManifest as typeof stateAssetManifests[number])
	for (const diagnostic of converted.diagnostics ?? []) {
		if (diagnostic?.kind !== "unsupported_observed_image_deferred") continue
		deferredAssets.push({
			dimension: state.key,
			sourceRevision: state.revision,
			source_node_id: diagnostic.source_node_id,
			uri: diagnostic.uri,
		})
	}
	return {
		key: state.key,
		root: converted.root,
		requiredActions: state.applicationActions ?? [],
		when: state.applicability ?? [],
		preserveWholeTreeBranches: state.mode === "whole-tree",
		defaultValue: (state.stateTransitions ?? []).find((transition: any) => transition.key === state.key)?.before,
	}
})
const maxNodeGrowthRatio = Number(args.get("--max-node-growth-ratio") ?? "4")
const maxIdentityDuplication = Number(args.get("--max-identity-duplication") ?? "8")
const promoted = importer.composeApplicationStateDimensions(document.root, dimensions,
	{ maxNodeGrowthRatio, maxIdentityDuplication })
let promotedRoot = promoted.root
let overlayCandidate: any = undefined
let overlayIdentityRebases: any[] = []
if (overlayCandidatePath) {
	overlayCandidate = JSON.parse(await readFile(overlayCandidatePath, "utf8"))
	if (overlayCandidate.schema !== "pulp-observed-overlay-contract-candidate-v1" ||
		!Array.isArray(overlayCandidate.contracts) || overlayCandidate.diagnostics?.length)
		throw new Error("overlay contract candidate is not promotion-ready")
	const byBinding = new Map<string, any[]>()
	const indexBindings = (node: any) => {
		const binding = node.attributes?.pulpHostAction
		if (binding) byBinding.set(binding, [...(byBinding.get(binding) ?? []), node])
		for (const child of node.children ?? []) indexBindings(child)
	}
	indexBindings(promotedRoot)
	const triggerRebasedContracts = overlayCandidate.contracts.map((contract: any) => {
		if (!contract.triggerBindingId) return contract
		const matches = byBinding.get(contract.triggerBindingId) ?? []
		if (matches.length !== 1)
			throw new Error(`overlay trigger binding ${contract.triggerBindingId} matched ${matches.length} nodes`)
		return { ...contract, triggerNodeSourceId: matches[0].source_node_id }
	})
	const contentRebase = importer.rebaseObservedOverlayContractContentIdentities(
		promotedRoot, triggerRebasedContracts)
	overlayIdentityRebases = contentRebase.rebases
	promotedRoot = importer.applyObservedOverlayContracts(promotedRoot, contentRebase.contracts)
}
const finalActionTransitionAttachments = importer.attachApplicationStateActionTransitions(
	promotedRoot, candidate.actionStateContracts ?? [])
const unresolvedDeferredAssets: typeof deferredAssets = []
const visitPromoted = (node: any) => {
	const sourceRevision = node?.attributes?.source_revision
	for (const asset of deferredAssets) {
		if (sourceRevision === asset.sourceRevision && node?.source_node_id === asset.source_node_id)
			unresolvedDeferredAssets.push(asset)
	}
	for (const child of node?.children ?? []) visitPromoted(child)
}
visitPromoted(promotedRoot)
if (unresolvedDeferredAssets.length) {
	const details = unresolvedDeferredAssets
		.map((asset) => `${asset.dimension}:${asset.source_node_id} (${asset.uri})`).join(", ")
	throw new Error(`unsupported observed images survived minimal state-frontier composition: ${details}`)
}
const outputDocument = { ...document, root: promotedRoot,
	assetManifest: importer.mergeNativeAssetManifests(document.assetManifest, ...stateAssetManifests) }
const outputBytes = JSON.stringify(outputDocument, null, 2) + "\n"
await writeFile(outputPath, outputBytes)
await writeFile(reportPath, JSON.stringify({
	schema: "pulp-application-state-promotion-report-v1",
	default: { path: defaultPath, sha256: defaultSha256 },
	protectedCandidate: { path: candidatePath, sha256: createHash("sha256").update(candidateBytes).digest("hex") },
	promoted: { path: outputPath, sha256: createHash("sha256").update(outputBytes).digest("hex") },
	composition: promoted.report,
	actionStateContracts: candidate.actionStateContracts,
	actionClassifications: candidate.actionClassifications,
	actionTransitionAttachments,
	finalActionTransitionAttachments,
	overlayContractCandidate: overlayCandidatePath ? {
		path: overlayCandidatePath,
		sha256: createHash("sha256").update(await readFile(overlayCandidatePath)).digest("hex"),
		contractCount: overlayCandidate.contracts.length,
		identityRebases: overlayIdentityRebases,
	} : null,
	deferredCandidateAssets: {
		count: deferredAssets.length,
		survivingCount: 0,
		assets: deferredAssets,
	},
}, null, 2) + "\n")
console.log(`${dimensions.length} protected dimensions promoted to ${outputPath}`)
