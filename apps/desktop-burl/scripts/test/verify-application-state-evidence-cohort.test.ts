import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))

async function fixture(sourceCohort: string) {
	const root = await mkdtemp(join(tmpdir(), "palot-state-cohort-"))
	roots.push(root)
	const capture = join(root, "capture")
	const evidence = join(root, "evidence")
	await mkdir(capture)
	await mkdir(evidence)
	const cohort = "a".repeat(64)
	const policy = { sourceRevision: "revision", viewport: { width: 800, height: 600, deviceScaleFactor: 2 },
		cohortSha256: cohort, runtimeState: { mode: "explicit-storage-seed", sha256: "b".repeat(64) } }
	await writeFile(join(capture, "source.json"), JSON.stringify({ policy: { ...policy, cohortSha256: sourceCohort } }))
	await writeFile(join(capture, "source.png"), "png")
	await writeFile(join(capture, "meta.json"), "{}")
	await writeFile(join(evidence, "interactions.json"), JSON.stringify({ policy, scenarios: [] }))
	const manifest = join(root, "manifest.json")
	await writeFile(manifest, JSON.stringify({ output: evidence, sourceRevision: "revision", viewport: policy.viewport,
		initialStateCapture: { state: "initial", output: capture }, scenarios: [] }))
	return manifest
}

describe("application state evidence capture cohort", () => {
	test("accepts structural captures from the interaction cohort", async () => {
		const manifest = await fixture("a".repeat(64))
		const run = Bun.spawnSync([process.execPath, resolve(import.meta.dir, "../verify-application-state-evidence.ts"),
			"--manifest", manifest])
		expect(run.exitCode).toBe(0)
	})

	test("rejects a runtime-state capture from another cohort", async () => {
		const manifest = await fixture("c".repeat(64))
		const run = Bun.spawnSync([process.execPath, resolve(import.meta.dir, "../verify-application-state-evidence.ts"),
			"--manifest", manifest])
		expect(run.exitCode).not.toBe(0)
		expect(run.stderr.toString()).toContain("crosses interaction capture cohort")
	})
})
