import { describe, expect, test } from "bun:test"
import type { OpencodeClient, Session } from "@opencode-ai/sdk/v2/client"
import { SdkOpenCodeGateway } from "../src/adapter"

const session: Session = {
	id: "session-1",
	slug: "session-1",
	projectID: "project-1",
	directory: "/tmp/project",
	title: "Session",
	version: "1",
	time: { created: 1, updated: 1 },
}

function fakeClient(calls: Array<{ name: string; value: unknown }>): OpencodeClient {
	return {
		global: {
			health: async () => ({ data: { healthy: true, version: "test" } }),
			event: async () => ({
				stream: (async function* () {
					yield {
						directory: "/tmp/canonical-project",
						payload: {
							type: "session.updated",
							properties: { info: session },
						},
					}
				})(),
			}),
		},
		project: {
			current: async (value: unknown) => {
				calls.push({ name: "project.current", value })
				return {
					data: {
						id: "project-1",
						worktree: "/tmp/canonical-project",
						name: "project",
						time: { created: 1, updated: 1 },
						sandboxes: [],
					},
				}
			},
		},
		session: {
			list: async (value: unknown) => {
				calls.push({ name: "session.list", value })
				return { data: [session] }
			},
			create: async (value: unknown) => {
				calls.push({ name: "session.create", value })
				return { data: session }
			},
			get: async (value: unknown) => {
				calls.push({ name: "session.get", value })
				return { data: session }
			},
			fork: async (value: unknown) => {
				calls.push({ name: "session.fork", value })
				return { data: { ...session, id: "session-forked", slug: "session-forked" } }
			},
			revert: async (value: unknown) => {
				calls.push({ name: "session.revert", value })
				return { data: { sessionID: "session-1", messageID: "message-user-1" } }
			},
			promptAsync: async (value: unknown) => {
				calls.push({ name: "session.promptAsync", value })
				return { data: undefined }
			},
			abort: async (value: unknown) => {
				calls.push({ name: "session.abort", value })
				return { data: true }
			},
		},
	} as unknown as OpencodeClient
}

describe("SDK OpenCode gateway", () => {
	test("connects and routes project/session/prompt/cancel/retry commands", async () => {
		const calls: Array<{ name: string; value: unknown }> = []
		const client = fakeClient(calls)
		const gateway = new SdkOpenCodeGateway({ clientFactory: () => client })

		expect(
			await gateway.execute({
				type: "server.connect",
				connection: { baseUrl: "http://127.0.0.1:4096", directory: "/tmp/project" },
			}),
		).toEqual({
			ok: true,
			value: {
				baseUrl: "http://127.0.0.1:4096",
				directory: "/tmp/project",
				ownedProcess: false,
			},
		})

		expect(await gateway.execute({ type: "project.select", directory: "/tmp/project" })).toEqual({
			ok: true,
			value: { id: "project-1", directory: "/tmp/project", name: "project" },
		})
		await gateway.execute({ type: "session.list", projectId: "project-1" })
		await gateway.execute({ type: "session.create", projectId: "project-1", title: "New" })
		await gateway.execute({
			type: "session.open",
			projectId: "project-1",
			sessionId: "session-1",
		})
		expect(await gateway.execute({
			type: "session.fork",
			projectId: "project-1",
			sessionId: "session-1",
			messageId: "message-user-2",
		})).toMatchObject({ ok: true, value: { id: "session-forked" } })
		expect(await gateway.execute({
			type: "session.revert",
			projectId: "project-1",
			sessionId: "session-1",
			messageId: "message-user-1",
		})).toEqual({
			ok: true,
			value: { sessionID: "session-1", messageID: "message-user-1" },
		})
		await gateway.execute({
			type: "prompt.send",
			projectId: "project-1",
			sessionId: "session-1",
			requestId: "request-1",
			text: "hello",
			model: { providerId: "provider", modelId: "model" },
			files: [
				{ type: "file", url: "file:///tmp/example.png", mediaType: "image/png", filename: "example.png" },
			],
		})
		await gateway.execute({
			type: "prompt.retry",
			projectId: "project-1",
			sessionId: "session-1",
			requestId: "request-2",
			failedRequestId: "request-1",
			text: "hello",
			model: { providerId: "provider", modelId: "model" },
		})
		await gateway.execute({
			type: "prompt.cancel",
			projectId: "project-1",
			sessionId: "session-1",
			requestId: "request-2",
		})

		expect(calls.map((call) => call.name)).toEqual([
			"project.current",
			"session.list",
			"session.create",
			"session.get",
			"session.fork",
			"session.revert",
			"session.promptAsync",
			"session.promptAsync",
			"session.abort",
		])
		expect(calls[4]?.value).toEqual({
			directory: "/tmp/project",
			sessionID: "session-1",
			messageID: "message-user-2",
		})
		expect(calls[5]?.value).toEqual({
			directory: "/tmp/project",
			sessionID: "session-1",
			messageID: "message-user-1",
		})
		expect(calls[6]?.value).toEqual({
			directory: "/tmp/project",
			sessionID: "session-1",
			parts: [
				{ type: "text", text: "hello" },
				{ type: "file", mime: "image/png", filename: "example.png", url: "file:///tmp/example.png" },
			],
			model: { providerID: "provider", modelID: "model" },
		})
	})

	test("maps the global SDK stream to a scoped contract stream", async () => {
		const gateway = new SdkOpenCodeGateway({ clientFactory: () => fakeClient([]) })
		await gateway.execute({
			type: "server.connect",
			connection: { baseUrl: "http://127.0.0.1:4096", directory: "/tmp/project" },
		})
		await gateway.execute({ type: "project.select", directory: "/tmp/project" })

		const values = []
		for await (const value of gateway.events({ projectId: "project-1" })) values.push(value)
		expect(values).toHaveLength(1)
		expect(values[0]?.sessionId).toBe("session-1")
		expect(values[0]?.payload.type).toBe("sdk.event")
	})

	test("does not expose credential material through the connection contract", async () => {
		let resolvedId: string | undefined
		const gateway = new SdkOpenCodeGateway({
			clientFactory: () => fakeClient([]),
			credentialFetch: (credentialId) => {
				resolvedId = credentialId
				return fetch
			},
		})
		await gateway.execute({
			type: "server.connect",
			connection: {
				baseUrl: "https://example.test",
				directory: "/tmp/project",
				credentialId: "keychain:remote",
			},
		})
		expect(resolvedId).toBe("keychain:remote")
	})

	test("fails closed when a credential reference has no host resolver", async () => {
		const gateway = new SdkOpenCodeGateway({ clientFactory: () => fakeClient([]) })
		const result = await gateway.execute({
			type: "server.connect",
			connection: {
				baseUrl: "https://example.test",
				directory: "/tmp/project",
				credentialId: "keychain:remote",
			},
		})
		expect(result.ok).toBe(false)
	})

	test("enforces startup timeout when a health request never settles", async () => {
		const client = fakeClient([])
		client.global.health = async () => await new Promise(() => {})
		const gateway = new SdkOpenCodeGateway({
			clientFactory: () => client,
			startupTimeoutMs: 25,
		})
		const started = performance.now()
		const result = await gateway.execute({
			type: "server.connect",
			connection: { baseUrl: "http://127.0.0.1:4096", directory: "/tmp/project" },
		})
		expect(result.ok).toBe(false)
		expect(performance.now() - started).toBeLessThan(500)
	})
})
