#!/usr/bin/env bun
import { SdkOpenCodeGateway } from "@palot/opencode/node"
import { SidecarServer } from "./server"

const gateway = new SdkOpenCodeGateway()
const server = new SidecarServer({ input: process.stdin, output: process.stdout, gateway })

let stopping = false
const stop = async (): Promise<void> => {
	if (stopping) return
	stopping = true
	await server.stop()
}

process.once("SIGINT", () => void stop())
process.once("SIGTERM", () => void stop())

await server.run()
