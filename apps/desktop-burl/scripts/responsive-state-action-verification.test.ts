import { describe, expect, it } from "bun:test"
import {
	declaredButUnattachedActions,
	missingRequiredExecutableActions,
} from "./responsive-state-action-verification"

describe("responsive state executable-action verification", () => {
	it("rejects a declared Stop action without an executable interaction binding", () => {
		const stop = {
			attributes: {
				role: "button",
				accessibility_name: "Stop",
				pulpHostAction: "prompt.cancel",
			},
			interaction: null,
		}

		expect(missingRequiredExecutableActions(
			[stop], ["prompt.cancel"], new Set(["prompt.send", "prompt.retry"]),
		)).toEqual(["prompt.cancel"])
		expect(declaredButUnattachedActions([stop]).map(({ action }) => action))
			.toEqual(["prompt.cancel"])
	})

	it("accepts the same action only after an executable binding is attached", () => {
		const stop = {
			attributes: { pulpHostAction: "prompt.cancel" },
			interaction: { actionBindingId: "prompt.cancel" },
		}

		expect(missingRequiredExecutableActions([stop], ["prompt.cancel"], new Set()))
			.toEqual([])
		expect(declaredButUnattachedActions([stop])).toEqual([])
	})
})
