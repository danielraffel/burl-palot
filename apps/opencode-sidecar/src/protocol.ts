import type { OpenCodeCommand, OpenCodeEventSubscription } from "@palot/opencode"

export const SIDECAR_PROTOCOL_VERSION = 1 as const
export const MAX_FRAME_BYTES = 1024 * 1024

export interface CommandFrame {
	version: typeof SIDECAR_PROTOCOL_VERSION
	type: "command"
	id: string
	command: OpenCodeCommand
}

export interface SubscribeFrame {
	version: typeof SIDECAR_PROTOCOL_VERSION
	type: "subscribe"
	id: string
	subscription: Omit<OpenCodeEventSubscription, "signal">
}

export interface UnsubscribeFrame {
	version: typeof SIDECAR_PROTOCOL_VERSION
	type: "unsubscribe"
	id: string
	subscriptionId: string
}

export interface AbortFrame {
	version: typeof SIDECAR_PROTOCOL_VERSION
	type: "abort"
	id: string
	commandId: string
}

export interface ShutdownFrame {
	version: typeof SIDECAR_PROTOCOL_VERSION
	type: "shutdown"
	id: string
}

export type InputFrame =
	| CommandFrame
	| SubscribeFrame
	| UnsubscribeFrame
	| AbortFrame
	| ShutdownFrame

export type OutputFrame =
	| { version: 1; type: "ready"; pid: number }
	| { version: 1; type: "response"; id: string; result: unknown }
	| { version: 1; type: "subscribed"; id: string; subscriptionId: string }
	| { version: 1; type: "event"; subscriptionId: string; event: unknown }
	| { version: 1; type: "unsubscribed"; id: string; subscriptionId: string }
	| { version: 1; type: "aborted"; id: string; commandId: string; found: boolean }
	| { version: 1; type: "shutdown"; id: string }
	| { version: 1; type: "error"; id?: string; code: string; message: string }

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value)
}

const COMMAND_TYPES = new Set([
	"server.start",
	"server.connect",
	"project.select",
	"session.list",
	"session.create",
	"session.open",
	"prompt.send",
	"prompt.cancel",
	"prompt.retry",
])

function containsForbiddenCredentialField(value: unknown): boolean {
	if (Array.isArray(value)) return value.some(containsForbiddenCredentialField)
	if (!isRecord(value)) return false
	return Object.entries(value).some(([key, child]) => {
		if (key !== "credentialId" && /password|token|authorization|secret/i.test(key)) return true
		return containsForbiddenCredentialField(child)
	})
}

function assertCommand(value: unknown): asserts value is OpenCodeCommand {
	if (!isRecord(value) || typeof value.type !== "string" || !COMMAND_TYPES.has(value.type)) {
		throw new Error("invalid-command")
	}
	if (containsForbiddenCredentialField(value)) throw new Error("raw-credential-field-forbidden")
	if (value.type === "server.connect") {
		if (!isRecord(value.connection)) throw new Error("invalid-connection")
		const allowed = new Set(["baseUrl", "directory", "credentialId"])
		if (Object.keys(value.connection).some((key) => !allowed.has(key))) {
			throw new Error("connection-contains-unsupported-field")
		}
		if (
			typeof value.connection.baseUrl !== "string" ||
			typeof value.connection.directory !== "string"
		) {
			throw new Error("invalid-connection")
		}
	}
}

export function decodeFrame(line: string): InputFrame {
	if (Buffer.byteLength(line, "utf8") > MAX_FRAME_BYTES) throw new Error("frame-too-large")
	const value: unknown = JSON.parse(line)
	if (!isRecord(value)) throw new Error("frame-must-be-object")
	if (value.version !== SIDECAR_PROTOCOL_VERSION) throw new Error("unsupported-version")
	if (typeof value.id !== "string" || value.id.length === 0) throw new Error("missing-id")
	if (
		value.type !== "command" &&
		value.type !== "subscribe" &&
		value.type !== "unsubscribe" &&
		value.type !== "abort" &&
		value.type !== "shutdown"
	) {
		throw new Error("unknown-frame-type")
	}
	if (value.type === "command") assertCommand(value.command)
	return value as unknown as InputFrame
}

export function encodeFrame(frame: OutputFrame): string {
	return `${JSON.stringify(frame)}\n`
}
