import { describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { dirname, join } from "node:path"

const auditPath =
	"evidence/phase-b/contract-candidates/overlay-import-contract.audit.v1.json"

async function json(path: string) {
	return JSON.parse(await readFile(path, "utf8"))
}

function flatten(node: any): any[] {
	return [node, ...(node.children ?? []).flatMap(flatten)]
}

describe("overlay import contract audit", () => {
	test("pins the project tooltip to captured hover and source placement semantics", async () => {
		const audit = await json(auditPath)
		const [open, interactions] = await Promise.all([
			json(audit.sourceEvidence.projectSearchTooltip.open),
			json(audit.sourceEvidence.projectSearchTooltip.interaction),
		])
		const scenario = interactions.scenarios.find(
			(item: any) => item.id === "hover-project-search-tooltip",
		)
		const content = flatten(open.observedDom).filter(
			(node: any) => node.attributes?.["data-slot"] === "tooltip-content",
		)

		expect(scenario.action.type).toBe("hover")
		expect(scenario.target.sourceId).toBeTruthy()
		expect(content).toHaveLength(1)
		expect(content[0].attributes).toMatchObject({
			"data-side": "bottom",
			"data-align": "center",
		})
	})

	test("pins usage focus and Escape to trusted source interaction evidence", async () => {
		const audit = await json(auditPath)
		const interactions = await json(audit.sourceEvidence.usagePopover.interaction)
		const focus = interactions.scenarios.find(
			(item: any) => item.id === "focus-usage-popover",
		)
		const dismiss = interactions.scenarios.find(
			(item: any) => item.id === "dismiss-usage-popover",
		)

		expect(focus.action.type).toBe("focus")
		expect(focus.state.focused).toBe(true)
		expect(dismiss.action).toMatchObject({ type: "key", key: "Escape" })
		expect(dismiss.events.filter((event: any) => event.key === "Escape").map(
			(event: any) => [event.type, event.isTrusted],
		)).toEqual([
			["keydown", true],
			["keyup", true],
		])
		expect(dismiss.state.removed).toBe(true)
	})

	test("pins authored tooltip timing and trusted outside dismissal", async () => {
		const audit = await json(auditPath)
		const [tooltipEvidence, usageEvidence, usageOpen, usageClosed] = await Promise.all([
			json(audit.sourceEvidence.projectSearchTooltip.atomicInteraction),
			json(audit.sourceEvidence.usagePopover.outsideInteraction),
			json(audit.sourceEvidence.usagePopover.atomicOpen),
			json(audit.sourceEvidence.usagePopover.closedAfterOutsidePointer),
		])
		const tooltip = tooltipEvidence.records.find((item: any) => item.state === "open")
		const outside = usageEvidence.records.find(
			(item: any) => item.state === "closed-after-outside-pointer",
		)
		const triggerFocus = usageEvidence.records.find(
			(item: any) => item.state === "closed-trigger-focused",
		)
		const usageOpenRecord = usageEvidence.records.find(
			(item: any) => item.state === "open",
		)

		expect(audit.sourceEvidence.projectSearchTooltip.authoredTiming).toMatchObject({
			sourcePath: "packages/ui/src/components/tooltip.tsx",
			sourceLine: 5,
			openDelayMs: 0,
		})
		expect(tooltip.action.type).toBe("hover")
		expect(tooltip.targetObservation.timing.pointerEnterTrusted).toBe(true)
		expect(tooltip.targetObservation.timing.openDelayMs).toBeGreaterThanOrEqual(0)
		expect(
			tooltip.targetObservation.timing.hostMonotonicBracket.openDelayUpperBoundMs,
		).toBeLessThan(20)
		expect(outside.targetObservation.events.map((event: any) => [
			event.type,
			event.isTrusted,
		])).toEqual([
			["pointerdown", true],
			["pointerup", true],
			["click", true],
		])
		expect(outside.targetObservation.focusBefore).toBeTruthy()
		expect(outside.targetObservation.focusAfter).toBeTruthy()
		expect(outside.targetObservation.focusAfter).not.toBe(
			outside.targetObservation.focusBefore,
		)
		expect(triggerFocus.action.type).toBe("focus")
		expect(triggerFocus.targetObservation.events.some(
			(event: any) => event.type === "focusin" && event.isTrusted,
		)).toBe(true)
		expect(triggerFocus.targetObservation.focusAfter).toBe(
			triggerFocus.targetObservation.sourceId,
		)
		expect(usageOpenRecord.targetObservation.focusBefore).toBe(
			triggerFocus.targetObservation.sourceId,
		)
		expect(outside.targetObservation.focusAfter).toBe(
			triggerFocus.targetObservation.sourceId,
		)
		expect(usageOpen.elements.filter((element: any) =>
			element.dataSlot === "popover-content")).toHaveLength(1)
		expect(usageClosed.elements.filter((element: any) =>
			element.dataSlot === "popover-content")).toHaveLength(0)
	})

	test("keeps canonical IR untouched and separates materializer proof from AppKit proof", async () => {
		const audit = await json(auditPath)
		const gates = Object.fromEntries(audit.gates.map((gate: any) => [gate.id, gate.status]))

		expect(audit.frameworkProjection.canonicalIrMutation).toBe(false)
		expect(gates["typed-trigger-content-projection"]).toBe("green")
		expect(gates["native-materializer-overlay-execution"]).toBe("green")
		expect(gates["source-focus-restoration"]).toBe("green")
		expect(gates["source-outside-pointer-dismissal"]).toBe("green")
		expect(gates["native-appkit-tooltip-hover"]).toBe("green")
		expect(gates["native-appkit-tooltip-coordinate-execution"]).toBe("green")
		expect(gates["native-appkit-popover-open-focus-escape"]).toBe("green")
		expect(gates["native-appkit-popover-outside-dismissal"]).toBe("green")
		expect(gates["native-appkit-outside-dismiss-policy-capability"]).toBe("green")
		expect(gates["native-visual-parity"]).toBe("green")
		expect(JSON.stringify(audit)).not.toMatch(/\b(x|y|left|top|right|bottom)\s*[:=]\s*\d/i)
	})

	test("pins one tooltip and one popover to same-pixel source and native visual proof", async () => {
		const audit = await json(auditPath)
		const evidence = await json(audit.nativeVisualEvidence.result)
		expect(evidence.backend).toBe("real Skia raster")
		expect(evidence.comparison).toBe("exact pixel dimensions; no resizing")
		expect(evidence.results.map((result: any) => result.id)).toEqual([
			"project-search-tooltip-open",
			"usage-popover-open",
		])
		for (const result of evidence.results) {
			expect(result.status).toBe("PASS")
			expect(result.blockers).toEqual([])
			expect(result.visualGapCodes).toEqual([])
			expect(result.metrics.mae).toBeLessThanOrEqual(result.visualThresholds.maxMae)
			expect(result.metrics.edgeDiff).toBeLessThanOrEqual(
				result.visualThresholds.maxEdgeDiff,
			)
			const [source, candidate] = await Promise.all([
				readFile(result.sourceCrop),
				readFile(result.candidate),
			])
			expect(source.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a")
			expect(candidate.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a")
		}
	})

	test("pins every AppKit overlay screenshot to its same-viewport receipt", async () => {
		const audit = await json(auditPath)
		const receiptPath = audit.nativeAppKitEvidence.receipt
		const receipt = await json(receiptPath)
		expect(receipt.result).toBe("92 assertions in 4 test cases passed")
		expect(receipt.tooltip.viewportLogical).toEqual([320, 180])
		expect(receipt.popover.viewportLogical).toEqual([400, 300])
		expect(receipt.contextMenu.viewportLogical).toEqual([400, 300])
		for (const cohort of [receipt.tooltip, receipt.popover, receipt.contextMenu]) {
			for (const screenshot of Object.values(cohort.screenshots) as any[]) {
				const bytes = await readFile(join(dirname(receiptPath), screenshot.path))
				expect(bytes.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a")
				expect(createHash("sha256").update(bytes).digest("hex")).toBe(screenshot.sha256)
			}
		}
	})
})
