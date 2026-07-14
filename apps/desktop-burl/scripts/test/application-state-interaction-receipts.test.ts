import { describe, expect, test } from "bun:test"
import { verifyTrustedInteractionReceipt } from "../application-state-interaction-receipts"

describe("trusted application-state interaction receipts", () => {
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
