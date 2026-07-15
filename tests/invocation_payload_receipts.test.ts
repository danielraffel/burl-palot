import { expect, test } from "bun:test"
import { readFile } from "node:fs/promises"

test("external open invocation fields retain exact typed source provenance", async () => {
	const [document, policy, bindings] = await Promise.all([
		"evidence/phase-b/atomic-action-invocation-receipts.v1.json",
		"apps/desktop-burl/contracts/main-chat.source-binding-policy.v1.json",
		"apps/desktop-burl/contracts/main-chat.application-bindings.v1.json",
	].map(async (path) => JSON.parse(await readFile(path, "utf8"))))
	expect(document.schema).toBe("consumer-invocation-payload-receipts-v1")
	expect(document.receipts).toHaveLength(1)
	const receipt = document.receipts[0]
	expect(receipt.action).toBe("external.open.preferred")
	expect(JSON.parse(receipt.payloadContract)).toEqual({
		$source: "runtime-context-fields",
		capturedFields: { persistPreferred: true, targetID: "finder" },
		fields: { directory: "project.directory" },
	})
	expect(receipt.fields.map((field: any) => [field.name, field.type, field.source])).toEqual([
		["directory", "path", "runtime-context"],
		["targetID", "string", "captured-invocation"],
		["persistPreferred", "boolean", "captured-invocation"],
	])
	expect(receipt.provenance.channel).toBe("open-in:open")
	expect(receipt.provenance.rendererSiteSha256).toMatch(/^[a-f0-9]{64}$/)
	const policyRule = policy.rules.find((rule: any) => rule.id === "external-open-primary")
	expect(policyRule.attributes.pulpPayloadContract).toBe(receipt.payloadContract)
	expect(policyRule.attributes.pulpPayloadProvenance).toBe(
		"evidence/phase-b/atomic-action-invocation-receipts.v1.json#receipts/0")
	const action = bindings.actions.find((entry: any) => entry.id === receipt.action)
	expect(action.fields).toEqual([
		{ name: "directory", type: "path", required: true },
		{ name: "targetID", type: "string", required: true },
		{ name: "persistPreferred", type: "boolean", required: true },
	])
})
