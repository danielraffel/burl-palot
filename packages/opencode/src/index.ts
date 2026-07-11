/** Transport-independent OpenCode contracts implemented by each desktop host. */
export interface OpenCodeConnection {
	baseUrl: string
	directory: string
}

export interface OpenCodeSessionTransport {
	connect(connection: OpenCodeConnection, signal?: AbortSignal): Promise<void>
	disconnect(): Promise<void>
}
