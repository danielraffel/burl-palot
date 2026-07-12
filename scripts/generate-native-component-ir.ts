#!/usr/bin/env bun

import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { pathToFileURL } from "node:url"

type Node = { sourceId: string; children: Node[] }
const flatten = (node: Node): Node[] => [node, ...node.children.flatMap(flatten)]

const [manifestArg, sourceEvidenceArg, outputArg, burlArg] = process.argv.slice(2)
if (!manifestArg || !sourceEvidenceArg || !outputArg || !burlArg) {
	throw new Error(
		"usage: generate-native-component-ir.ts <manifest> <source-evidence> <output> <burl-source>",
	)
}
const manifestPath = resolve(manifestArg)
const evidencePath = resolve(sourceEvidenceArg)
const output = resolve(outputArg)
const burl = resolve(burlArg)
const manifest = JSON.parse(await readFile(manifestPath, "utf8"))
const sourceEvidence = JSON.parse(await readFile(evidencePath, "utf8"))
const semanticsPath = resolve(dirname(manifestPath), manifest.source.semantics)
const semantics = JSON.parse(await readFile(semanticsPath, "utf8"))
const nodes = new Map(flatten(semantics.observedDom).map((node) => [node.sourceId, node]))
const importer = await import(
	pathToFileURL(resolve(burl, "packages/pulp-import-ir/src/index.ts")).href
)

await rm(output, { recursive: true, force: true })
await mkdir(resolve(output, "ir"), { recursive: true })
const records = []
for (const source of sourceEvidence.references) {
	const node = nodes.get(source.sourceId)
	if (!node) throw new Error(`${source.id}: source node is absent`)
	const lowered = importer.lowerObservedDom(node, "2026-07-11T00:00:00.000Z")
	const ir = importer.toNativeDesignIrV1(lowered, {
		sourceFile: semanticsPath,
		importedAt: "2026-07-11T00:00:00.000Z",
		sourceRevision: manifest.source.semanticsSha256,
		platformFonts: importer.macosSkiaPlatformFontContract,
	})
	const irFile = `ir/${source.id}.json`
	await writeFile(resolve(output, irFile), `${JSON.stringify(ir, null, 2)}\n`)
	records.push({
		id: source.id,
		state: source.state,
		sourceId: source.sourceId,
		irFile,
		sourceCrop: resolve(dirname(evidencePath), source.crop.file),
		pixel: source.geometry.pixel,
		logical: source.geometry.logical,
		devicePixelRatio: source.geometry.devicePixelRatio,
		interaction: source.interaction,
	})
}
await writeFile(
	resolve(output, "manifest.json"),
	`${JSON.stringify({ schemaVersion: 1, records }, null, 2)}\n`,
)
