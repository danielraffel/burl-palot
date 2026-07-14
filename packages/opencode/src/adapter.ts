import { type ChildProcess, spawn } from "node:child_process"
import { createServer } from "node:net"
import { basename } from "node:path"
import type { OpencodeClient } from "@opencode-ai/sdk/v2/client"
import { createOpencodeClient } from "@opencode-ai/sdk/v2/client"
import {
	OPENCODE_CONTRACT_VERSION,
	type OpenCodeCommand,
	type OpenCodeCommandError,
	type OpenCodeCommandResponse,
	type OpenCodeCommandResult,
	type OpenCodeEventEnvelope,
	type OpenCodeEventStream,
	type OpenCodeEventSubscription,
	type OpenCodeGateway,
	type OpenCodeProject,
} from "./types"

export type CredentialFetchFactory = (credentialId: string) => typeof fetch

export interface OpenCodeAdapterOptions {
	binaryPath?: string
	startupTimeoutMs?: number
	/** Creates a fetch implementation that injects credentials below this boundary. */
	credentialFetch?: CredentialFetchFactory
	clientFactory?: typeof createOpencodeClient
}

interface ProjectContext {
	directory: string
	eventDirectories: ReadonlySet<string>
	client: OpencodeClient
}

function commandError(error: unknown): OpenCodeCommandError {
	if (error instanceof DOMException && error.name === "AbortError") {
		return { code: "aborted", message: error.message, retryable: false }
	}
	const message = error instanceof Error ? error.message : String(error)
	const normalized = message.toLowerCase()
	if (normalized.includes("401") || normalized.includes("403")) {
		return { code: "authentication", message, retryable: false }
	}
	if (normalized.includes("404")) return { code: "not-found", message, retryable: false }
	return { code: "transport", message, retryable: true }
}

async function availablePort(preferredPort?: number): Promise<number> {
	return await new Promise((resolve, reject) => {
		const server = createServer()
		server.once("error", reject)
		server.listen(preferredPort ?? 0, "127.0.0.1", () => {
			const address = server.address()
			if (!address || typeof address === "string") {
				server.close()
				reject(new Error("Unable to allocate an OpenCode server port"))
				return
			}
			server.close((error) => (error ? reject(error) : resolve(address.port)))
		})
	})
}

async function healthWithDeadline(
	client: OpencodeClient,
	signal: AbortSignal | undefined,
	remainingMs: number,
): Promise<Awaited<ReturnType<OpencodeClient["global"]["health"]>>> {
	const timeout = new AbortController()
	const combined = signal ? AbortSignal.any([signal, timeout.signal]) : timeout.signal
	let rejectAbort: ((reason: unknown) => void) | undefined
	const aborted = new Promise<never>((_, reject) => {
		rejectAbort = reject
	})
	const onAbort = () => rejectAbort?.(combined.reason ?? new DOMException("Aborted", "AbortError"))
	combined.addEventListener("abort", onAbort, { once: true })
	const timer = setTimeout(() => {
		const error = new Error("OpenCode server startup timed out")
		timeout.abort(error)
	}, Math.max(1, remainingMs))
	try {
		if (combined.aborted) onAbort()
		return await Promise.race([client.global.health({ signal: combined }), aborted])
	} finally {
		clearTimeout(timer)
		combined.removeEventListener("abort", onAbort)
	}
}

class SdkEventStream implements OpenCodeEventStream {
	readonly #subscription: OpenCodeEventSubscription
	readonly #source: AsyncIterable<{ directory: string; payload: unknown }>
	readonly #projectIdForDirectory: (directory: string) => string | undefined
	readonly #controller: AbortController
	#sequence: number

	constructor(
		source: AsyncIterable<{ directory: string; payload: unknown }>,
		subscription: OpenCodeEventSubscription,
		projectIdForDirectory: (directory: string) => string | undefined,
		controller: AbortController,
	) {
		this.#source = source
		this.#subscription = subscription
		this.#projectIdForDirectory = projectIdForDirectory
		this.#controller = controller
		this.#sequence = Number.parseInt(subscription.afterCursor ?? "0", 10) || 0
		if (subscription.signal) {
			subscription.signal.addEventListener("abort", () => this.#controller.abort(), { once: true })
		}
	}

	async cancel(reason?: string): Promise<void> {
		this.#controller.abort(reason)
	}

	async *[Symbol.asyncIterator](): AsyncIterator<OpenCodeEventEnvelope> {
		for await (const item of this.#source) {
			if (this.#controller.signal.aborted) return
			const projectId = this.#projectIdForDirectory(item.directory)
			if (
				!projectId ||
				(this.#subscription.projectId && projectId !== this.#subscription.projectId)
			) {
				continue
			}
			const sdkEvent = item.payload as OpenCodeEventEnvelope["payload"] extends {
				type: "sdk.event"
				event: infer E
			}
				? E
				: never
			const sessionId = getSessionId(sdkEvent)
			if (this.#subscription.sessionId && sessionId !== this.#subscription.sessionId) continue

			this.#sequence += 1
			yield {
				contractVersion: OPENCODE_CONTRACT_VERSION,
				cursor: String(this.#sequence),
				sequence: this.#sequence,
				projectId,
				sessionId,
				receivedAt: new Date().toISOString(),
				payload: { type: "sdk.event", event: sdkEvent },
			}
		}
	}
}

function getSessionId(event: unknown): string | undefined {
	if (!event || typeof event !== "object" || !("properties" in event)) return undefined
	const properties = event.properties
	if (!properties || typeof properties !== "object") return undefined
	if ("sessionID" in properties && typeof properties.sessionID === "string") {
		return properties.sessionID
	}
	if ("info" in properties && properties.info && typeof properties.info === "object") {
		const info = properties.info
		if ("id" in info && typeof info.id === "string") return info.id
	}
	return undefined
}

export class SdkOpenCodeGateway implements OpenCodeGateway {
	readonly #options: Required<Pick<OpenCodeAdapterOptions, "binaryPath" | "startupTimeoutMs">> &
		OpenCodeAdapterOptions
	readonly #projects = new Map<string, ProjectContext>()
	#client?: OpencodeClient
	#baseUrl?: string
	#ownedProcess?: ChildProcess

	constructor(options: OpenCodeAdapterOptions = {}) {
		this.#options = {
			...options,
			binaryPath: options.binaryPath ?? "opencode",
			startupTimeoutMs: options.startupTimeoutMs ?? 15_000,
		}
	}

	async close(): Promise<void> {
		this.#ownedProcess?.kill("SIGTERM")
		this.#ownedProcess = undefined
	}

	async execute<C extends OpenCodeCommand>(
		command: C,
		signal?: AbortSignal,
	): Promise<OpenCodeCommandResult<OpenCodeCommandResponse<C>>> {
		try {
			if (signal?.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError")
			const value = await this.#execute(command, signal)
			return { ok: true, value: value as OpenCodeCommandResponse<C> }
		} catch (error) {
			return { ok: false, error: commandError(error) }
		}
	}

	events(subscription: OpenCodeEventSubscription): OpenCodeEventStream {
		if (!this.#client) throw new Error("Connect to OpenCode before subscribing to events")
		const controller = new AbortController()
		let cancelled = false
		const source: AsyncIterable<{ directory: string; payload: unknown }> = {
			[Symbol.asyncIterator]: () => {
				let iterator: AsyncIterator<{ directory: string; payload: unknown }> | undefined
				return {
					next: async () => {
						if (cancelled) return { done: true, value: undefined }
						if (!iterator) {
							const result = await this.#client?.global.event({ signal: controller.signal })
							iterator = result?.stream[Symbol.asyncIterator]() as AsyncIterator<{
								directory: string
								payload: unknown
							}>
						}
						return await iterator.next()
					},
					return: async () => {
						cancelled = true
						return (await iterator?.return?.()) ?? { done: true, value: undefined }
					},
				}
			},
		}
		return new SdkEventStream(
			source,
			subscription,
			(directory) =>
				[...this.#projects.entries()].find(([, context]) =>
					context.eventDirectories.has(directory),
				)?.[0],
			controller,
		)
	}

	async #execute(command: OpenCodeCommand, signal?: AbortSignal): Promise<unknown> {
		switch (command.type) {
			case "server.start":
				return await this.#start(command.directory, command.preferredPort, signal)
			case "server.connect":
				return await this.#connect(
					command.connection.baseUrl,
					command.connection.directory,
					command.connection.credentialId,
					signal,
				)
			case "project.select": {
				const client = this.#requireClient()
				const result = await client.project.current({ directory: command.directory }, { signal })
				if (!result.data) throw result.error ?? new Error("OpenCode did not return a project")
				const project: OpenCodeProject = {
					id: result.data.id,
					directory: command.directory,
					name: result.data.name ?? basename(command.directory),
				}
				this.#projects.set(project.id, {
					directory: project.directory,
					eventDirectories: new Set([project.directory, result.data.worktree]),
					client,
				})
				return project
			}
			case "session.list": {
				const context = this.#project(command.projectId)
				const result = await context.client.session.list(
					{ directory: context.directory },
					{ signal },
				)
				if (!result.data) throw result.error ?? new Error("OpenCode did not return sessions")
				return result.data
			}
			case "session.create": {
				const context = this.#project(command.projectId)
				const result = await context.client.session.create(
					{
						directory: context.directory,
						title: command.title,
						permission: command.permission,
					},
					{ signal },
				)
				if (!result.data) throw result.error ?? new Error("OpenCode did not create a session")
				return result.data
			}
			case "session.open": {
				const context = this.#project(command.projectId)
				const result = await context.client.session.get(
					{
						directory: context.directory,
						sessionID: command.sessionId,
					},
					{ signal },
				)
				if (!result.data) throw result.error ?? new Error("OpenCode session was not found")
				return result.data
			}
			case "session.fork": {
				const context = this.#project(command.projectId)
				const result = await context.client.session.fork(
					{ directory: context.directory, sessionID: command.sessionId,
					  messageID: command.messageId },
					{ signal },
				)
				if (!result.data) throw result.error ?? new Error("OpenCode did not fork the session")
				return result.data
			}
			case "session.revert": {
				const context = this.#project(command.projectId)
				const result = await context.client.session.revert(
					{ directory: context.directory, sessionID: command.sessionId,
					  messageID: command.messageId },
					{ signal },
				)
				if (result.error) throw result.error
				return result.data
			}
			case "prompt.send":
			case "prompt.retry": {
				const context = this.#project(command.projectId)
				const result = await context.client.session.promptAsync(
					{
						directory: context.directory,
						sessionID: command.sessionId,
						parts: [
							{ type: "text" as const, text: command.text },
							...(command.files ?? []).map((file) => ({
								type: "file" as const,
								mime: file.mediaType ?? "application/octet-stream",
								filename: file.filename,
								url: file.url,
							})),
						],
						model: {
							providerID: command.model.providerId,
							modelID: command.model.modelId,
						},
					},
					{ signal },
				)
				if (result.error) throw result.error
				return { requestId: command.requestId, sessionId: command.sessionId }
			}
			case "prompt.cancel": {
				const context = this.#project(command.projectId)
				const result = await context.client.session.abort(
					{
						directory: context.directory,
						sessionID: command.sessionId,
					},
					{ signal },
				)
				if (result.error) throw result.error
				return { requestId: command.requestId, cancelled: result.data === true }
			}
		}
	}

	async #start(directory: string, preferredPort?: number, signal?: AbortSignal): Promise<unknown> {
		const port = await availablePort(preferredPort)
		const child = spawn(
			this.#options.binaryPath,
			["serve", "--hostname=127.0.0.1", `--port=${port}`],
			{ cwd: directory, stdio: "ignore" },
		)
		this.#ownedProcess = child
		child.once("exit", () => {
			if (this.#ownedProcess === child) this.#ownedProcess = undefined
		})
		try {
			return await this.#connect(`http://127.0.0.1:${port}`, directory, undefined, signal)
		} catch (error) {
			child.kill("SIGTERM")
			throw error
		}
	}

	async #connect(
		baseUrl: string,
		directory: string,
		credentialId?: string,
		signal?: AbortSignal,
	): Promise<unknown> {
		if (credentialId && !this.#options.credentialFetch) {
			throw new Error("A credential fetch factory is required for credential-backed connections")
		}
		const factory = this.#options.clientFactory ?? createOpencodeClient
		const client = factory({
			baseUrl,
			directory,
			fetch: credentialId ? this.#options.credentialFetch?.(credentialId) : undefined,
		})
		const deadline = Date.now() + this.#options.startupTimeoutMs
		let lastError: unknown
		do {
			if (signal?.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError")
			try {
				const health = await healthWithDeadline(client, signal, deadline - Date.now())
				if (health.data) {
					this.#client = client
					this.#baseUrl = baseUrl
					return { baseUrl, directory, ownedProcess: !!this.#ownedProcess }
				}
				lastError = health.error
			} catch (error) {
				lastError = error
			}
			await new Promise((resolve) => setTimeout(resolve, 100))
		} while (Date.now() < deadline)
		throw lastError ?? new Error(`OpenCode server unavailable at ${baseUrl}`)
	}

	#requireClient(): OpencodeClient {
		if (!this.#client || !this.#baseUrl) throw new Error("Connect to OpenCode first")
		return this.#client
	}

	#project(projectId: string): ProjectContext {
		const context = this.#projects.get(projectId)
		if (!context) throw new Error(`Unknown OpenCode project: ${projectId}`)
		return context
	}
}
