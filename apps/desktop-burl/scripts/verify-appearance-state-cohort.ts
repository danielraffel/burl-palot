#!/usr/bin/env bun
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { verifyAppearanceStateCohortBundle } from "./appearance-state-cohort-receipts"

const argument = (name: string): string => {
	const index = process.argv.indexOf(name)
	if (index < 0 || !process.argv[index + 1])
		throw new Error(
			"usage: verify-appearance-state-cohort.ts --manifest manifest.json " +
				"--bundle receipts.json --review review.json --trusted-manifest-sha256 SHA256 " +
				"--report verification.json",
		)
	return resolve(process.argv[index + 1])
}

const manifestPath = argument("--manifest")
const bundlePath = argument("--bundle")
const reviewPath = argument("--review")
const trustedManifestSha256 = process.argv[process.argv.indexOf("--trusted-manifest-sha256") + 1]
if (!/^[0-9a-f]{64}$/.test(trustedManifestSha256 ?? ""))
	throw new Error("--trusted-manifest-sha256 requires an external SHA-256 trust anchor")
const reportPath = argument("--report")
const [manifestBytes, bundleBytes, reviewBytes] = await Promise.all([
	readFile(manifestPath),
	readFile(bundlePath),
	readFile(reviewPath),
])
const report = await verifyAppearanceStateCohortBundle({
	manifestBytes,
	bundleBytes,
	bundlePath,
	reviewBytes,
	trustedManifestSha256,
})
await mkdir(dirname(reportPath), { recursive: true })
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`)
if (!report.passed) {
	for (const failure of report.failures)
		console.error(`${failure.class}: ${failure.path}: ${failure.message}`)
	process.exit(1)
}
console.log(
	`${report.expandedStepCount} appearance state-cohort receipt(s) accepted; ` +
		`report=${reportPath}`,
)
