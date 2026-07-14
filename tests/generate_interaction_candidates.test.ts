import { describe, expect, test } from "bun:test"
import { readFile } from "node:fs/promises"

describe("interaction candidate generator", () => {
	test("uses only reviewed source-id action mappings", async () => {
		const source = await readFile("apps/desktop-burl/scripts/generate-interaction-candidates.ts", "utf8")
		expect(source).toContain("extractInteractionCandidates")
		expect(source).toContain("semantics.capture.innerWidth")
		expect(source).toContain("match.sourceId")
		expect(source).toContain("rule.attributes?.pulpHostAction")
		expect(source).toContain("matched ${matches.length} nodes")
		expect(source).not.toContain("accessibleName, applicationAction")
	})
})
