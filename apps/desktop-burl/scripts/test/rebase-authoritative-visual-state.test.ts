import { describe, expect, test } from "bun:test"
import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { resolve } from "node:path"

describe("authoritative visual-state candidate orchestration", () => {
	test("stages a transparent visual rebase without overwriting its composed target", async () => {
		const directory = await mkdtemp(resolve(tmpdir(), "burl-visual-state-rebase-"))
		const target = resolve(directory, "target.json")
		const authority = resolve(directory, "authority.json")
		const output = resolve(directory, "candidate.json")
		const report = resolve(directory, "report.json")
		const sourceId = "dom/html-shape-opaque:0/body-shape-body:0/div-id-root:0"
		await writeFile(target, JSON.stringify({ sourceFile: "opaque.json", imported_at: "old", root: {
			source_node_id: "dom/html-shape-opaque:0/body-shape-body:0", style: { backgroundColor: "#181818ff", height: 800 },
			children: [{ source_node_id: sourceId, style: { backgroundColor: "#0d0d0dff", minWidth: 800 },
				responsive: { horizontal: { min: 800 } }, children: [] }],
		} }))
		await writeFile(authority, JSON.stringify({ sourceFile: "transparent.json", imported_at: "new", root: {
			source_node_id: "dom/html-shape-glass:0/body-shape-body:0", style: { backgroundColor: "#00000000", height: 800 },
			children: [{ source_node_id: sourceId.replace("html-shape-opaque", "html-shape-glass"),
				style: { backgroundColor: "#0d0d0d2e", minWidth: 1200 }, children: [] }],
		} }))
		const child = Bun.spawn({ cmd: [process.execPath, resolve(import.meta.dir, "../rebase-authoritative-visual-state.ts"),
			"--burl-source", resolve(import.meta.dir, "../../../../../burl-wt-native-migration-feasibility"),
			"--target", target, "--authority", authority, "--output", output, "--report", report],
			stdout: "pipe", stderr: "pipe" })
		expect(await child.exited).toBe(0)
		const staged = JSON.parse(await readFile(output, "utf8"))
		expect(staged.sourceFile).toBe("transparent.json")
		expect(staged.root.style).toEqual({ height: 800, backgroundColor: "#00000000" })
		expect(staged.root.children[0].style).toEqual({ minWidth: 800, backgroundColor: "#0d0d0d2e" })
		expect(staged.root.children[0].responsive).toEqual({ horizontal: { min: 800 } })
		expect(JSON.parse(await readFile(target, "utf8")).root.style.backgroundColor).toBe("#181818ff")
		expect(JSON.parse(await readFile(report, "utf8")).schema)
			.toBe("burl-authoritative-visual-state-rebase-report-v1")
	})
})
