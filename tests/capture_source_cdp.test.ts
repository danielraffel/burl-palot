import { describe, expect, test } from "bun:test"
import { bootstrapSource, semanticExpression } from "../scripts/capture-source-cdp"

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
	})
})
