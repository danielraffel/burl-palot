#!/usr/bin/env bun

import { createHash } from "node:crypto"
import { readFile, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"

const args = new Map<string, string>()
for (let index = 2; index < process.argv.length; index += 2)
	args.set(process.argv[index], process.argv[index + 1])

const requiredArguments = ["--input", "--interaction-evidence", "--output", "--report", "--burl-source"] as const
if (requiredArguments.some((name) => !args.get(name)))
	throw new Error("required: --input --interaction-evidence --output --report --burl-source")

const inputPath = resolve(args.get("--input")!)
const evidencePath = resolve(args.get("--interaction-evidence")!)
const outputPath = resolve(args.get("--output")!)
const reportPath = resolve(args.get("--report")!)
const burlSource = resolve(args.get("--burl-source")!)

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex")
const readJson = async (path: string) => {
	const bytes = await readFile(path)
	return { path, bytes, sha256: sha256(bytes), value: JSON.parse(bytes.toString("utf8")) }
}

const [input, evidence] = await Promise.all([readJson(inputPath), readJson(evidencePath)])
if (!input.value.root || typeof input.value.root !== "object")
	throw new Error("input is missing a DesignIR root")

const importer = await import(pathToFileURL(resolve(burlSource, "packages/pulp-import-ir/src/index.ts")).href)
const projection = importer.applyTrustedInteractionPayloadReceipts(input.value.root, evidence.value)
const outputBytes = Buffer.from(`${JSON.stringify(input.value, null, 2)}\n`)
await writeFile(outputPath, outputBytes)
await writeFile(reportPath, `${JSON.stringify({
	schema: "trusted-interaction-payload-receipt-projection-v1",
	input: { path: input.path, sha256: input.sha256 },
	interactionEvidence: { path: evidence.path, sha256: evidence.sha256 },
	output: { path: outputPath, sha256: sha256(outputBytes) },
	projection,
}, null, 2)}\n`)
console.log(`trusted interaction payload receipts applied at ${outputPath}`)
