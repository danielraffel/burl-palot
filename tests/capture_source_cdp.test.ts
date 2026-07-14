import { describe, expect, test } from "bun:test"
import {
	bootstrapSource,
	captureAtomicFrame,
	semanticExpression,
} from "../scripts/capture-source-cdp"

class FakeCdp {
	private readonly snapshots: unknown[]
	screenshotCount = 0

	constructor(snapshots: unknown[]) {
		this.snapshots = [...snapshots]
	}

	async command(method: string, params: Record<string, unknown> = {}): Promise<any> {
		if (method === "Runtime.evaluate" && params.awaitPromise) return { result: { value: true } }
		if (method === "Runtime.evaluate") {
			if (!this.snapshots.length) throw new Error("fake snapshot sequence exhausted")
			return { result: { value: this.snapshots.shift() } }
		}
		if (method === "Page.captureScreenshot") {
			this.screenshotCount++
			return { data: Buffer.from(`png-${this.screenshotCount}`).toString("base64") }
		}
		throw new Error(`unexpected command ${method}`)
	}
}

describe("source CDP capture helper", () => {
	test("bootstrap is deterministic and freezes state", () => {
		const storage = { "palot:mockMode": "true", "palot:theme": '"dark"' }
		const first = bootstrapSource("2026-07-11T20:00:00.000Z", storage)
		const second = bootstrapSource("2026-07-11T20:00:00.000Z", storage)
		expect(first).toBe(second)
		expect(first).toContain("static now() { return epoch; }")
		expect(first).toContain("animation:none!important")
		expect(first).toContain('localStorage.setItem("palot:mockMode", "true")')
	})

	test("semantic snapshot includes required pass-one fields", () => {
		expect(semanticExpression).toContain("route:")
		expect(semanticExpression).toContain("sidebar:")
		expect(semanticExpression).toContain("devicePixelRatio")
		expect(semanticExpression).toContain("observedDom")
		expect(semanticExpression).toContain("computedStyle")
		expect(semanticExpression).toContain("sourceId")
		expect(semanticExpression).toContain('"[" + stable + "]:" + index')
		expect(semanticExpression).toContain("flexGrow")
		expect(semanticExpression).toContain("borderTopColor")
		expect(semanticExpression).toContain("outerHtml")
		expect(semanticExpression).toContain("interactionEvidence")
		expect(semanticExpression).toContain("getEventListeners")
		expect(semanticExpression).toContain('__reactProps$')
		expect(semanticExpression).toContain("accessibleName")
		expect(semanticExpression).toContain("listenerSurface || reactBacked")
		expect(semanticExpression).toContain('"mouseenter"')
		expect(semanticExpression).toContain("normalizeReactEvent")
		expect(semanticExpression).toContain('referencedText("aria-labelledby")')
		expect(semanticExpression).toContain('element.getAttribute("placeholder")')
	})

	test("accepts only a screenshot bracketed by identical snapshots", async () => {
		const cdp = new FakeCdp([
			{ rect: { x: 12, width: 200 }, style: { color: "rgb(1, 2, 3)" } },
			{ style: { color: "rgb(1, 2, 3)" }, rect: { width: 200, x: 12 } },
			{ rect: { x: 12, width: 200 }, style: { color: "rgb(1, 2, 3)" } },
		])
		const capture = await captureAtomicFrame(cdp, "capture()")
		expect(cdp.screenshotCount).toBe(1)
		expect(capture.png.toString()).toBe("png-1")
		expect(capture.proof.attempt).toBe(1)
		expect(capture.proof.preSettleSha256).toBe(capture.proof.preScreenshotSha256)
		expect(capture.proof.preScreenshotSha256).toBe(capture.proof.postScreenshotSha256)
	})

	test("settles before taking any screenshot when geometry changes", async () => {
		const cdp = new FakeCdp([
			{ rect: { x: 0 } },
			{ rect: { x: 20 } },
			{ rect: { x: 20 } },
			{ rect: { x: 20 } },
			{ rect: { x: 20 } },
		])
		const capture = await captureAtomicFrame(cdp, "capture()")
		expect(cdp.screenshotCount).toBe(1)
		expect(capture.proof.attempt).toBe(2)
	})

	test("discards a screenshot when source changes across the PNG command", async () => {
		const cdp = new FakeCdp([
			{ expanded: true },
			{ expanded: true },
			{ expanded: false },
			{ expanded: false },
			{ expanded: false },
			{ expanded: false },
		])
		const capture = await captureAtomicFrame(cdp, "capture()")
		expect(cdp.screenshotCount).toBe(2)
		expect(capture.png.toString()).toBe("png-2")
		expect(capture.proof.attempt).toBe(2)
	})

	test("fails closed when no stable source frame exists", async () => {
		const cdp = new FakeCdp([
			{ x: 1 },
			{ x: 2 },
			{ x: 3 },
			{ x: 4 },
		])
		await expect(
			captureAtomicFrame(cdp, "capture()", { maxAttempts: 2 }),
		).rejects.toThrow("source did not remain stable for an atomic screenshot")
		expect(cdp.screenshotCount).toBe(0)
	})
})
