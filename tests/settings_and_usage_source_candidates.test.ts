import { describe, expect, test } from "bun:test"
import { readFile } from "node:fs/promises"

const settingsCandidatePath =
	"evidence/phase-b/contract-candidates/settings-navigation.candidate.v1.json"
const settingsEvidencePath =
	"evidence/phase-b/source-interaction-states/generated-v5/navigation/settings/evidence.json"
const usageCandidatePath =
	"evidence/phase-b/contract-candidates/usage-popover.candidate.v1.json"
const usageEvidencePath =
	"evidence/phase-b/source-interaction-states/generated-v5/topbar/usage-popover/evidence.json"

async function json(path: string) {
	return JSON.parse(await readFile(path, "utf8"))
}

function slotElements(capture: any, dataSlot: string): any[] {
	return capture.elements.filter((element: any) => element.dataSlot === dataSlot)
}

function sidebarWidth(capture: any): number {
	const sidebars = slotElements(capture, "sidebar")
	expect(sidebars).toHaveLength(1)
	return sidebars[0].rect.width
}

function expandedPopoverTrigger(capture: any): any | undefined {
	return slotElements(capture, "popover-trigger").find(
		(element: any) => element.ariaExpanded === "true",
	)
}

function route(capture: any): string {
	return new URL(capture.capture.url).hash.replace(/^#/, "")
}

describe("settings navigation source candidate", () => {
	test("records an atomic collapsed, open, and settings route transition", async () => {
		const evidence = await json(settingsEvidencePath)
		const records = Object.fromEntries(evidence.records.map((record: any) => [record.state, record]))

		expect(Object.keys(records)).toEqual(["sidebar-collapsed", "sidebar-open", "settings-general"])
		for (const record of evidence.records) {
			expect(record.atomicity.stableBeforeScreenshot).toBe(true)
			expect(record.atomicity.stableAfterScreenshot).toBe(true)
		}
		expect(records["settings-general"].targetObservation).toMatchObject({
			tagName: "button",
			role: "button",
			accessibleName: "Settings",
			dataSlot: "sidebar-menu-button",
			normalizedText: "Settings",
			observedActionAttribute: null,
		})
	})

	test("proves sidebar geometry and the redirected route mechanically", async () => {
		const candidate = await json(settingsCandidatePath)
		const captures = Object.fromEntries(
			await Promise.all(
				candidate.semanticPostconditions.map(async (postcondition: any) => [
					postcondition.state,
					await json(postcondition.capture),
				]),
			),
		)

		expect(sidebarWidth(captures["sidebar-collapsed"])).toBe(0)
		expect(sidebarWidth(captures["sidebar-open"])).toBe(280)
		expect(sidebarWidth(captures["settings-general"])).toBe(280)
		expect(route(captures["sidebar-collapsed"])).toContain("/session/")
		expect(route(captures["sidebar-open"])).toContain("/session/")
		expect(route(captures["settings-general"])).toBe("/settings/general")
	})

	test("uses semantic targeting and remains unpromoted", async () => {
		const [candidate, manifest] = await Promise.all([
			json(settingsCandidatePath),
			json("evidence/phase-b/state-captures/settings-navigation.candidate.interactions.json"),
		])
		const activation = manifest.scenarios.find(
			(scenario: any) => scenario.id === "activate-settings",
		)

		expect(activation.action.target.descendantText).toBe("Settings")
		expect(activation.action.target.selector).not.toMatch(/nth-(child|of-type)/)
		expect(candidate.status).toBe("candidate-only")
		expect(candidate.canonicalActionId).toBeNull()
		expect(candidate.promotion.allowed).toBe(false)
		for (const entry of candidate.sourceProvenance) {
			expect(entry.sourcePath.startsWith("/")).toBe(false)
			expect(entry.sourceSha256).toMatch(/^[0-9a-f]{64}$/)
		}
	})
})

describe("usage popover source candidate", () => {
	test("records an atomic open and toggle-dismiss transition", async () => {
		const evidence = await json(usageEvidencePath)
		const records = Object.fromEntries(evidence.records.map((record: any) => [record.state, record]))

		expect(Object.keys(records)).toEqual(["closed", "open", "closed-after-dismiss"])
		for (const record of evidence.records) {
			expect(record.atomicity.stableBeforeScreenshot).toBe(true)
			expect(record.atomicity.stableAfterScreenshot).toBe(true)
		}
		for (const state of ["open", "closed-after-dismiss"]) {
			expect(records[state].targetObservation).toMatchObject({
				tagName: "button",
				role: "button",
				accessibleName: "",
				dataSlot: "popover-trigger",
				observedActionAttribute: null,
			})
		}
	})

	test("proves aria-expanded and dialog postconditions mechanically", async () => {
		const candidate = await json(usageCandidatePath)
		const captures = Object.fromEntries(
			await Promise.all(
				candidate.semanticPostconditions.map(async (postcondition: any) => [
					postcondition.state,
					await json(postcondition.capture),
				]),
			),
		)

		expect(expandedPopoverTrigger(captures.closed)).toBeUndefined()
		expect(slotElements(captures.closed, "popover-content")).toHaveLength(0)
		expect(expandedPopoverTrigger(captures.open)).toBeDefined()
		expect(slotElements(captures.open, "popover-content")).toHaveLength(1)
		expect(slotElements(captures.open, "popover-content")[0].role).toBe("dialog")
		expect(expandedPopoverTrigger(captures["closed-after-dismiss"])).toBeUndefined()
		expect(slotElements(captures["closed-after-dismiss"], "popover-content")).toHaveLength(0)
	})

	test("records the source accessibility defect without promoting it", async () => {
		const candidate = await json(usageCandidatePath)

		expect(candidate.status).toBe("candidate-only")
		expect(candidate.canonicalActionId).toBeNull()
		expect(candidate.operationCandidate.trigger.accessibleName).toBe("")
		expect(candidate.accessibilityGap.observed).toBe(true)
		expect(candidate.accessibilityGap.promotionRequirement).toContain("non-empty accessible name")
		expect(candidate.promotion.allowed).toBe(false)
		for (const entry of candidate.sourceProvenance) {
			expect(entry.sourcePath.startsWith("/")).toBe(false)
			expect(entry.sourceSha256).toMatch(/^[0-9a-f]{64}$/)
		}
	})
})
