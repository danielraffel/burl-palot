import { expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { SdkOpenCodeGateway } from "../src/adapter"

const runLive = process.env.OPENCODE_INTEGRATION === "1"

test.skipIf(!runLive)("starts and connects to a real local OpenCode server", async () => {
	const directory = await mkdtemp(join(tmpdir(), "palot-opencode-"))
	const gateway = new SdkOpenCodeGateway()
	try {
		const result = await gateway.execute({ type: "server.start", directory })
		expect(result.ok).toBe(true)
		if (!result.ok) return
		expect(result.value.ownedProcess).toBe(true)

		const project = await gateway.execute({ type: "project.select", directory })
		expect(project.ok).toBe(true)
	} finally {
		await gateway.close()
		await rm(directory, { recursive: true, force: true })
	}
})
