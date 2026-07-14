import { describe, expect, test } from "bun:test"
import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

const verifier = resolve(import.meta.dir, "../verify-public-application-state-contract.ts")
const fixture = async (overrides: Record<string, unknown> = {}, extensionEntries: unknown[] = []) => {
	const directory = await mkdtemp(join(tmpdir(), "public-state-contract-"))
	const policy = { rules: [{ match: { sourceId: "dom/html-shape-old:0/body:0/button:0" }, attributes: {
		pulpHostAction: "menu.toggle", pulpStateKey: "menu.open", pulpStateTransition: "toggle",
	} }] }
	const extensions = { schema: "pulp-application-state-extension-contract-v1", extensions: extensionEntries }
	const candidate = { schema: "pulp-application-state-candidate-v1", key: "menu.open",
		applicationActions: ["menu.toggle"], pageUrls: { closed: "https://source.test", open: "https://source.test" },
		stateTransitions: [{ key: "menu.open", action: "menu.toggle", before: "closed", after: "open" }],
		root: { raw_source: { node: { sourceId: "dom/html-shape-new:0/body:0/button:0",
			attributes: { "data-pulp-action": "menu.toggle" } } }, children: [] }, ...overrides }
	for (const [name, value] of Object.entries({ policy, extensions, candidate }))
		await writeFile(join(directory, `${name}.json`), JSON.stringify(value))
	return { directory, result: Bun.spawnSync(["bun", verifier, "--policy", join(directory, "policy.json"),
		"--extensions", join(directory, "extensions.json"), "--candidate", join(directory, "candidate.json")]) }
}

describe("public application-state reconciliation", () => {
	test("accepts the one public action ID, state key, and value vocabulary", async () => {
		const { result } = await fixture()
		expect(result.exitCode).toBe(0)
	})

	test("rejects a second action name for the same source control", async () => {
		const { result } = await fixture({ applicationActions: ["menu.select"],
			stateTransitions: [{ key: "menu.open", action: "menu.select", before: "closed", after: "open" }],
			root: { raw_source: { node: { sourceId: "dom/html-shape-new:0/body:0/button:0",
				attributes: { "data-pulp-action": "menu.select" } } }, children: [] } })
		expect(result.exitCode).not.toBe(0)
		expect(result.stderr.toString()).toContain("public action mismatch")
	})

	test("rejects private state keys for a public stateful action", async () => {
		const { result } = await fixture({ key: "menu.presentation",
			stateTransitions: [{ key: "menu.presentation", action: "menu.toggle", before: "closed", after: "open" }] })
		expect(result.exitCode).not.toBe(0)
		expect(result.stderr.toString()).toContain("state key mismatch")
	})

	test("accepts independent toggle and dismiss actions for one public state key", async () => {
		const { result } = await fixture({ applicationActions: ["menu.toggle", "menu.dismiss"],
			stateTransitions: [
				{ key: "menu.open", action: "menu.toggle", before: "closed", after: "open" },
				{ key: "menu.open", action: "menu.dismiss", before: "open", after: "closed" },
			] }, [{ action: "menu.dismiss", stateKey: "menu.open", values: ["closed", "open"] }])
		expect(result.stderr.toString()).toBe("")
		expect(result.exitCode).toBe(0)
	})
})
