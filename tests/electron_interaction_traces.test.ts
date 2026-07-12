import { expect, test } from "bun:test"
import { readFile } from "node:fs/promises"

test("controlled Electron activation covers every captured interaction candidate", async () => {
	const evidence = JSON.parse(
		await readFile("evidence/phase-b/electron-interaction-traces.v1.json", "utf8"),
	)
	const candidates = JSON.parse(
		await readFile("evidence/phase-b/interaction-candidates.generated.v1.json", "utf8"),
	)
	expect(evidence.schema).toBe("burl-electron-interaction-trace-v1")
	expect(evidence.sourceRevision).toBe("fd63a75dad3d0e8555ba22a47e720d285889fbf0")
	expect(evidence.summary.total).toBe(candidates.summary.total)
	expect(evidence.summary.found).toBe(candidates.summary.total)
	expect(evidence.records.map((record: any) => record.sourceId)).toEqual(
		candidates.candidates.map((candidate: any) => candidate.sourceId),
	)
})

test("each observed IPC trace joins to a static preload-to-main contract", async () => {
	const evidence = JSON.parse(
		await readFile("evidence/phase-b/electron-interaction-traces.v1.json", "utf8"),
	)
	const traced = evidence.records.flatMap((record: any) => record.traces)
	expect(evidence.summary.ipcProducing).toBeGreaterThan(0)
	expect(traced.length).toBeGreaterThan(0)
	for (const trace of traced) {
		expect(trace.activation).toMatch(/^candidate-\d{2}$/)
		expect(trace.ipcContract).not.toBeNull()
		expect(trace.ipcContract.status.startsWith("mapped-")).toBe(true)
		expect(trace.ipcContract.channel).toBe(trace.channel)
	}
})

test("runtime action identity is structural and never inferred from a label", async () => {
	const source = await readFile("scripts/capture-electron-interaction-traces.ts", "utf8")
	expect(source).toContain("normalized-structural-source-id")
	expect(source).toContain("candidate.sourceId")
	expect(source).not.toContain("candidate.accessibleName")
	expect(source).not.toContain("candidate.evidence.accessibleName")
})
