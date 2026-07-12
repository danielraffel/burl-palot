import { expect, test } from "bun:test"
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"

const framework = process.env.BURL_SOURCE_DIR

test.skipIf(!framework)("generates byte-identical, provenance-bearing IPC evidence", async () => {
	const source = await mkdtemp(path.join(tmpdir(), "palot-ipc-source-"))
	await mkdir(path.join(source, "apps/desktop/src/preload"), { recursive: true })
	await mkdir(path.join(source, "apps/desktop/src/main"), { recursive: true })
	await writeFile(
		path.join(source, "apps/desktop/src/preload/index.ts"),
		'import { contextBridge, ipcRenderer } from "electron"\ncontextBridge.exposeInMainWorld("palot", { open: () => ipcRenderer.invoke("file:open") })\n',
	)
	await writeFile(
		path.join(source, "apps/desktop/src/main/files.ts"),
		'import { ipcMain } from "electron"\nipcMain.handle("file:open", () => true)\n',
	)
	for (const args of [["init"], ["add", "."], ["-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-m", "fixture"]]) {
		const result = spawnSync("git", ["-C", source, ...args], { encoding: "utf8" })
		expect(result.status).toBe(0)
	}
	const revision = spawnSync("git", ["-C", source, "rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim()
	const outputs = await mkdtemp(path.join(tmpdir(), "palot-ipc-output-"))
	const first = path.join(outputs, "first.json")
	const second = path.join(outputs, "second.json")
	for (const output of [first, second]) {
		const result = spawnSync(
			process.execPath,
			["scripts/generate-electron-ipc-map.mjs", "--burl", framework, "--source", source, "--source-revision", revision, "--out", output],
			{ encoding: "utf8" },
		)
		expect(result.status, result.stderr).toBe(0)
	}
	expect(await readFile(first, "utf8")).toBe(await readFile(second, "utf8"))
	const report = JSON.parse(await readFile(first, "utf8"))
	expect(report.verdict).toBe("pass")
	expect(report.source.rootLabel).toBe("palot")
	expect(report.generator.frameworkRevision).toMatch(/^[a-f0-9]{40}$/)
	expect(report.mappings[0].renderer.siteSha256).toMatch(/^[a-f0-9]{64}$/)
})

test("committed IPC evidence is complete and provenance-bearing", async () => {
	const report = JSON.parse(await readFile("evidence/phase-b/electron-ipc-map.v1.json", "utf8"))
	expect(report.schema).toBe("burl-electron-ipc-map-v1")
	expect(report.source.revision).toBe("fd63a75dad3d0e8555ba22a47e720d285889fbf0")
	expect(report.verdict).toBe("pass")
	expect(report.summary.dynamicSites).toBe(0)
	expect(report.summary.missingMainHandlers).toBe(0)
	expect(report.mappings.length).toBeGreaterThan(0)
	for (const mapping of report.mappings) {
		expect(mapping.status.startsWith("mapped-")).toBe(true)
		expect(mapping.renderer.fileSha256).toMatch(/^[a-f0-9]{64}$/)
		expect(mapping.renderer.siteSha256).toMatch(/^[a-f0-9]{64}$/)
		expect(mapping.main.length).toBeGreaterThan(0)
	}
})

test.skipIf(!framework)("rejects a source revision other than the reviewed revision", async () => {
	const result = spawnSync(
		process.execPath,
		["scripts/generate-electron-ipc-map.mjs", "--burl", framework, "--source", process.cwd(), "--source-revision", "0000000000000000000000000000000000000000", "--out", path.join(tmpdir(), "must-not-exist.json")],
		{ encoding: "utf8" },
	)
	expect(result.status).toBe(1)
	expect(result.stderr).toContain("source revision mismatch")
})
