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

test("message actions declare source-owned collection payloads before promotion", async () => {
	const [policy, manifest] = await Promise.all([
		readFile("apps/desktop-burl/contracts/main-chat.source-binding-policy.v1.json", "utf8").then(
			(value) => JSON.parse(value),
		),
		readFile("apps/desktop-burl/contracts/main-chat.application-bindings.v1.json", "utf8").then(
			(value) => JSON.parse(value),
		),
	])
	const expected = new Map([
		["message.scroll-to-turn", { field: "turn.id", schema: "turn-id" }],
		["session.fork-from-message", { field: "turn.next-user-message-id", schema: "message-id" }],
		["session.undo-to-message", { field: "turn.user-message-id", schema: "message-id" }],
	])
	const promoted = new Set(manifest.actions.map((action: { id: string }) => action.id))
	for (const [action, payload] of expected) {
		const matches = policy.rules.filter(
			(rule: { attributes?: Record<string, string> }) => rule.attributes?.pulpHostAction === action,
		)
		expect(matches).toHaveLength(1)
		expect(matches[0].attributes).toMatchObject({
			pulpPayloadSource: "collection-item-field",
			pulpPayloadField: payload.field,
			pulpPayloadSchema: payload.schema,
		})
		expect(matches[0].attributes.pulpPayloadProvenance.startsWith("source://palot/")).toBe(true)
		expect(promoted.has(action)).toBe(false)
	}
})

test("agent selection stays unpromoted when capture has no option value", async () => {
	const [capture, manifest] = await Promise.all([
		readFile(
			"evidence/phase-b/source-interaction-states/generated-v4/composer/build/debug-selected/source.json",
			"utf8",
		).then((value) => JSON.parse(value)),
		readFile("apps/desktop-burl/contracts/main-chat.application-bindings.v1.json", "utf8").then(
			(value) => JSON.parse(value),
		),
	])
	const actionNodes: Array<Record<string, unknown>> = []
	const visit = (value: unknown) => {
		if (!value || typeof value !== "object") return
		if (Array.isArray(value)) return value.forEach(visit)
		const node = value as Record<string, unknown>
		const attributes = node.attributes as Record<string, string> | undefined
		if (attributes?.["data-pulp-action"] === "composer.agent.select") actionNodes.push(node)
		Object.values(node).forEach(visit)
	}
	visit(capture)
	expect(actionNodes.length).toBeGreaterThan(0)
	for (const node of actionNodes) {
		const attributes = node.attributes as Record<string, string>
		const descendantText: string[] = []
		const collectText = (value: unknown) => {
			if (!value || typeof value !== "object") return
			if (Array.isArray(value)) return value.forEach(collectText)
			const entry = value as Record<string, unknown>
			if (entry.kind === "text" && typeof entry.text === "string") descendantText.push(entry.text)
			Object.values(entry).forEach(collectText)
		}
		collectText(node)
		expect(descendantText).toContain("Debug")
		expect(attributes["data-pulp-payload"]).toBeUndefined()
		expect(attributes["data-pulp-payload-contract"]).toBeUndefined()
		expect(attributes.value).toBeUndefined()
	}
	expect(manifest.actions.some((action: { id: string }) => action.id === "composer.agent.select")).toBe(false)
})

test("reasoning disclosure binds the captured body to runtime text", async () => {
	const [policy, source, capture] = await Promise.all([
		readFile("apps/desktop-burl/contracts/main-chat.source-binding-policy.v1.json", "utf8").then(
			(value) => JSON.parse(value),
		),
		readFile("apps/desktop-burl/src/palot_view.cpp", "utf8"),
		readFile(
			"evidence/phase-b/source-interaction-states/generated-v3/disclosures/thought/open/source.json",
			"utf8",
		).then((value) => JSON.parse(value)),
	])
	const bindings = policy.rules.filter(
		(rule: { attributes?: Record<string, string> }) =>
			rule.attributes?.pulpValueKey === "reasoning.text",
	)
	expect(bindings).toHaveLength(1)
	expect(bindings[0].attributes).toMatchObject({
		pulpValueKey: "reasoning.text",
		pulpValueKind: "markdown",
	})
	expect(bindings[0].match.sourceId).toContain("data-slot-collapsible-content")
	const sourceIds = new Set<string>()
	const collectSourceIds = (value: unknown) => {
		if (!value || typeof value !== "object") return
		if (Array.isArray(value)) return value.forEach(collectSourceIds)
		const object = value as Record<string, unknown>
		if (typeof object.sourceId === "string") sourceIds.add(object.sourceId)
		Object.values(object).forEach(collectSourceIds)
	}
	collectSourceIds(capture.observedDom)
	expect(sourceIds.has(bindings[0].match.sourceId)).toBe(true)
	expect(source).toContain('{"reasoning.text", first_string(part, {"text"})}')
})
