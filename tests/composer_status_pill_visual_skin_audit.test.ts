import { describe, expect, test } from "bun:test"
import { readFile } from "node:fs/promises"

const auditPath =
	"evidence/phase-b/contract-candidates/composer-status-pill-visual-skin.audit.v1.json"
const sourcePath =
	"evidence/phase-b/source-interaction-states/generated-v3/prompt-cancel/streaming/source.json"
const focusedPath =
	"evidence/phase-b/native-components/generated-v1/ir/composer-stop-primary.json"
const canonicalPath =
	"apps/desktop-burl/resources/import/main-chat.observed.design-ir.v1.json"

async function json(path: string) {
	return JSON.parse(await readFile(path, "utf8"))
}

function walk(value: any, predicate: (candidate: any) => boolean): any | undefined {
	if (value && typeof value === "object") {
		if (predicate(value)) return value
		for (const child of Array.isArray(value) ? value : Object.values(value)) {
			const found = walk(child, predicate)
			if (found) return found
		}
	}
	return undefined
}

describe("composer status/action pill visual-skin audit", () => {
	test("pins the exact source shell and icon geometry", async () => {
		const [audit, source] = await Promise.all([json(auditPath), json(sourcePath)])
		const button = walk(
			source,
			(node) => node.tagName === "button" && node.attributes?.["aria-label"] === "Stop",
		)

		expect(button).toBeDefined()
		expect(button.rect).toEqual({ height: 24, width: 80.765625, x: 1091.234375, y: 722.5 })
		expect([
			button.computedStyle.borderTopLeftRadius,
			button.computedStyle.borderTopRightRadius,
			button.computedStyle.borderBottomRightRadius,
			button.computedStyle.borderBottomLeftRadius,
		]).toEqual(["7.5px", "7.5px", "7.5px", "7.5px"])
		expect(audit.sourceContract.rest.cornerRadii).toEqual([7.5, 7.5, 7.5, 7.5])
		expect(audit.sourceContract.icon.renderedSize).toEqual({ width: 14, height: 14 })
	})

	test("proves focused and canonical lowering carry the generic rest radius while the whole-app gate remains red", async () => {
		const [audit, focused, canonical] = await Promise.all([
			json(auditPath),
			json(focusedPath),
			json(canonicalPath),
		])
		const canonicalButton = walk(
			canonical,
			(node) => node.attributes?.pulpHostAction === "prompt.cancel",
		)

		expect(focused.root.style.borderRadius).toBe(7.5)
		expect(focused.root.visualSkin.states.rest.cornerRadius).toBe(7.5)
		expect(canonicalButton.style.borderTopLeftRadius).toBe(7.5)
		expect(canonicalButton.style.borderTopRightRadius).toBe(7.5)
		expect(canonicalButton.style.borderBottomRightRadius).toBe(7.5)
		expect(canonicalButton.style.borderBottomLeftRadius).toBe(7.5)
		expect(canonicalButton.visualSkin.states.rest.cornerRadius).toBe(7.5)
		expect(audit.status).toBe("red")
		expect(audit.redGate.closed).toBe(false)
	})

	test("keeps unrecorded interaction states RED instead of substituting defaults", async () => {
		const audit = await json(auditPath)
		expect(audit.sourceContract.stateReceipt).toEqual({
			rest: "authoritative-durable",
			hover: "exploratory-live-cdp-only",
			pressed: "exploratory-live-cdp-only",
			disabled: "synthetic-only-not-promotable",
		})
		expect(audit.redGate.requirements.join(" ")).toContain(
			"do not invent state paint from Burl defaults",
		)
	})

	test("requires one generic rounded face and forbids consumer geometry", async () => {
		const text = await readFile(auditPath, "utf8")
		const audit = JSON.parse(text)
		expect(audit.frameworkChange.implementedByThisAudit).toBe(false)
		expect(audit.layerAudit.find((layer: any) => layer.layer === "native-materialization").finding)
			.toContain("clearing the base View background")
		expect(audit.redGate.requirements.join(" ")).toContain("exactly one rounded face")
		expect(text).not.toMatch(/"consumerOverride"|"hardcodedCoordinates"/)
	})
})
