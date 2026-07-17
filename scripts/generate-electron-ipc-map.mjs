#!/usr/bin/env node

import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import process from "node:process"
import { spawnSync } from "node:child_process"

function parseArgs(argv) {
	const args = {
		burl: process.env.BURL_SOURCE_DIR ?? "",
		source: process.env.PALOT_SOURCE_DIR ?? "",
		out: "evidence/phase-b/electron-ipc-map.v1.json",
		revision: "fd63a75dad3d0e8555ba22a47e720d285889fbf0",
	}
	for (let index = 2; index < argv.length; index += 1) {
		const value = argv[index + 1]
		if (argv[index] === "--burl") {
			args.burl = value
			index += 1
		} else if (argv[index] === "--source") {
			args.source = value
			index += 1
		} else if (argv[index] === "--out") {
			args.out = value
			index += 1
		} else if (argv[index] === "--source-revision") {
			args.revision = value
			index += 1
		} else {
			throw new Error(`unknown argument: ${argv[index]}`)
		}
	}
	if (!args.burl || !args.source) {
		throw new Error("--burl and --source are required (or set BURL_SOURCE_DIR and PALOT_SOURCE_DIR)")
	}
	return args
}

function git(directory, ...args) {
	const result = spawnSync("git", ["-C", directory, ...args], { encoding: "utf8" })
	if (result.status !== 0) throw new Error(result.stderr.trim() || `git ${args.join(" ")} failed`)
	return result.stdout.trim()
}

function main() {
	const args = parseArgs(process.argv)
	const sourceRevision = git(args.source, "rev-parse", "HEAD")
	if (sourceRevision !== args.revision) {
		throw new Error(`source revision mismatch: expected ${args.revision}, found ${sourceRevision}`)
	}
	if (git(args.source, "status", "--porcelain")) {
		throw new Error("source checkout is not clean")
	}
	const frameworkRevision = git(args.burl, "rev-parse", "HEAD")
	const tool = path.join(args.burl, "tools/import-design/jsx-runtime/electron-ipc-map.mjs")
	const temporary = path.join(os.tmpdir(), `palot-electron-ipc-${process.pid}.json`)
	const result = spawnSync(
		process.execPath,
		[
			tool,
			"--root",
			args.source,
			"--preload",
			"apps/desktop/src/preload/index.ts",
			"--source-revision",
			sourceRevision,
			"--source-label",
			"palot",
			"--out",
			temporary,
		],
		{ encoding: "utf8" },
	)
	if (result.status !== 0) {
		fs.rmSync(temporary, { force: true })
		throw new Error(result.stderr.trim() || `IPC mapper exited ${result.status}`)
	}
	const report = JSON.parse(fs.readFileSync(temporary, "utf8"))
	fs.rmSync(temporary, { force: true })
	report.generator.frameworkRevision = frameworkRevision
	const output = `${JSON.stringify(report, null, 2)}\n`
	fs.mkdirSync(path.dirname(path.resolve(args.out)), { recursive: true })
	fs.writeFileSync(args.out, output)
}

try {
	main()
} catch (error) {
	console.error(error instanceof Error ? error.message : String(error))
	process.exitCode = 1
}
