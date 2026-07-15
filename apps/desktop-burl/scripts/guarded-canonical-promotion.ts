/** Stages imported IR and delegates canonical replacement to Burl's provenance gate. */
import { createHash } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"

interface GuardedCanonicalPromotionOptions {
	candidateBytes: string | Uint8Array
	stagingPath: string
	canonicalPath: string
	sourceWindowPath: string
	sourceCapturePath: string
	sourceCaptureMetaPath: string
	promotionReceiptPath: string
	guardReportPath: string
	burlSource: string
}

export interface GuardedCanonicalPromotionResult {
	stagingSha256: string
	canonicalSha256: string
	receiptPath: string
	guardReportPath: string
}

const sha256 = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex")

export async function promoteGuardedCanonicalCandidate(
	options: GuardedCanonicalPromotionOptions,
): Promise<GuardedCanonicalPromotionResult> {
	const stagingPath = resolve(options.stagingPath)
	const canonicalPath = resolve(options.canonicalPath)
	if (stagingPath === canonicalPath)
		throw new Error("guarded promotion requires a distinct staging path")
	const [sourceWindowBytes, sourceCaptureBytes, sourceCaptureMetaBytes] = await Promise.all([
		readFile(options.sourceWindowPath),
		readFile(options.sourceCapturePath),
		readFile(options.sourceCaptureMetaPath),
	])
	const sourceCapture = JSON.parse(sourceCaptureBytes.toString("utf8"))
	const sourceCaptureMeta = JSON.parse(sourceCaptureMetaBytes.toString("utf8"))
	const rootPredicateSha256 = sourceCapture.policy?.rootStatePredicate?.provenanceSha256
	const manifestSha256 = sourceCaptureMeta.manifestSha256
	const surfaceState = sourceCapture.policy?.windowSurfaceState
	if (!/^[0-9a-f]{64}$/.test(rootPredicateSha256 ?? ""))
		throw new Error("source capture has no hash-addressed root-state predicate")
	if (!/^[0-9a-f]{64}$/.test(manifestSha256 ?? ""))
		throw new Error("source capture metadata has no manifest SHA-256")
	if (surfaceState !== "transparent-preference" && surfaceState !== "opaque-preference")
		throw new Error("source capture has no authoritative windowSurfaceState")

	await Promise.all([
		mkdir(dirname(stagingPath), { recursive: true }),
		mkdir(dirname(options.promotionReceiptPath), { recursive: true }),
		mkdir(dirname(options.guardReportPath), { recursive: true }),
	])
	await writeFile(stagingPath, options.candidateBytes)
	const candidateSha256 = sha256(options.candidateBytes)
	const receipt = {
		schema: "burl-import-promotion-candidate-v1",
		candidateSha256,
		sourceWindowSha256: sha256(sourceWindowBytes),
		sourceCaptureSha256: sha256(sourceCaptureBytes),
		sourceCaptureManifestSha256: manifestSha256,
		rootStatePredicateSha256: rootPredicateSha256,
		surfaceState,
	}
	await writeFile(options.promotionReceiptPath, `${JSON.stringify(receipt, null, 2)}\n`)

	const python = Bun.which("python3")
	if (!python) throw new Error("python3 is required for Burl guarded import promotion")
	const guard = resolve(options.burlSource,
		"tools/import-validation/guarded_import_promotion.py")
	const process = Bun.spawn({
		cmd: [
			python, guard,
			"--candidate", stagingPath,
			"--canonical", canonicalPath,
			"--source-window", resolve(options.sourceWindowPath),
			"--source-capture", resolve(options.sourceCapturePath),
			"--source-capture-meta", resolve(options.sourceCaptureMetaPath),
			"--promotion-receipt", resolve(options.promotionReceiptPath),
			"--report", resolve(options.guardReportPath),
		],
		stdout: "pipe",
		stderr: "pipe",
	})
	const [exitCode, stdout, stderr] = await Promise.all([
		process.exited,
		new Response(process.stdout).text(),
		new Response(process.stderr).text(),
	])
	if (exitCode !== 0)
		throw new Error(`Burl guarded import promotion rejected the candidate: ${stderr.trim() || stdout.trim()}`)
	const canonicalBytes = await readFile(canonicalPath)
	const canonicalSha256 = sha256(canonicalBytes)
	if (canonicalSha256 !== candidateSha256)
		throw new Error("canonical artifact does not match the guarded staging candidate")
	return {
		stagingSha256: candidateSha256,
		canonicalSha256,
		receiptPath: resolve(options.promotionReceiptPath),
		guardReportPath: resolve(options.guardReportPath),
	}
}
