#!/usr/bin/env bun

import { createHash } from "node:crypto"
import { readFile, writeFile } from "node:fs/promises"
import { pathToFileURL } from "node:url"
import { resolve } from "node:path"

const args = new Map<string, string>()
for (let index = 2; index < process.argv.length; index += 2)
	args.set(process.argv[index], process.argv[index + 1])
const basePath = resolve(args.get("--base") ?? "")
const manifestPath = resolve(args.get("--responsive-manifest") ?? "")
const outputPath = resolve(args.get("--output") ?? "")
const reportPath = resolve(args.get("--report") ?? "")
const burlSource = resolve(args.get("--burl-source") ?? "")
const expectedBaseSha256 = args.get("--expected-base-sha256") ?? ""
if (!basePath || !manifestPath || !outputPath || !reportPath || !burlSource || !expectedBaseSha256)
	throw new Error("required: --base --responsive-manifest --output --report --burl-source --expected-base-sha256")

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex")
const readJson = async (path: string) => {
	const bytes = await readFile(path)
	return { path, bytes, sha256: sha256(bytes), value: JSON.parse(bytes.toString("utf8")) }
}
const [base, manifest] = await Promise.all([readJson(basePath), readJson(manifestPath)])
if (base.sha256 !== expectedBaseSha256)
	throw new Error(`protected base hash mismatch: expected ${expectedBaseSha256}, found ${base.sha256}`)
if (manifest.value.schema !== "palot-responsive-application-state-layer-v1" ||
	manifest.value.compositionPolicy?.canonicalPromotionAllowed !== false ||
	manifest.value.compositionPolicy?.fatalStructuralIntervals !== 0)
	throw new Error("responsive layer manifest is not reviewable and fail-closed")

const dimensions = []
const layerSources = []
for (const [key, values] of Object.entries(manifest.value.dimensions ?? {})) {
	const roots: Record<string, any> = {}
	const whenByValue: Record<string, any[]> = {}
	for (const [value, entry] of Object.entries(values as Record<string, any>)) {
		const source = await readJson(entry.path)
		if (source.sha256 !== entry.sha256) throw new Error(`responsive layer hash mismatch: ${key}:${value}`)
		if ((source.value.diagnostics ?? []).some((item: any) => item.severity === "error"))
			throw new Error(`responsive layer has error diagnostics: ${key}:${value}`)
		roots[value] = source.value.root
		whenByValue[value] = entry.applicationStateWhen ?? []
		layerSources.push({ key, value, path: source.path, sha256: source.sha256 })
	}
	dimensions.push({ key, values: roots, whenByValue })
}
const importer = await import(pathToFileURL(resolve(burlSource, "packages/pulp-import-ir/src/index.ts")).href)
const composed = importer.composeResponsiveApplicationStateLayers(base.value.root, dimensions)
const document = { ...base.value, root: composed.root }
const outputBytes = Buffer.from(JSON.stringify(document, null, 2) + "\n")
await writeFile(outputPath, outputBytes)
await writeFile(reportPath, JSON.stringify({
	schema: "palot-responsive-state-composition-report-v1",
	base: { path: base.path, sha256: base.sha256 },
	responsiveManifest: { path: manifest.path, sha256: manifest.sha256 },
	layerSources,
	output: { path: outputPath, sha256: sha256(outputBytes) },
	composition: composed.report,
}, null, 2) + "\n")
console.log(`responsive application-state layers composed at ${outputPath}`)
