import { describe, expect, test } from "bun:test"
import { readFile } from "node:fs/promises"

const auditPath =
	"evidence/phase-b/contract-candidates/settings-usage-promotion-readiness.audit.v1.json"
const settingsCandidatePath =
	"evidence/phase-b/contract-candidates/settings-navigation.candidate.v1.json"
const usageCandidatePath =
	"evidence/phase-b/contract-candidates/usage-popover.candidate.v1.json"

async function json(path: string) {
	return JSON.parse(await readFile(path, "utf8"))
}

describe("Settings and usage promotion readiness", () => {
	test("keeps both source candidates RED without inventing action identity", async () => {
		const [audit, settings, usage] = await Promise.all([
			json(auditPath),
			json(settingsCandidatePath),
			json(usageCandidatePath),
		])

		expect(audit.status).toBe("red")
		expect(audit.promotionDecision.allowed).toBe(false)
		expect(settings.canonicalActionId).toBeNull()
		expect(usage.canonicalActionId).toBeNull()
		expect(settings.operationCandidate.trigger.observedActionAttribute).toBeNull()
		expect(usage.operationCandidate.trigger.observedActionAttribute).toBeNull()
	})

	test("records existing product-neutral framework capabilities instead of duplicating them", async () => {
		const audit = await json(auditPath)
		const capabilities = Object.fromEntries(
			audit.capabilities.map((capability: any) => [capability.id, capability]),
		)

		expect(Object.keys(capabilities)).toEqual([
			"route-action-identity",
			"route-application-state",
			"overlay-anchoring-stacking-routing",
			"overlay-focus-and-escape",
			"accessible-name-repair",
		])
		for (const capability of audit.capabilities) {
			expect(capability.foundationStatus).toMatch(/^ready/)
			expect(capability.promotionStatus).toBe("red")
			expect(capability.existingFramework.length).toBeGreaterThan(0)
			for (const reference of capability.existingFramework) {
				expect(reference.path.startsWith("/")).toBe(false)
				expect(reference.lines).toHaveLength(2)
				expect(reference.lines[0]).toBeLessThanOrEqual(reference.lines[1])
			}
		}
		expect(audit.frameworkChange.implemented).toBe(false)
	})

	test("makes the accessibility repair explicit and independent of action naming", async () => {
		const audit = await json(auditPath)
		const accessibility = audit.capabilities.find(
			(capability: any) => capability.id === "accessible-name-repair",
		)
		const identity = audit.capabilities.find(
			(capability: any) => capability.id === "route-action-identity",
		)

		expect(accessibility.sourceFinding).toContain("empty string")
		expect(accessibility.redBlocker).toContain("explicit reviewed non-empty")
		expect(accessibility.redBlocker).toContain("Do not")
		expect(identity.redBlocker).toContain("may not be inferred")
		expect(audit.invariants.join(" ")).toContain(
			"Accessibility repair is an explicit reviewed semantic override",
		)
	})

	test("contains no consumer coordinates or Palot-only canonical action names", async () => {
		const auditText = await readFile(auditPath, "utf8")
		const audit = JSON.parse(auditText)

		expect(auditText).not.toMatch(/\"(?:x|y|width|height)\"\s*:/)
		expect(auditText).not.toMatch(/navigation\.settings|usage\.popover|palot\./i)
		expect(audit.frameworkInspection.conclusion).toContain(
			"No independently missing framework primitive",
		)
	})
})
