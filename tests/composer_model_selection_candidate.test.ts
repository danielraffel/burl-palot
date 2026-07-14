import { describe, expect, test } from "bun:test"
import { readFile } from "node:fs/promises"

const candidatePath =
	"evidence/phase-b/contract-candidates/composer-model-selection.candidate.v1.json"
const evidencePath =
	"evidence/phase-b/source-interaction-states/generated-v5/composer/model-selection/evidence.json"

async function json(path: string) {
	return JSON.parse(await readFile(path, "utf8"))
}

function countSlot(capture: any, dataSlot: string): number {
	return capture.elements.filter((element: any) => element.dataSlot === dataSlot).length
}

function triggerExpanded(capture: any): string | null {
	const triggers = capture.elements.filter(
		(element: any) => element.dataSlot === "searchable-list-popover-trigger",
	)
	expect(triggers).toHaveLength(1)
	return triggers[0].ariaExpanded
}

describe("composer model selection source candidate", () => {
	test("records a real atomic open and selection transition", async () => {
		const evidence = await json(evidencePath)
		const records = Object.fromEntries(evidence.records.map((record: any) => [record.state, record]))

		expect(Object.keys(records)).toEqual(["closed", "open", "selected"])
		for (const record of evidence.records) {
			expect(record.atomicity.stableBeforeScreenshot).toBe(true)
			expect(record.atomicity.stableAfterScreenshot).toBe(true)
		}
		expect(records.open.targetObservation.normalizedText).toBe("Claude Opus 4.6")
		expect(records.selected.targetObservation).toMatchObject({
			tagName: "button",
			normalizedText: "Claude Sonnet 4",
			descendantText: "Claude Sonnet 4",
		})
	})

	test("proves the semantic postconditions mechanically", async () => {
		const candidate = await json(candidatePath)
		const captures = Object.fromEntries(
			await Promise.all(
				candidate.semanticPostconditions.map(async (postcondition: any) => [
					postcondition.state,
					await json(postcondition.capture),
				]),
			),
		)

		expect(triggerExpanded(captures.closed)).toBe("false")
		expect(countSlot(captures.closed, "searchable-list-popover-content")).toBe(0)
		expect(triggerExpanded(captures.open)).toBe("true")
		expect(countSlot(captures.open, "searchable-list-popover-content")).toBe(1)
		expect(triggerExpanded(captures.selected)).toBe("false")
		expect(countSlot(captures.selected, "searchable-list-popover-content")).toBe(0)
	})

	test("keeps source-derived payload fields unpromoted", async () => {
		const candidate = await json(candidatePath)
		expect(candidate.status).toBe("candidate-only")
		expect(candidate.canonicalActionId).toBeNull()
		expect(candidate.promotion.allowed).toBe(false)
		expect(candidate.operationCandidate.payloadCandidate).toEqual({
			providerID: "anthropic",
			modelID: "claude-sonnet-4-20250514",
		})
		expect(candidate.payloadProvenance.map((entry: any) => entry.field)).toEqual([
			"providerID",
			"modelID",
			"payload-shape",
			"selection-semantics",
		])
		for (const entry of candidate.payloadProvenance) {
			expect(entry.sourcePath.startsWith("/")).toBe(false)
			expect(entry.sourceSha256).toMatch(/^[0-9a-f]{64}$/)
		}
	})

	test("documents the exact absence of an independent provider control", async () => {
		const candidate = await json(candidatePath)
		expect(candidate.operationCandidate.kind).toBe("combined-provider-model-selection")
		expect(candidate.providerControlAudit.independentProviderControlExposed).toBe(false)
		expect(candidate.providerControlAudit.exactAbsence).toContain(
			"No independent provider trigger",
		)
		expect(candidate.providerControlAudit.exactAbsence).toContain("combined model picker")
	})

	test("uses semantic text targeting rather than ordinal selectors", async () => {
		const manifest = await json(
			"evidence/phase-b/state-captures/composer-model-selection.candidate.interactions.json",
		)
		const selection = manifest.scenarios.find(
			(scenario: any) => scenario.id === "select-observed-model",
		)
		expect(selection.action.target.descendantText).toBe("Claude Sonnet 4")
		expect(selection.action.target.selector).not.toMatch(/nth-(child|of-type)/)
	})
})
