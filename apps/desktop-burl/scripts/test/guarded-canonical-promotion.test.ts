import { createHash } from "node:crypto"
import { existsSync } from "node:fs"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterEach, describe, expect, test } from "bun:test"
import { promoteGuardedCanonicalCandidate } from "../guarded-canonical-promotion"

const sha256 = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex")
const canonicalJson = (value: unknown) => JSON.stringify(value, (_key, item) =>
	item && typeof item === "object" && !Array.isArray(item)
		? Object.fromEntries(Object.keys(item).sort().map((key) => [key, item[key]]))
		: item)
const framework = process.env.BURL_SOURCE_DIR ??
	resolve(import.meta.dir, "../../../../../burl-wt-native-migration-feasibility")
const guardAvailable = existsSync(resolve(framework,
	"tools/import-validation/guarded_import_promotion.py"))
const temporaryDirectories: string[] = []

afterEach(async () => {
	await Promise.all(temporaryDirectories.splice(0).map((path) =>
		rm(path, { recursive: true, force: true })))
})

async function fixture(backgroundColor: string) {
	const root = await mkdtemp(join(tmpdir(), "burl-palot-promotion-"))
	temporaryDirectories.push(root)
	const paths = {
		staging: join(root, "candidate.json"),
		canonical: join(root, "canonical.json"),
		window: join(root, "window.json"),
		capture: join(root, "source.json"),
		meta: join(root, "meta.json"),
		receipt: join(root, "receipt.json"),
		report: join(root, "guard-report.json"),
	}
	const predicateDeclaration = {
		selector: ":root",
		requiredAttributes: [{ name: "data-surface", value: "transparent" }],
	}
	const predicateSha256 = sha256(canonicalJson(predicateDeclaration))
	const sourceCaptureBytes = `${JSON.stringify({
		schema: "pulp-runtime-source-capture-v1",
		policy: {
			hostServices: "live-existing",
			windowSurfaceState: "transparent-preference",
			rootStatePredicate: {
				schema: "burl-root-state-predicate-receipt-v1",
				status: "passed",
				provenanceSha256: predicateSha256,
				declaration: predicateDeclaration,
				matchedCount: 1,
			},
		},
	})}\n`
	const manifestSha256 = "d".repeat(64)
	await Promise.all([
		writeFile(paths.canonical, "previous-canonical"),
		writeFile(paths.window, `${JSON.stringify({
			schema: "burl-source-window-contract-v1",
			observations: { transparent: true },
			projection: { transparent: true, backdropEffect: "system-material" },
		})}\n`),
		writeFile(paths.capture, sourceCaptureBytes),
		writeFile(paths.meta, `${JSON.stringify({
			schema: "pulp-runtime-source-capture-v1",
			evidenceSha256: sha256(sourceCaptureBytes),
			manifestSha256,
		})}\n`),
	])
	const candidateBytes = `${JSON.stringify({
		version: 1,
		root: {
			layout: { widthMode: "fill", heightMode: "fill" },
			style: { backgroundColor, backgroundLayers: [] },
		},
	})}\n`
	return { paths, candidateBytes }
}

describe("consumer guarded canonical promotion", () => {
	const realTest = guardAvailable ? test : test.skip

	realTest("rejects an opaque covering root without replacing canonical IR", async () => {
		const { paths, candidateBytes } = await fixture("#181818ff")
		expect(JSON.parse(candidateBytes).root.style.backgroundColor).toBe("#181818ff")
		await expect(promoteGuardedCanonicalCandidate({
			candidateBytes,
			stagingPath: paths.staging,
			canonicalPath: paths.canonical,
			sourceWindowPath: paths.window,
			sourceCapturePath: paths.capture,
			sourceCaptureMetaPath: paths.meta,
			promotionReceiptPath: paths.receipt,
			guardReportPath: paths.report,
			burlSource: framework,
		})).rejects.toThrow("surfaceState=opaque-preference")
		expect(await readFile(paths.canonical, "utf8")).toBe("previous-canonical")
		expect(await readFile(paths.staging, "utf8")).toBe(candidateBytes)
	})

	realTest("promotes a transparent root through the real framework gate", async () => {
		const { paths, candidateBytes } = await fixture("#18181866")
		const result = await promoteGuardedCanonicalCandidate({
			candidateBytes,
			stagingPath: paths.staging,
			canonicalPath: paths.canonical,
			sourceWindowPath: paths.window,
			sourceCapturePath: paths.capture,
			sourceCaptureMetaPath: paths.meta,
			promotionReceiptPath: paths.receipt,
			guardReportPath: paths.report,
			burlSource: framework,
		})
		expect(await readFile(paths.canonical, "utf8")).toBe(candidateBytes)
		expect(result.canonicalSha256).toBe(sha256(candidateBytes))
		expect(JSON.parse(await readFile(paths.report, "utf8")).status).toBe("promoted")
	})
})
