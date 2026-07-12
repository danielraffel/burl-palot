#!/usr/bin/env bun

import { createHash } from "node:crypto"
import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { basename, dirname, resolve } from "node:path"
import sharp from "sharp"

interface SemanticNode {
	sourceId: string
	tagName: string
	text: string
	outerHtml: string
	attributes: Record<string, string>
	computedStyle: Record<string, string>
	rect: { x: number; y: number; width: number; height: number }
	children: SemanticNode[]
}

interface Selector {
	tagName?: string
	text?: string
	descendantText?: string
	attributes?: Record<string, string>
}

interface ComponentSpec {
	id: string
	state: string
	selector: Selector
	expectedSourceId: string
}

interface Manifest {
	schemaVersion: number
	scenario: string
	source: {
		png: string
		semantics: string
		pngSha256: string
		semanticsSha256: string
		pixelWidth: number
		pixelHeight: number
		devicePixelRatio: number
	}
	components: ComponentSpec[]
}

const sha256 = (data: Uint8Array | string) => createHash("sha256").update(data).digest("hex")

const canonical = (value: unknown): string => {
	if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`
	if (value && typeof value === "object") {
		const record = value as Record<string, unknown>
		return `{${Object.keys(record)
			.sort()
			.map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
			.join(",")}}`
	}
	return JSON.stringify(value)
}

const flatten = (root: SemanticNode): SemanticNode[] => [root, ...root.children.flatMap(flatten)]
const descendantText = (node: SemanticNode): string =>
	[node.text, ...node.children.map(descendantText)].join(" ").trim().replace(/\s+/g, " ")

export const resolveSelector = (nodes: SemanticNode[], selector: Selector): SemanticNode => {
	const matches = nodes.filter((node) => {
		if (selector.tagName !== undefined && node.tagName !== selector.tagName) return false
		if (selector.text !== undefined && node.text !== selector.text) return false
		if (selector.descendantText !== undefined && descendantText(node) !== selector.descendantText)
			return false
		return Object.entries(selector.attributes ?? {}).every(
			([key, value]) => node.attributes[key] === value,
		)
	})
	if (matches.length !== 1) {
		throw new Error(`selector resolved ${matches.length} nodes: ${canonical(selector)}`)
	}
	return matches[0]
}

const paintKeys = ["backgroundColor", "color", "border", "borderRadius", "boxShadow", "opacity"]
const fontKeys = [
	"fontFamily",
	"fontSize",
	"fontWeight",
	"lineHeight",
	"letterSpacing",
	"whiteSpace",
	"textAlign",
]
const pick = (source: Record<string, string>, keys: string[]) =>
	Object.fromEntries(keys.map((key) => [key, source[key] ?? ""]))

export async function generateSourceComponentReferences(
	manifestPath: string,
	outputPath: string,
): Promise<void> {
	const absoluteManifest = resolve(manifestPath)
	const manifestDirectory = dirname(absoluteManifest)
	const manifestBytes = await readFile(absoluteManifest)
	const manifest = JSON.parse(manifestBytes.toString("utf8")) as Manifest
	if (manifest.schemaVersion !== 1)
		throw new Error(`unsupported schemaVersion ${manifest.schemaVersion}`)
	if (manifest.components.length !== 8)
		throw new Error(`expected eight component references, got ${manifest.components.length}`)

	const pngPath = resolve(manifestDirectory, manifest.source.png)
	const semanticsPath = resolve(manifestDirectory, manifest.source.semantics)
	const [pngBytes, semanticsBytes] = await Promise.all([readFile(pngPath), readFile(semanticsPath)])
	if (sha256(pngBytes) !== manifest.source.pngSha256) throw new Error("stale source PNG hash")
	if (sha256(semanticsBytes) !== manifest.source.semanticsSha256)
		throw new Error("stale source semantics hash")

	const metadata = await sharp(pngBytes).metadata()
	if (
		metadata.width !== manifest.source.pixelWidth ||
		metadata.height !== manifest.source.pixelHeight
	) {
		throw new Error(`source PNG geometry mismatch: ${metadata.width}x${metadata.height}`)
	}
	const semantics = JSON.parse(semanticsBytes.toString("utf8"))
	if (semantics.capture.devicePixelRatio !== manifest.source.devicePixelRatio)
		throw new Error("source DPR mismatch")
	const nodes = flatten(semantics.observedDom as SemanticNode)

	await rm(outputPath, { recursive: true, force: true })
	await mkdir(outputPath, { recursive: true })
	const references = []
	for (const component of manifest.components) {
		const node = resolveSelector(nodes, component.selector)
		if (node.sourceId !== component.expectedSourceId) {
			throw new Error(`${component.id}: stale sourceId ${node.sourceId}`)
		}
		const dpr = manifest.source.devicePixelRatio
		const left = Math.floor(node.rect.x * dpr)
		const top = Math.floor(node.rect.y * dpr)
		const right = Math.ceil((node.rect.x + node.rect.width) * dpr)
		const bottom = Math.ceil((node.rect.y + node.rect.height) * dpr)
		if (
			left < 0 ||
			top < 0 ||
			right > manifest.source.pixelWidth ||
			bottom > manifest.source.pixelHeight
		) {
			throw new Error(`${component.id}: crop lies outside source image`)
		}
		const cropName = `${component.id}.png`
		const crop = await sharp(pngBytes)
			.extract({ left, top, width: right - left, height: bottom - top })
			.png({ compressionLevel: 9, adaptiveFiltering: false, palette: false })
			.toBuffer()
		await writeFile(resolve(outputPath, cropName), crop)
		const evidence = {
			id: component.id,
			state: component.state,
			selector: component.selector,
			sourceId: node.sourceId,
			semantic: {
				tagName: node.tagName,
				text: node.text,
				descendantText: descendantText(node),
				attributes: node.attributes,
			},
			geometry: {
				logical: node.rect,
				pixel: { left, top, width: right - left, height: bottom - top },
				devicePixelRatio: dpr,
			},
			paint: pick(node.computedStyle, paintKeys),
			font: pick(node.computedStyle, fontKeys),
			action: {
				role: node.attributes.role ?? "",
				ariaLabel: node.attributes["aria-label"] ?? "",
				ariaExpanded: node.attributes["aria-expanded"] ?? "",
				ariaDisabled: node.attributes["aria-disabled"] ?? "",
				dataSlot: node.attributes["data-slot"] ?? "",
				cursor: node.computedStyle.cursor ?? "",
			},
			crop: { file: cropName, sha256: sha256(crop) },
		}
		references.push({ ...evidence, evidenceSha256: sha256(canonical(evidence)) })
	}

	const index = {
		schemaVersion: 1,
		scenario: manifest.scenario,
		manifest: { file: basename(absoluteManifest), sha256: sha256(manifestBytes) },
		source: {
			pngSha256: manifest.source.pngSha256,
			semanticsSha256: manifest.source.semanticsSha256,
			pixelWidth: manifest.source.pixelWidth,
			pixelHeight: manifest.source.pixelHeight,
			devicePixelRatio: manifest.source.devicePixelRatio,
		},
		references,
	}
	await writeFile(resolve(outputPath, "evidence.json"), `${JSON.stringify(index, null, 2)}\n`)
}

if (import.meta.main) {
	const manifest = process.argv[2] ?? "evidence/phase-b/source-components/source-components.v1.json"
	const output = process.argv[3] ?? "evidence/phase-b/source-components/generated-v1"
	await generateSourceComponentReferences(manifest, output)
}
