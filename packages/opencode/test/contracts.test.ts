import { describe, expect, test } from "bun:test"
import {
	collectOrderedEvents,
	OPENCODE_CONTRACT_VERSION,
	retryDelayMs,
	type OpenCodeCommand,
	type OpenCodeEventEnvelope,
} from "../src"

const event = (sequence: number, cursor = `cursor-${sequence}`): OpenCodeEventEnvelope => ({
	contractVersion: OPENCODE_CONTRACT_VERSION,
	cursor,
	sequence,
	projectId: "project-1",
	sessionId: "session-1",
	receivedAt: "2026-07-11T00:00:00.000Z",
	payload: { type: "request.started", requestId: "request-1" },
})

async function* stream(values: OpenCodeEventEnvelope[]): AsyncGenerator<OpenCodeEventEnvelope> {
	for (const value of values) yield value
}

describe("OpenCode command contract", () => {
	test("requires an explicit resolved model for prompt and retry commands", () => {
		const commands: OpenCodeCommand[] = [
			{
				type: "prompt.send",
				projectId: "project-1",
				sessionId: "session-1",
				requestId: "request-1",
				text: "Hello",
				model: { providerId: "provider", modelId: "model" },
			},
			{
				type: "prompt.retry",
				projectId: "project-1",
				sessionId: "session-1",
				requestId: "request-2",
				failedRequestId: "request-1",
				model: { providerId: "provider", modelId: "model" },
			},
		]

		expect(commands.map((command) => command.type)).toEqual(["prompt.send", "prompt.retry"])
	})

	test("cancellation identifies the exact project, session, and request", () => {
		const command: OpenCodeCommand = {
			type: "prompt.cancel",
			projectId: "project-1",
			sessionId: "session-1",
			requestId: "request-1",
		}
		expect(command).toEqual({
			type: "prompt.cancel",
			projectId: "project-1",
			sessionId: "session-1",
			requestId: "request-1",
		})
	})
})

describe("ordered event collection", () => {
	test("collects a contiguous stream", async () => {
		expect(await collectOrderedEvents(stream([event(1), event(2), event(3)]))).toHaveLength(3)
	})

	test("suppresses the resume cursor replay", async () => {
		const values = await collectOrderedEvents(stream([event(3, "resume"), event(4)]), {
			lastCursor: "resume",
			lastSequence: 3,
		})
		expect(values.map((value) => value.sequence)).toEqual([4])
	})

	test("fails closed on a gap or reordered event", async () => {
		expect(collectOrderedEvents(stream([event(1), event(3)]))).rejects.toThrow(
			"expected 2, got 3",
		)
	})

	test("honors AbortSignal cancellation", async () => {
		const controller = new AbortController()
		controller.abort(new Error("cancelled by test"))
		expect(
			collectOrderedEvents(stream([event(1)]), { signal: controller.signal }),
		).rejects.toThrow("cancelled by test")
	})
})

describe("retry policy", () => {
	test("backs off with a cap and stops at max attempts", () => {
		const policy = { maxAttempts: 4, baseDelayMs: 100, maxDelayMs: 250 }
		expect([1, 2, 3, 4].map((attempt) => retryDelayMs(attempt, policy))).toEqual([
			100,
			200,
			250,
			undefined,
		])
	})

	test("rejects invalid attempt numbers", () => {
		expect(() => retryDelayMs(0, { maxAttempts: 2, baseDelayMs: 1, maxDelayMs: 2 })).toThrow()
	})

	test("rejects invalid policy values", () => {
		expect(() => retryDelayMs(1, { maxAttempts: 0, baseDelayMs: 1, maxDelayMs: 2 })).toThrow()
	})
})
