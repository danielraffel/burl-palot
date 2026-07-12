#!/usr/bin/env bun

import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import sharp from "sharp"

const [manifestArg, rendererArg, outputArg] = process.argv.slice(2)
if (!manifestArg || !rendererArg || !outputArg)
	throw new Error("usage: run-native-component-gate.ts <manifest> <renderer> <output>")
const manifestPath = resolve(manifestArg)
const renderer = resolve(rendererArg)
const output = resolve(outputArg)
const manifest = JSON.parse(await readFile(manifestPath, "utf8"))
await mkdir(output, { recursive: true })

const raw = async (path: string) => sharp(path).ensureAlpha().raw().toBuffer()
const compare = async (
	sourcePath: string,
	candidatePath: string,
	width: number,
	height: number,
) => {
	const [source, candidate] = await Promise.all([raw(sourcePath), raw(candidatePath)])
	if (source.length !== candidate.length) throw new Error("exact-size comparison buffer mismatch")
	let absolute = 0
	let meanA = 0
	let meanB = 0
	const pixels = width * height
	const lumA = new Float64Array(pixels)
	const lumB = new Float64Array(pixels)
	const diff = Buffer.alloc(source.length)
	for (let p = 0; p < pixels; p++) {
		for (let c = 0; c < 4; c++) {
			const index = p * 4 + c
			const delta = Math.abs(source[index] - candidate[index])
			absolute += delta
			diff[index] = c === 3 ? 255 : delta
		}
		lumA[p] = 0.2126 * source[p * 4] + 0.7152 * source[p * 4 + 1] + 0.0722 * source[p * 4 + 2]
		lumB[p] =
			0.2126 * candidate[p * 4] + 0.7152 * candidate[p * 4 + 1] + 0.0722 * candidate[p * 4 + 2]
		meanA += lumA[p]
		meanB += lumB[p]
	}
	meanA /= pixels
	meanB /= pixels
	let varianceA = 0,
		varianceB = 0,
		covariance = 0,
		edgeError = 0,
		edgeCount = 0
	for (let p = 0; p < pixels; p++) {
		varianceA += (lumA[p] - meanA) ** 2
		varianceB += (lumB[p] - meanB) ** 2
		covariance += (lumA[p] - meanA) * (lumB[p] - meanB)
		const x = p % width,
			y = Math.floor(p / width)
		if (x && y) {
			const edgeA = Math.abs(lumA[p] - lumA[p - 1]) + Math.abs(lumA[p] - lumA[p - width])
			const edgeB = Math.abs(lumB[p] - lumB[p - 1]) + Math.abs(lumB[p] - lumB[p - width])
			edgeError += Math.abs(edgeA - edgeB) / 510
			edgeCount++
		}
	}
	varianceA /= Math.max(1, pixels - 1)
	varianceB /= Math.max(1, pixels - 1)
	covariance /= Math.max(1, pixels - 1)
	const c1 = (0.01 * 255) ** 2,
		c2 = (0.03 * 255) ** 2
	const ssim =
		((2 * meanA * meanB + c1) * (2 * covariance + c2)) /
		((meanA ** 2 + meanB ** 2 + c1) * (varianceA + varianceB + c2))
	return {
		mae: absolute / source.length / 255,
		ssim,
		edgeDiff: edgeError / Math.max(1, edgeCount),
		diff,
	}
}

const results = []
for (const record of manifest.records) {
	const wide = resolve(output, `${record.id}.wide.png`)
	const candidate = resolve(output, `${record.id}.png`)
	const process = Bun.spawnSync([
		renderer,
		resolve(dirname(manifestPath), record.irFile),
		wide,
		String(record.pixel.width),
		String(record.pixel.height),
		String(record.devicePixelRatio),
		record.interaction.kind,
	])
	if (process.exitCode !== 0)
		throw new Error(`${record.id}: renderer failed: ${process.stderr.toString()}`)
	const execution = JSON.parse(process.stdout.toString())
	await sharp(wide)
		.extract({ left: 0, top: 0, width: record.pixel.width, height: record.pixel.height })
		.png()
		.toFile(candidate)
	const metrics = await compare(
		record.sourceCrop,
		candidate,
		record.pixel.width,
		record.pixel.height,
	)
	const diffPath = resolve(output, `${record.id}.diff.png`)
	await sharp(metrics.diff, {
		raw: { width: record.pixel.width, height: record.pixel.height, channels: 4 },
	})
		.png()
		.toFile(diffPath)
	const blockers = []
	if (execution.irErrors) blockers.push("import diagnostics contain error")
	if (execution.materializeErrors) blockers.push("materialization diagnostics contain error")
	if (!execution.interactionSupported) blockers.push("post-action semantic unsupported")
	if (!execution.postActionPass) blockers.push("post-action semantic failed")
	if (record.interaction.applicationBindingRequired)
		blockers.push(
			`ApplicationBindingManifest dispatch not proven: ${record.interaction.actionIdentity}`,
		)
	results.push({
		...record,
		candidate,
		diff: diffPath,
		execution,
		metrics: { mae: metrics.mae, ssim: metrics.ssim, edgeDiff: metrics.edgeDiff },
		status: blockers.length ? "GAP" : "PASS",
		blockers,
	})
}
await writeFile(
	resolve(output, "evidence.json"),
	`${JSON.stringify({ schemaVersion: 1, backend: "real Skia raster", comparison: "exact pixel dimensions; no resizing", results }, null, 2)}\n`,
)
console.log(
	JSON.stringify(
		results.map(({ id, status, metrics, blockers }) => ({ id, status, metrics, blockers })),
		null,
		2,
	),
)
