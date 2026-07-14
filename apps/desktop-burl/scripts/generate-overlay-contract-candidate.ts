#!/usr/bin/env bun
import { createHash } from "node:crypto"
import { readFile, writeFile } from "node:fs/promises"
import { pathToFileURL } from "node:url"
import { dirname, resolve } from "node:path"

const args = new Map<string, string>()
for (let index = 2; index < process.argv.length; index += 2) args.set(process.argv[index], process.argv[index + 1])
const manifestPath = resolve(args.get("--manifest") ?? "")
const outputPath = resolve(args.get("--output") ?? "")
const burl = resolve(args.get("--burl-source") ?? "")
if (!manifestPath || !outputPath || !burl) throw new Error("required: --manifest --output --burl-source")

const importer = await import(pathToFileURL(resolve(burl, "packages/pulp-import-ir/src/index.ts")).href)
const manifestBytes = await readFile(manifestPath)
const manifest = JSON.parse(manifestBytes.toString("utf8"))
if (manifest.schema !== "pulp-observed-overlay-contract-manifest-v1" || !Array.isArray(manifest.records))
	throw new Error("unexpected overlay contract manifest schema")

const contracts: any[] = []
const diagnostics: any[] = []
const sources: any[] = []
for (const record of manifest.records) {
	const closedPath = resolve(record.closed)
	const openPath = resolve(record.open)
	const interactionPath = resolve(record.interactionEvidence)
	const [closedBytes, openBytes, interactionBytes] = await Promise.all([
		readFile(closedPath), readFile(openPath), readFile(interactionPath),
	])
	const closed = JSON.parse(closedBytes.toString("utf8"))
	const open = JSON.parse(openBytes.toString("utf8"))
	const interaction = JSON.parse(interactionBytes.toString("utf8"))
	const scenario = interaction.scenarios?.find((candidate: any) => candidate.id === record.scenarioId)
		?? interaction.records?.find((candidate: any) =>
			resolve(candidate.directory ?? "") === dirname(openPath))
	const targetSourceId = scenario?.target?.sourceId ?? scenario?.targetObservation?.sourceId
	if (!targetSourceId) throw new Error(`${record.id}: interaction target identity is absent`)
	const closedRoot = closed.observedDom ?? closed.semantics?.observedDom
	const openRoot = open.observedDom ?? open.semantics?.observedDom
	if (!closedRoot || !openRoot) throw new Error(`${record.id}: atomic ObservedDOM is absent`)
	const report = importer.extractObservedOverlayContracts(
		closedRoot,
		openRoot,
		[{ targetSourceId, event: record.activationEvent,
			openDelayMs: record.openDelayMs ?? 0 }],
		record.dismissals ?? [],
	)
	contracts.push(...report.contracts.map((contract: any) => ({
		...contract,
		...(record.triggerBindingId ? { triggerBindingId: record.triggerBindingId } : {}),
	})))
	diagnostics.push(...report.diagnostics.map((diagnostic: any) => ({ record: record.id, ...diagnostic })))
	sources.push({ id: record.id, closed: { path: closedPath, sha256: createHash("sha256").update(closedBytes).digest("hex") },
		open: { path: openPath, sha256: createHash("sha256").update(openBytes).digest("hex") },
		interactionEvidence: { path: interactionPath,
			sha256: createHash("sha256").update(interactionBytes).digest("hex"), scenarioId: record.scenarioId } })
}
await writeFile(outputPath, JSON.stringify({
	schema: "pulp-observed-overlay-contract-candidate-v1",
	manifest: { path: manifestPath, sha256: createHash("sha256").update(manifestBytes).digest("hex") },
	sources, contracts, diagnostics,
}, null, 2) + "\n")
if (diagnostics.length || contracts.length !== manifest.records.length)
	throw new Error(`overlay contract extraction failed: ${contracts.length} contracts, ${diagnostics.length} diagnostics`)
console.log(`${contracts.length} observed overlay contracts generated at ${outputPath}`)
