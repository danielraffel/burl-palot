import { createHash } from "node:crypto"
import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { describe, expect, test } from "bun:test"
import { generateSourceComponentReferences } from "../scripts/generate-source-component-references"

const digestTree = async (directory: string) => {
	const files = (await readdir(directory)).sort()
	return Promise.all(files.map(async (file) => ({
		file,
		sha256: createHash("sha256").update(await readFile(join(directory, file))).digest("hex"),
	})))
}

const manifestPath = resolve("evidence/phase-b/source-components/source-components.v1.json")

describe("source component reference generator", () => {
	test("emits eight byte-identical DPR2 references on rerun", async () => {
		const temporary = await mkdtemp(join(tmpdir(), "palot-source-components-"))
		const first = join(temporary, "first")
		const second = join(temporary, "second")
		await generateSourceComponentReferences(manifestPath, first)
		await generateSourceComponentReferences(manifestPath, second)
		expect(await digestTree(first)).toEqual(await digestTree(second))
		const evidence = JSON.parse(await readFile(join(first, "evidence.json"), "utf8"))
		expect(evidence.references).toHaveLength(8)
		for (const reference of evidence.references) {
			expect(reference.geometry.devicePixelRatio).toBe(2)
			expect(reference.crop.sha256).toHaveLength(64)
			expect(reference.evidenceSha256).toHaveLength(64)
		}
	})

	test("fails closed on stale source hash", async () => {
		const temporary = await mkdtemp(join(tmpdir(), "palot-source-hash-"))
		const manifest = JSON.parse(await readFile(manifestPath, "utf8"))
		manifest.source.pngSha256 = "0".repeat(64)
		const localManifest = join(temporary, "manifest.json")
		manifest.source.png = resolve("evidence/visual-parity/baselines/01-shell/source.png")
		manifest.source.semantics = resolve("evidence/visual-parity/baselines/01-shell/source-semantics.json")
		await writeFile(localManifest, JSON.stringify(manifest))
		expect(generateSourceComponentReferences(localManifest, join(temporary, "output"))).rejects.toThrow("stale source PNG hash")
	})

	test("fails closed on missing and ambiguous semantic selectors", async () => {
		const temporary = await mkdtemp(join(tmpdir(), "palot-source-selectors-"))
		for (const [name, selector, expected] of [
			["missing", { tagName: "not-a-real-element" }, "selector resolved 0 nodes"],
			["ambiguous", { tagName: "button" }, "selector resolved"],
		] as const) {
			const manifest = JSON.parse(await readFile(manifestPath, "utf8"))
			manifest.source.png = resolve("evidence/visual-parity/baselines/01-shell/source.png")
			manifest.source.semantics = resolve("evidence/visual-parity/baselines/01-shell/source-semantics.json")
			manifest.components[0].selector = selector
			const localManifest = join(temporary, `${name}.json`)
			await writeFile(localManifest, JSON.stringify(manifest))
			expect(generateSourceComponentReferences(localManifest, join(temporary, name))).rejects.toThrow(expected)
		}
	})
})
