import { createInterface, type Interface } from "node:readline"
import type { Readable, Writable } from "node:stream"
import type { OpenCodeEventStream, OpenCodeGateway } from "@palot/opencode"
import {
	decodeFrame,
	encodeFrame,
	type InputFrame,
	type OutputFrame,
	SIDECAR_PROTOCOL_VERSION,
} from "./protocol"

export interface SidecarServerOptions {
	input: Readable
	output: Writable
	gateway: OpenCodeGateway & { close?: () => Promise<void> }
	pid?: number
}

export class SidecarServer {
	readonly #input: Readable
	readonly #output: Writable
	readonly #gateway: OpenCodeGateway & { close?: () => Promise<void> }
	readonly #pid: number
	readonly #commands = new Map<string, AbortController>()
	readonly #subscriptions = new Map<string, OpenCodeEventStream>()
	readonly #tasks = new Set<Promise<void>>()
	#stopping = false
	#lines?: Interface
	#stopPromise?: Promise<void>

	constructor(options: SidecarServerOptions) {
		this.#input = options.input
		this.#output = options.output
		this.#gateway = options.gateway
		this.#pid = options.pid ?? process.pid
	}

	async run(): Promise<void> {
		this.#write({ version: SIDECAR_PROTOCOL_VERSION, type: "ready", pid: this.#pid })
		this.#lines = createInterface({ input: this.#input, crlfDelay: Number.POSITIVE_INFINITY })
		for await (const line of this.#lines) {
			if (this.#stopping) break
			if (line.length === 0) continue
			try {
				this.#dispatch(decodeFrame(line))
			} catch (error) {
				this.#write({
					version: SIDECAR_PROTOCOL_VERSION,
					type: "error",
					code: "invalid-frame",
					message: error instanceof Error ? error.message : String(error),
				})
			}
		}
		await this.stop()
	}

	async stop(): Promise<void> {
		if (this.#stopPromise) return await this.#stopPromise
		this.#stopping = true
		this.#lines?.close()
		this.#input.destroy()
		this.#stopPromise = this.#performStop()
		return await this.#stopPromise
	}

	async #performStop(): Promise<void> {
		for (const controller of this.#commands.values()) controller.abort("sidecar shutdown")
		for (const stream of this.#subscriptions.values()) await stream.cancel("sidecar shutdown")
		await Promise.allSettled(this.#tasks)
		await this.#gateway.close?.()
		this.#commands.clear()
		this.#subscriptions.clear()
	}

	#dispatch(frame: InputFrame): void {
		switch (frame.type) {
			case "command": {
				if (this.#commands.has(frame.id)) {
					this.#writeError(frame.id, "duplicate-id", "A command with this id is already active")
					return
				}
				const controller = new AbortController()
				this.#commands.set(frame.id, controller)
				this.#track(
					this.#gateway
						.execute(frame.command, controller.signal)
						.then((result) => this.#write({ version: 1, type: "response", id: frame.id, result }))
						.finally(() => this.#commands.delete(frame.id)),
				)
				break
			}
			case "subscribe": {
				if (this.#subscriptions.has(frame.id)) {
					this.#writeError(frame.id, "duplicate-id", "A subscription with this id already exists")
					return
				}
				const stream = this.#gateway.events(frame.subscription)
				this.#subscriptions.set(frame.id, stream)
				this.#write({ version: 1, type: "subscribed", id: frame.id, subscriptionId: frame.id })
				this.#track(this.#pump(frame.id, stream))
				break
			}
			case "unsubscribe": {
				const stream = this.#subscriptions.get(frame.subscriptionId)
				this.#subscriptions.delete(frame.subscriptionId)
				this.#track(stream?.cancel("native client unsubscribed") ?? Promise.resolve())
				this.#write({
					version: 1,
					type: "unsubscribed",
					id: frame.id,
					subscriptionId: frame.subscriptionId,
				})
				break
			}
			case "abort": {
				const controller = this.#commands.get(frame.commandId)
				controller?.abort("native client aborted command")
				this.#write({
					version: 1,
					type: "aborted",
					id: frame.id,
					commandId: frame.commandId,
					found: !!controller,
				})
				break
			}
			case "shutdown":
				this.#write({ version: 1, type: "shutdown", id: frame.id })
				void this.stop()
				break
		}
	}

	async #pump(subscriptionId: string, stream: OpenCodeEventStream): Promise<void> {
		try {
			for await (const event of stream) {
				if (!this.#subscriptions.has(subscriptionId)) break
				this.#write({ version: 1, type: "event", subscriptionId, event })
			}
		} catch (error) {
			if (this.#subscriptions.has(subscriptionId)) {
				this.#writeError(
					subscriptionId,
					"event-stream",
					error instanceof Error ? error.message : String(error),
				)
			}
		} finally {
			this.#subscriptions.delete(subscriptionId)
		}
	}

	#track(task: Promise<void>): void {
		this.#tasks.add(task)
		void task.finally(() => this.#tasks.delete(task))
	}

	#write(frame: OutputFrame): void {
		if (!this.#output.destroyed) this.#output.write(encodeFrame(frame))
	}

	#writeError(id: string, code: string, message: string): void {
		this.#write({ version: 1, type: "error", id, code, message })
	}
}
