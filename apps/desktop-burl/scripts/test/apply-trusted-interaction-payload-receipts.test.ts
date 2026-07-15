import { afterEach, describe, expect, test } from "bun:test"
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))

async function fixture(receiptName = "Adaptive", sourceName = "Adaptive") {
	const root = await mkdtemp(join(tmpdir(), "trusted-interaction-cli-"))
	roots.push(root)
	const burlSource = join(root, "burl")
	const importer = join(burlSource, "packages/pulp-import-ir/src")
	await mkdir(importer, { recursive: true })
	await writeFile(join(importer, "index.ts"), `
export function applyTrustedInteractionPayloadReceipts(root, evidence) {
  const receipt = evidence.scenarios?.[0]
  const target = root.children?.find((node) => node.attributes?.role === receipt?.action?.target?.role &&
    node.children?.[0]?.content === receipt?.action?.target?.name)
  if (!target) throw new Error("receipt mismatch: matched no exact semantic target")
  target.interaction = { actionBindingId: receipt.binding.action, event: "click", required: true,
    disabled: false, focusable: true, payloadContract: receipt.payloadReceipt.value }
  return { projections: [{ scenarioId: receipt.id, action: receipt.binding.action,
    role: receipt.action.target.role, name: receipt.action.target.name,
    payload: receipt.payloadReceipt.value, sourceNodeIds: [target.source_node_id] }], patchedNodeCount: 1 }
}`)
	const input = join(root, "input.json")
	const evidence = join(root, "interactions.json")
	const output = join(root, "output.json")
	const report = join(root, "report.json")
	await writeFile(input, JSON.stringify({ root: { source_node_id: "root", children: [{
		source_node_id: "adaptive", attributes: { role: "option" }, children: [{ content: sourceName }],
	}] } }))
	await writeFile(evidence, JSON.stringify({ scenarios: [{
		id: "adaptive", binding: { action: "composer.variant.select" },
		action: { target: { role: "option", name: receiptName } }, payloadReceipt: { value: "Adaptive" },
	}] }))
	return { root, burlSource, input, evidence, output, report }
}

function run(paths: Awaited<ReturnType<typeof fixture>>) {
	return Bun.spawnSync([process.execPath,
		resolve(import.meta.dir, "../apply-trusted-interaction-payload-receipts.ts"),
		"--input", paths.input, "--interaction-evidence", paths.evidence,
		"--output", paths.output, "--report", paths.report, "--burl-source", paths.burlSource,
	])
}

describe("trusted interaction payload receipt projection CLI", () => {
	test("writes the projected IR and a content-addressed report", async () => {
		const paths = await fixture()
		const result = run(paths)
		expect(result.exitCode).toBe(0)
		const output = JSON.parse(await readFile(paths.output, "utf8"))
		const report = JSON.parse(await readFile(paths.report, "utf8"))
		expect(output.root.children[0].interaction).toMatchObject({
			actionBindingId: "composer.variant.select", payloadContract: "Adaptive",
		})
		expect(report.schema).toBe("trusted-interaction-payload-receipt-projection-v1")
		expect(report.projection.patchedNodeCount).toBe(1)
		expect(report.output.sha256).toMatch(/^[a-f0-9]{64}$/)
	})

	test("rejects missing required arguments before resolving paths", () => {
		const result = Bun.spawnSync([process.execPath,
			resolve(import.meta.dir, "../apply-trusted-interaction-payload-receipts.ts")])
		expect(result.exitCode).not.toBe(0)
		expect(result.stderr.toString()).toContain("required: --input --interaction-evidence --output --report --burl-source")
	})

	test("fails closed on a receipt mismatch without writing output artifacts", async () => {
		const paths = await fixture("Adaptive", "Precise")
		const result = run(paths)
		expect(result.exitCode).not.toBe(0)
		expect(result.stderr.toString()).toContain("receipt mismatch")
		await expect(access(paths.output)).rejects.toThrow()
		await expect(access(paths.report)).rejects.toThrow()
	})
})
