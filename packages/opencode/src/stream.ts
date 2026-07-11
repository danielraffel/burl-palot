import type { OpenCodeEventEnvelope, RetryPolicy } from "./types"

export interface CollectStreamOptions {
	signal?: AbortSignal
	lastCursor?: string
	lastSequence?: number
	limit?: number
}

/**
 * Collects ordered events while suppressing the one duplicate cursor commonly
 * replayed after SSE resume. Gaps and reordering fail closed.
 */
export async function collectOrderedEvents(
	events: AsyncIterable<OpenCodeEventEnvelope>,
	options: CollectStreamOptions = {},
): Promise<OpenCodeEventEnvelope[]> {
	const collected: OpenCodeEventEnvelope[] = []
	let lastCursor = options.lastCursor
	let lastSequence = options.lastSequence

	for await (const event of events) {
		if (options.signal?.aborted) {
			throw options.signal.reason ?? new Error("OpenCode event collection aborted")
		}
		if (event.cursor === lastCursor) continue
		if (lastSequence !== undefined && event.sequence !== lastSequence + 1) {
			throw new Error(
				`OpenCode event sequence violation: expected ${lastSequence + 1}, got ${event.sequence}`,
			)
		}

		collected.push(event)
		lastCursor = event.cursor
		lastSequence = event.sequence
		if (options.limit !== undefined && collected.length >= options.limit) break
	}

	return collected
}

export function retryDelayMs(attempt: number, policy: RetryPolicy): number | undefined {
	if (!Number.isInteger(attempt) || attempt < 1) {
		throw new Error("Retry attempt must be a positive integer")
	}
	if (
		!Number.isInteger(policy.maxAttempts) ||
		policy.maxAttempts < 1 ||
		policy.baseDelayMs < 0 ||
		policy.maxDelayMs < 0
	) {
		throw new Error("Retry policy must use positive attempts and non-negative delays")
	}
	if (attempt >= policy.maxAttempts) return undefined
	return Math.min(policy.baseDelayMs * 2 ** (attempt - 1), policy.maxDelayMs)
}
