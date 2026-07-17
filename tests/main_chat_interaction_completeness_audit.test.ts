import { readFile } from "node:fs/promises"
import { describe, expect, test } from "bun:test"

describe("main chat source interaction completeness audit", () => {
	test("classifies every visible source candidate exactly once", async () => {
		const base = "evidence/visual-parity/source-interaction-completeness-current"
		const candidates = JSON.parse(await readFile(`${base}/interaction-candidates.json`, "utf8"))
		const audit = JSON.parse(await readFile(`${base}/audit.v1.json`, "utf8"))
		expect(candidates.summary.total).toBe(49)
		expect(candidates.summary.missingEvidence).toBe(0)
		expect(audit.candidateCount).toBe(candidates.candidates.length)
		const ordinals = audit.dispositions.flatMap((entry: any) => entry.ordinals)
		expect(new Set(ordinals).size).toBe(ordinals.length)
		expect([...ordinals].sort((a: number, b: number) => a - b)).toEqual(
			Array.from({ length: candidates.candidates.length }, (_, index) => index + 1),
		)
		expect(
			new Set(audit.dispositions.map((entry: any) => entry.classification)),
		).toEqual(
			new Set(["imported-transition", "native-local-action", "overlay-contract", "missing"]),
		)
		for (const candidate of candidates.candidates) {
			expect(candidate.evidence).not.toBeNull()
			expect(candidate.modalities.length).toBeGreaterThan(0)
			expect(candidate.discoveredBy.length).toBeGreaterThan(0)
		}
	})

	test("keeps the exact production-harness failures explicit", async () => {
		const audit = JSON.parse(
			await readFile(
				"evidence/visual-parity/source-interaction-completeness-current/audit.v1.json",
				"utf8",
			),
		)
		expect(audit.nativeHarness.missingViewportObservations).toBe(15)
		expect(audit.nativeHarness.missingLogicalControls).toEqual([
			"Thought",
			"Read",
			"Edit",
			"View in diff panel",
			"Scroll to top",
			"Fork from here",
			"Undo from here",
		])
	})
})
