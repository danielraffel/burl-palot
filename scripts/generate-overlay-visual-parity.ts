#!/usr/bin/env bun

import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import sharp from "sharp"

const [manifestArg, outputArg, burlArg] = process.argv.slice(2)
if (!manifestArg || !outputArg || !burlArg)
	throw new Error("usage: generate-overlay-visual-parity.ts <manifest> <output> <burl-source>")

const manifestPath = resolve(manifestArg)
const output = resolve(outputArg)
const burl = resolve(burlArg)
const manifest = JSON.parse(await readFile(manifestPath, "utf8"))
if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.records) || !manifest.records.length)
	throw new Error("invalid overlay visual parity manifest")
const importer = await import(
	pathToFileURL(resolve(burl, "packages/pulp-import-ir/src/index.ts")).href
)

const flatten = (node: any): any[] => [node, ...(node.children ?? []).flatMap(flatten)]
await rm(output, { recursive: true, force: true })
await mkdir(resolve(output, "ir"), { recursive: true })
await mkdir(resolve(output, "source"), { recursive: true })

const records = []
for (const spec of manifest.records) {
	const capturePath = resolve(dirname(manifestPath), spec.capture)
	const capture = JSON.parse(await readFile(capturePath, "utf8"))
	const semantics = capture.semantics
	if (!semantics?.observedDom || !semantics.capture?.devicePixelRatio)
		throw new Error(`${spec.id}: capture lacks atomic ObservedDOM semantics`)
	const matches = flatten(semantics.observedDom).filter(
		(node: any) => node.attributes?.["data-slot"] === spec.dataSlot,
	)
	if (matches.length !== 1)
		throw new Error(`${spec.id}: data-slot ${spec.dataSlot} resolved ${matches.length} nodes`)
	const node = JSON.parse(JSON.stringify(matches[0]))
	if (node.attributes?.["data-starting-style"] !== undefined ||
		node.computedStyle.opacity !== "1" || node.computedStyle.transform !== "none")
		throw new Error(`${spec.id}: capture retained a transient entry-animation state`)

	const dpr = semantics.capture.devicePixelRatio
	const left = Math.floor(node.rect.x * dpr)
	const top = Math.floor(node.rect.y * dpr)
	const right = Math.ceil((node.rect.x + node.rect.width) * dpr)
	const bottom = Math.ceil((node.rect.y + node.rect.height) * dpr)
	const pixel = { width: right - left, height: bottom - top }
	const screenshotPath = resolve(dirname(capturePath), "source.png")
	const sourceCrop = resolve(output, "source", `${spec.id}.png`)
	await sharp(screenshotPath).extract({ left, top, ...pixel }).png().toFile(sourceCrop)

	const lowered = importer.lowerObservedDom(node, "2026-07-13T00:00:00.000Z")
	const inlineSvgCaptures = flatten(node)
		.filter((child: any) => child.tagName === "svg" && child.outerHtml)
		.map((child: any) => ({
			sourceId: child.sourceId,
			outerHTML: child.outerHtml,
			computedColor: child.computedStyle.color,
		}))
	const ir = importer.toNativeDesignIrV1(lowered, {
		sourceFile: capturePath,
		importedAt: "2026-07-13T00:00:00.000Z",
		sourceRevision: manifest.sourceRevision,
		platformFonts: importer.macosSkiaPlatformFontContract,
		inlineSvgCaptures,
	})
	const irFile = `ir/${spec.id}.json`
	await writeFile(resolve(output, irFile), `${JSON.stringify(ir, null, 2)}\n`)
	records.push({
		id: spec.id,
		state: "open",
		sourceId: node.sourceId,
		irFile,
		sourceCrop,
		pixel,
		logical: node.rect,
		devicePixelRatio: dpr,
		interaction: { kind: spec.interactionKind, applicationBindingRequired: false },
		visualThresholds: spec.visualThresholds,
	})
}

await writeFile(
	resolve(output, "manifest.json"),
	`${JSON.stringify({ schemaVersion: 1, records }, null, 2)}\n`,
)
