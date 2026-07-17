#!/usr/bin/env bun

import { createHash } from "node:crypto"
import { readFile, writeFile } from "node:fs/promises"
import { pathToFileURL } from "node:url"
import { resolve } from "node:path"

const args = new Map<string, string>()
for (let index = 2; index < process.argv.length; index += 2)
	args.set(process.argv[index], process.argv[index + 1])
const inputPath = resolve(args.get("--input") ?? "")
const receiptsPath = resolve(args.get("--receipts") ?? "")
const outputPath = resolve(args.get("--output") ?? "")
const reportPath = resolve(args.get("--report") ?? "")
const burlSource = resolve(args.get("--burl-source") ?? "")
if (!inputPath || !receiptsPath || !outputPath || !reportPath || !burlSource)
	throw new Error("required: --input --receipts --output --report --burl-source")

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex")
const readJson = async (path: string) => {
	const bytes = await readFile(path)
	return { bytes, value: JSON.parse(bytes.toString("utf8")) }
}
const [input, receipts] = await Promise.all([readJson(inputPath), readJson(receiptsPath)])
if (!input.value.root || receipts.value.schema !== "consumer-invocation-payload-receipts-v1")
	throw new Error("invocation payload projection input is invalid")
const importer = await import(pathToFileURL(
	resolve(burlSource, "packages/pulp-import-ir/src/index.ts"),
).href)
const projection = importer.applyInvocationPayloadReceipts(input.value.root, receipts.value.receipts)
const outputBytes = Buffer.from(`${JSON.stringify(input.value, null, 2)}\n`)
await writeFile(outputPath, outputBytes)
await writeFile(reportPath, `${JSON.stringify({
	schema: "consumer-invocation-payload-projection-v1",
	input: { path: inputPath, sha256: sha256(input.bytes) },
	receipts: { path: receiptsPath, sha256: sha256(receipts.bytes) },
	output: { path: outputPath, sha256: sha256(outputBytes) },
	projection,
}, null, 2)}\n`)
console.log(JSON.stringify({ projections: projection.length, output: outputPath }))
