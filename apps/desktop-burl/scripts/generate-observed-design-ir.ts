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
if (!burlSource || !semanticsPath || !outputPath || !sourceRevision || !importedAt) {
	throw new Error("required: --burl-source --semantics --output --source-revision --imported-at")
}

const modulePath = resolve(burlSource, "packages/pulp-import-ir/src/index.ts")
const importer = await import(pathToFileURL(modulePath).href)
const semantics = JSON.parse(await readFile(semanticsPath, "utf8"))
if (!semantics.observedDom) throw new Error("source semantics has no observedDom tree")

const lowered = importer.lowerObservedDom(semantics.observedDom, importedAt)
const designIr = importer.toNativeDesignIrV1(lowered, {
	sourceFile: semanticsPath,
	importedAt,
	sourceRevision,
})
await writeFile(outputPath, JSON.stringify(designIr, null, 2) + "\n")
