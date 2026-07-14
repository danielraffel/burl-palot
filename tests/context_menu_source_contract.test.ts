import { describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { basename, dirname, join } from "node:path"

const auditPath =
	"evidence/phase-b/contract-candidates/context-menu-import-contract.audit.v1.json"

async function json(path: string) {
	return JSON.parse(await readFile(path, "utf8"))
}

function flatten(node: any): any[] {
	return [node, ...(node.children ?? []).flatMap(flatten)]
}

describe("source context-menu import contract", () => {
	test("pins all visible triggers to trusted right-button open and Escape close pairs", async () => {
		const audit = await json(auditPath)
		const evidence = await json(audit.sourceEvidence.capture)
		const opens = evidence.records.filter((record: any) => record.state === "open")
		const closes = evidence.records.filter(
			(record: any) => record.state === "closed-again",
		)

		expect(evidence.records).toHaveLength(13)
		expect(opens).toHaveLength(6)
		expect(closes).toHaveLength(6)
		expect(new Set(opens.map((record: any) => record.targetObservation.sourceId)).size)
			.toBe(6)
		for (const record of opens) {
			expect(record.action).toMatchObject({ type: "pointer", button: "right" })
			expect(record.targetObservation.dataSlot).toBe("context-menu-trigger")
			expect(record.targetObservation.events.some((event: any) =>
				event.type === "pointerdown" && event.isTrusted &&
				event.intendedTargetInComposedPath)).toBe(true)
			expect(record.targetObservation.focusAfter).toBeTruthy()
		}
		for (const record of closes) {
			expect(record.action).toMatchObject({ type: "key", key: "Escape" })
			expect(record.targetObservation.events.map((event: any) => [
				event.type, event.isTrusted, event.key,
			])).toEqual([
				["keydown", true, "Escape"],
				["keyup", true, "Escape"],
			])
		}
	})

	test("proves pointer placement and menu semantics without inventing item actions", async () => {
		const audit = await json(auditPath)
		const evidence = await json(audit.sourceEvidence.capture)
		const opens = evidence.records.filter((record: any) => record.state === "open")
		let itemCount = 0
		for (const record of opens) {
			const captureRoot = dirname(audit.sourceEvidence.capture)
			const source = await json(join(captureRoot, basename(record.directory), "source.json"))
			const nodes = flatten(source.semantics.observedDom)
			const menus = nodes.filter((node: any) =>
				node.attributes?.["data-slot"] === "context-menu-content")
			const items = nodes.filter((node: any) => node.attributes?.role === "menuitem")
			expect(menus).toHaveLength(1)
			expect(menus[0].attributes.role).toBe("menu")
			expect(menus[0].rect.x).toBe(record.targetObservation.anchorPoint.x)
			expect(menus[0].rect.y).toBe(record.targetObservation.anchorPoint.y + 4)
			expect(items).toHaveLength(3)
			expect(items.every((item: any) => item.attributes?.["data-pulp-action"] == null))
				.toBe(true)
			itemCount += items.length
		}
		expect(itemCount).toBe(18)
		expect(audit.sourceEvidence.cohort.portableItemActionIdsObserved).toBe(0)
		expect(audit.sourceEvidence.cohort.focusRestorationsObserved).toBe(0)
	})

	test("pins the audit to immutable capture receipts", async () => {
		const audit = await json(auditPath)
		for (const [path, sha256] of [
			[audit.sourceEvidence.manifest, audit.sourceEvidence.manifestSha256],
			[audit.sourceEvidence.capture, audit.sourceEvidence.captureSha256],
		] as Array<[string, string]>) {
			const bytes = await readFile(path)
			expect(createHash("sha256").update(bytes).digest("hex")).toBe(sha256)
		}
	})

	test("pins production AppKit execution and exact native visual parity", async () => {
		const audit = await json(auditPath)
		const receipt = await json(audit.verification.nativeAppKit.receipt)
		expect(receipt.contextMenu.proof).toContain(
			"AppKit rightMouseDown at the imported trigger opens the menu through View::on_context_menu",
		)
		for (const screenshot of Object.values(receipt.contextMenu.screenshots) as any[]) {
			const bytes = await readFile(join(dirname(audit.verification.nativeAppKit.receipt), screenshot.path))
			expect(createHash("sha256").update(bytes).digest("hex")).toBe(screenshot.sha256)
		}
		const parity = await json(audit.verification.visualParity.result)
		const result = parity.results.find((candidate: any) =>
			candidate.id === "first-session-context-menu-open")
		expect(result.status).toBe("PASS")
		expect(result.blockers).toEqual([])
		expect(result.visualGapCodes).toEqual([])
		expect(result.metrics.mae).toBeLessThanOrEqual(result.visualThresholds.maxMae)
		expect(result.metrics.edgeDiff).toBeLessThanOrEqual(result.visualThresholds.maxEdgeDiff)
	})

	test("generates all six canonical consumer menu shells without invented actions", async () => {
		const audit = await json(auditPath)
		const candidate = await json(audit.verification.canonicalConsumerImport.candidate)
		const menus = candidate.contracts.filter((contract: any) =>
			contract.activationEvent === "context-menu")
		expect(candidate.diagnostics).toEqual([])
		expect(menus).toHaveLength(6)
		for (const menu of menus) {
			expect(menu.anchor).toEqual({ kind: "pointer", evidence: "activation-event" })
			expect(menu.gates.escapeDismissalObserved).toBe(true)
			expect(menu.gates.focusRestorationObserved).toBe(false)
			expect(menu.content.items).toHaveLength(3)
			expect(menu.content.items.every((item: any) => item.actionBindingId === null))
				.toBe(true)
		}
	})
})
