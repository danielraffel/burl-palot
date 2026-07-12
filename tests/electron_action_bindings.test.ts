import { expect, test } from "bun:test"
import { readFile } from "node:fs/promises"

test("reviewed action mappings point to exact runtime trace records", async () => {
	const [policy, evidence, manifest] = await Promise.all(
		[
			"apps/desktop-burl/contracts/main-chat.source-binding-policy.v1.json",
			"evidence/phase-b/electron-interaction-traces.v1.json",
			"apps/desktop-burl/contracts/main-chat.application-bindings.v1.json",
		].map(async (path) => JSON.parse(await readFile(path, "utf8"))),
	)
	const actions = new Set(manifest.actions.map((action: { id: string }) => action.id))
	expect(policy.traceMappings.length).toBeGreaterThan(0)
	for (const mapping of policy.traceMappings) {
		expect(mapping).not.toHaveProperty("accessibleName")
		expect(mapping).not.toHaveProperty("textExact")
		expect(actions.has(mapping.applicationAction)).toBe(true)
		const index = Number(mapping.evidenceUri.match(/records\/(\d+)$/)?.[1])
		expect(Number.isInteger(index)).toBe(true)
		expect(evidence.records[index].sourceId).toBe(mapping.sourceId)
		expect(evidence.records[index].activated.found).toBe(true)
	}
})

test("every promoted action has a consumer endpoint", async () => {
	const [manifest, source] = await Promise.all([
		readFile("apps/desktop-burl/contracts/main-chat.application-bindings.v1.json", "utf8").then(
			(value) => JSON.parse(value),
		),
		readFile("apps/desktop-burl/src/palot_view.cpp", "utf8"),
	])
	for (const action of manifest.actions)
		expect(source).toContain(`register_action("${action.id}"`)
})
