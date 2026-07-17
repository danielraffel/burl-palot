#!/usr/bin/env bun

import { createHash } from "node:crypto"
import { readFile, writeFile } from "node:fs/promises"
import { pathToFileURL } from "node:url"
import { resolve } from "node:path"

const args = new Map<string, string>()
for (let index = 2; index < process.argv.length; index += 2)
	args.set(process.argv[index], process.argv[index + 1])
const manifestPath = resolve(args.get("--manifest") ?? "")
const tracePath = resolve(args.get("--trace") ?? "")
const outputPath = resolve(args.get("--output") ?? "")
const burlSource = resolve(args.get("--burl-source") ?? "")
if (!manifestPath || !tracePath || !outputPath || !burlSource)
	throw new Error("required: --manifest --trace --output --burl-source")

const readJson = async (path: string) => {
	const bytes = await readFile(path)
	return { bytes, value: JSON.parse(bytes.toString("utf8")) }
}
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex")
const [manifest, trace] = await Promise.all([readJson(manifestPath), readJson(tracePath)])
if (manifest.value.schema !== "consumer-invocation-payload-capture-v1" ||
	!Array.isArray(manifest.value.receipts) || !manifest.value.receipts.length)
	throw new Error("invocation payload manifest is invalid")
const importer = await import(pathToFileURL(
	resolve(burlSource, "packages/pulp-import-ir/src/index.ts"),
).href)
const receipts = manifest.value.receipts.map((entry: any) => {
	const matches = trace.value.records
		.map((record: any, index: number) => ({ record, index }))
		.filter(({ record }: any) => record.sourceId === entry.sourceId)
	if (matches.length !== 1)
		throw new Error(`${entry.action}: expected one source record and found ${matches.length}`)
	return importer.captureInvocationPayloadReceipt(trace.value, matches[0].index, entry)
})
const document = {
	schema: "consumer-invocation-payload-receipts-v1",
	inputs: {
		manifest: { path: manifestPath, sha256: sha256(manifest.bytes) },
		trace: { path: tracePath, sha256: sha256(trace.bytes) },
	},
	receipts,
}
await writeFile(outputPath, `${JSON.stringify(document, null, 2)}\n`)
console.log(JSON.stringify({ receipts: receipts.length, output: outputPath }))
