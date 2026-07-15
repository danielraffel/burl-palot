import { describe, expect, test } from "bun:test"
import {
	normalizeCapturedApplicationStateInteractionEvidence,
	verifyTrustedInteractionReceipt,
} from "../application-state-interaction-receipts"

describe("trusted application-state interaction receipts", () => {
	test("joins explicit capture bindings to nested trusted source events", () => {
		const evidence = normalizeCapturedApplicationStateInteractionEvidence({
			schemaVersion: 1,
			records: [{
				id: "open-project-search",
				action: { type: "pointer", target: { selector: "button" } },
				binding: { action: "project.search.toggle" },
				targetObservation: { events: [
					{ type: "pointerdown", isTrusted: true, intendedTargetInComposedPath: true },
					{ type: "pointerup", isTrusted: true, intendedTargetInComposedPath: true },
					{ type: "click", isTrusted: true, intendedTargetInComposedPath: true },
				] },
			}],
		})

		expect(evidence.scenarios).toHaveLength(1)
		expect(evidence.scenarios[0].binding.action).toBe("project.search.toggle")
		expect(verifyTrustedInteractionReceipt(evidence.scenarios[0]))
			.toEqual({ pointer: true, keyboard: false })
	})

	test("does not invent an action binding for an unlabeled source capture", () => {
		const evidence = normalizeCapturedApplicationStateInteractionEvidence({
			schemaVersion: 1,
			records: [{
				id: "similar-label-is-not-identity",
				action: { type: "pointer", target: { descendantText: "Search projects" } },
				targetObservation: { events: [
					{ type: "pointerdown", isTrusted: true, intendedTargetInComposedPath: true },
					{ type: "pointerup", isTrusted: true, intendedTargetInComposedPath: true },
					{ type: "click", isTrusted: true, intendedTargetInComposedPath: true },
				] },
			}],
		})

		expect(evidence.scenarios[0].binding).toBeUndefined()
	})

	test("rejects a pointer sequence delivered outside the intended composed path", () => {
		const evidence = normalizeCapturedApplicationStateInteractionEvidence({
			schemaVersion: 1,
			records: [{
				id: "wrong-hit-target",
				action: { type: "pointer", target: { selector: "button" } },
				binding: { action: "project.search.toggle" },
				targetObservation: { events: [
					{ type: "pointerdown", isTrusted: true, intendedTargetInComposedPath: false },
					{ type: "pointerup", isTrusted: true, intendedTargetInComposedPath: false },
					{ type: "click", isTrusted: true, intendedTargetInComposedPath: false },
				] },
			}],
		})

		expect(() => verifyTrustedInteractionReceipt(evidence.scenarios[0]))
			.toThrow("lacks trusted activation receipt")
	})

	test("accepts a trusted pointer-entry hover receipt", () => {
		expect(verifyTrustedInteractionReceipt({
			id: "tooltip-hover",
			action: { type: "hover" },
			events: [
				{ type: "pointerover", isTrusted: true },
				{ type: "pointerenter", isTrusted: true },
			],
		})).toEqual({ pointer: true, keyboard: false })
	})

	test("rejects an untrusted hover receipt", () => {
		expect(() => verifyTrustedInteractionReceipt({
			id: "synthetic-tooltip-hover",
			action: { type: "hover" },
			events: [
				{ type: "pointerover", isTrusted: false },
				{ type: "pointerenter", isTrusted: false },
			],
		})).toThrow("lacks trusted pointer-entry receipt")
	})

	test("rejects a trusted move without pointer entry", () => {
		expect(() => verifyTrustedInteractionReceipt({
			id: "move-only-tooltip-hover",
			action: { type: "hover" },
			events: [{ type: "pointermove", isTrusted: true }],
		})).toThrow("lacks trusted pointer-entry receipt")
	})
})
