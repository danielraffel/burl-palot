#!/usr/bin/env bun
import { createHash } from "node:crypto"
import { readFile, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"

const args = new Map<string, string>()
for (let index = 2; index < process.argv.length; index += 2)
	args.set(process.argv[index], process.argv[index + 1])
for (const required of ["--burl-source", "--target", "--authority", "--output", "--report"])
	if (!args.get(required)) throw new Error(`missing required argument ${required}`)

const burl = resolve(args.get("--burl-source")!)
const targetPath = resolve(args.get("--target")!)
const authorityPath = resolve(args.get("--authority")!)
const outputPath = resolve(args.get("--output")!)
const reportPath = resolve(args.get("--report")!)
if (outputPath === targetPath) throw new Error("visual-state rebase output must be a staging candidate")

const [targetBytes, authorityBytes] = await Promise.all([
	readFile(targetPath), readFile(authorityPath),
])
const target = JSON.parse(targetBytes.toString("utf8"))
const authority = JSON.parse(authorityBytes.toString("utf8"))
if (!target?.root || !authority?.root) throw new Error("visual-state rebase requires two Native DesignIR documents")
const importer = await import(pathToFileURL(resolve(burl,
	"packages/pulp-import-ir/src/index.ts")).href)
const rebased = importer.rebaseAuthoritativeVisualState(target.root, authority.root)
if (!rebased.report.rebasedTargetNodeCount)
	throw new Error("authoritative visual state matched no target nodes")

const output = {
	...target,
	sourceFile: authority.sourceFile,
	imported_at: authority.imported_at,
	root: rebased.root,
}
const outputBytes = `${JSON.stringify(output, null, 2)}\n`
await writeFile(outputPath, outputBytes)
const sha256 = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex")
await writeFile(reportPath, `${JSON.stringify({
	schema: "burl-authoritative-visual-state-rebase-report-v1",
	target: { path: targetPath, sha256: sha256(targetBytes) },
	authority: { path: authorityPath, sha256: sha256(authorityBytes),
		sourceFile: authority.sourceFile, importedAt: authority.imported_at },
	output: { path: outputPath, sha256: sha256(outputBytes) },
	...rebased.report,
}, null, 2)}\n`)
console.log(`${rebased.report.rebasedTargetNodeCount} composed nodes visually rebased at ${outputPath}`)
