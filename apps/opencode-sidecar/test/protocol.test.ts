import { describe, expect, test } from "bun:test"
import { PassThrough } from "node:stream"
import type {
	OpenCodeCommand,
	OpenCodeCommandResponse,
	OpenCodeCommandResult,
	OpenCodeEventStream,
	OpenCodeEventSubscription,
	OpenCodeGateway,
} from "@palot/opencode"
import { decodeFrame, encodeFrame } from "../src/protocol"
import { SidecarServer } from "../src/server"

class FakeGateway implements OpenCodeGateway {
	closed = false
	readonly #delayCommands: boolean

	constructor(delayCommands = false) {
		this.#delayCommands = delayCommands
	}

	async execute<C extends OpenCodeCommand>(
		command: C,
		signal?: AbortSignal,
	): Promise<OpenCodeCommandResult<OpenCodeCommandResponse<C>>> {
		if (this.#delayCommands) {
			await new Promise<void>((resolve) => signal?.addEventListener("abort", () => resolve(), { once: true }))
		}
		return { ok: false, error: { code: "unsupported", message: command.type, retryable: false } }
	}

	events(_subscription: OpenCodeEventSubscription): OpenCodeEventStream {
		return {
			cancel: async () => {},
			async *[Symbol.asyncIterator]() {
				yield {
					contractVersion: 1,
					cursor: "1",
					sequence: 1,
					projectId: "project-1",
					receivedAt: "2026-07-11T00:00:00.000Z",
					payload: { type: "connection.ready", baseUrl: "http://127.0.0.1" },
				}
			},
		}
	}

	async close(): Promise<void> {
		this.closed = true
	}
}

const waitForFrames = async (output: PassThrough, count: number): Promise<unknown[]> => {
	let text = ""
	return await new Promise((resolve) => {
		const inspect = (chunk: Buffer): void => {
			text += chunk.toString()
			const frames = text
				.trim()
				.split("\n")
				.filter(Boolean)
				.map((line) => JSON.parse(line))
			if (frames.length >= count) {
				output.off("data", inspect)
				resolve(frames)
			}
		}
		output.on("data", inspect)
	})
}

describe("sidecar framing", () => {
	test("round-trips one JSON object per line", () => {
		const encoded = encodeFrame({ version: 1, type: "ready", pid: 42 })
		expect(encoded).toBe('{"version":1,"type":"ready","pid":42}\n')
		expect(
			decodeFrame('{"version":1,"type":"shutdown","id":"shutdown-1"}'),
		).toEqual({ version: 1, type: "shutdown", id: "shutdown-1" })
	})

	test("rejects unknown versions and frame types", () => {
		expect(() => decodeFrame('{"version":2,"type":"shutdown","id":"1"}')).toThrow(
			"unsupported-version",
		)
		expect(() => decodeFrame('{"version":1,"type":"secret","id":"1"}')).toThrow(
			"unknown-frame-type",
		)
	})

	test("rejects raw credential fields on connection commands", () => {
		expect(() =>
			decodeFrame(
				'{"version":1,"type":"command","id":"1","command":{"type":"server.connect","connection":{"baseUrl":"https://example.test","directory":"/tmp","authToken":"raw"}}}',
			),
		).toThrow("raw-credential-field-forbidden")
	})
})

test("serves concurrent command and event frames then shuts down cleanly", async () => {
	const input = new PassThrough()
	const output = new PassThrough()
	const gateway = new FakeGateway()
	const server = new SidecarServer({ input, output, gateway, pid: 42 })
	const framesPromise = waitForFrames(output, 4)
	const run = server.run()

	input.write(
		'{"version":1,"type":"command","id":"cmd-1","command":{"type":"session.list","projectId":"project-1"}}\n',
	)
	input.write(
		'{"version":1,"type":"subscribe","id":"events-1","subscription":{"projectId":"project-1"}}\n',
	)

	const frames = (await framesPromise) as Array<{ type: string }>
	const types = frames.map((frame) => frame.type)
	expect(types[0]).toBe("ready")
	expect(new Set(types.slice(1))).toEqual(new Set(["subscribed", "response", "event"]))
	input.write('{"version":1,"type":"shutdown","id":"shutdown-1"}\n')
	await run
	expect(gateway.closed).toBe(true)
})

test("aborts an in-flight command by correlation id", async () => {
	const input = new PassThrough()
	const output = new PassThrough()
	const gateway = new FakeGateway(true)
	const server = new SidecarServer({ input, output, gateway, pid: 42 })
	const framesPromise = waitForFrames(output, 3)
	const run = server.run()

	input.write(
		'{"version":1,"type":"command","id":"cmd-1","command":{"type":"session.list","projectId":"project-1"}}\n',
	)
	input.write(
		'{"version":1,"type":"abort","id":"abort-1","commandId":"cmd-1"}\n',
	)
	const frames = (await framesPromise) as Array<{ type: string; found?: boolean }>
	expect(frames.some((frame) => frame.type === "aborted" && frame.found)).toBe(true)
	expect(frames.some((frame) => frame.type === "response")).toBe(true)

	input.write('{"version":1,"type":"shutdown","id":"shutdown-1"}\n')
	await run
})
