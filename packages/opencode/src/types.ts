import type {
	PermissionRuleset,
	Event as SdkEvent,
	Session as SdkSession,
} from "@opencode-ai/sdk/v2/client"

export const OPENCODE_CONTRACT_VERSION = 1 as const

export interface OpenCodeProject {
	id: string
	directory: string
	name: string
}

export interface OpenCodeConnection {
	baseUrl: string
	directory: string
	/** Opaque reference resolved below the privileged host boundary. */
	credentialId?: string
}

export interface StartServerCommand {
	type: "server.start"
	directory: string
	preferredPort?: number
}

export interface ConnectServerCommand {
	type: "server.connect"
	connection: OpenCodeConnection
}

export interface SelectProjectCommand {
	type: "project.select"
	directory: string
}

export interface ListSessionsCommand {
	type: "session.list"
	projectId: string
}

export interface CreateSessionCommand {
	type: "session.create"
	projectId: string
	title?: string
	permission?: PermissionRuleset
}

export interface OpenSessionCommand {
	type: "session.open"
	projectId: string
	sessionId: string
}

export interface SendPromptCommand {
	type: "prompt.send"
	projectId: string
	sessionId: string
	requestId: string
	text: string
	model: {
		providerId: string
		modelId: string
	}
}

export interface CancelPromptCommand {
	type: "prompt.cancel"
	projectId: string
	sessionId: string
	requestId: string
}

export interface RetryPromptCommand {
	type: "prompt.retry"
	projectId: string
	sessionId: string
	requestId: string
	failedRequestId: string
	model: {
		providerId: string
		modelId: string
	}
}

export type OpenCodeCommand =
	| StartServerCommand
	| ConnectServerCommand
	| SelectProjectCommand
	| ListSessionsCommand
	| CreateSessionCommand
	| OpenSessionCommand
	| SendPromptCommand
	| CancelPromptCommand
	| RetryPromptCommand

export interface OpenCodeServerHandle {
	baseUrl: string
	directory: string
	ownedProcess: boolean
}

export interface PromptRequestAccepted {
	requestId: string
	sessionId: string
}

export interface PromptRequestCancelled {
	requestId: string
	cancelled: boolean
}

export type OpenCodeCommandResponse<C extends OpenCodeCommand> = C extends
	| StartServerCommand
	| ConnectServerCommand
	? OpenCodeServerHandle
	: C extends SelectProjectCommand
		? OpenCodeProject
		: C extends ListSessionsCommand
			? SdkSession[]
			: C extends CreateSessionCommand | OpenSessionCommand
				? SdkSession
				: C extends SendPromptCommand | RetryPromptCommand
					? PromptRequestAccepted
					: C extends CancelPromptCommand
						? PromptRequestCancelled
						: never

export type OpenCodeErrorCode =
	| "aborted"
	| "authentication"
	| "conflict"
	| "invalid-request"
	| "not-found"
	| "server-unavailable"
	| "transport"
	| "unsupported"

export interface OpenCodeCommandError {
	code: OpenCodeErrorCode
	message: string
	retryable: boolean
	details?: Readonly<Record<string, unknown>>
}

export type OpenCodeCommandResult<T> =
	| { ok: true; value: T }
	| { ok: false; error: OpenCodeCommandError }

export type OpenCodeEventPayload =
	| { type: "connection.ready"; baseUrl: string }
	| { type: "connection.closed"; reason?: string }
	| { type: "session.created"; session: SdkSession }
	| { type: "session.updated"; session: SdkSession }
	| { type: "request.started"; requestId: string }
	| { type: "request.cancelled"; requestId: string }
	| { type: "request.completed"; requestId: string }
	| { type: "request.failed"; requestId: string; error: OpenCodeCommandError }
	| { type: "sdk.event"; event: SdkEvent }

export interface OpenCodeEventEnvelope {
	contractVersion: typeof OPENCODE_CONTRACT_VERSION
	/** Opaque resume cursor supplied by the transport. */
	cursor: string
	/** Strictly increasing within one stream subscription. */
	sequence: number
	projectId: string
	sessionId?: string
	receivedAt: string
	payload: OpenCodeEventPayload
}

export interface OpenCodeEventSubscription {
	projectId?: string
	sessionId?: string
	afterCursor?: string
	signal?: AbortSignal
}

export interface OpenCodeEventStream extends AsyncIterable<OpenCodeEventEnvelope> {
	cancel(reason?: string): Promise<void>
}

export interface OpenCodeGateway {
	execute<C extends OpenCodeCommand>(
		command: C,
		signal?: AbortSignal,
	): Promise<OpenCodeCommandResult<OpenCodeCommandResponse<C>>>
	events(subscription: OpenCodeEventSubscription): OpenCodeEventStream
}

export interface RetryPolicy {
	maxAttempts: number
	baseDelayMs: number
	maxDelayMs: number
}
