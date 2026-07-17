import { createHash, generateKeyPairSync, sign } from "node:crypto"
import { mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterEach, describe, expect, test } from "bun:test"
import sharp from "sharp"
import {
	bundleEvidenceSha256,
	candidateArtifactSetSha256,
	canonicalSha256,
	manifestSha256,
	requireAcceptedAppearanceStateCohortReport,
	stateCohortSha256,
	validateAppearanceStateCohortManifest,
	verifyAppearanceStateCohortBundle,
} from "../appearance-state-cohort-receipts"

const temporaryDirectories: string[] = []
const sha256 = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex")

afterEach(async () => {
	await Promise.all(temporaryDirectories.splice(0).map((path) =>
		rm(path, { recursive: true, force: true })))
})

const canonicalize = (value: any): any => {
	if (Array.isArray(value)) return value.map(canonicalize)
	if (!value || typeof value !== "object") return value
	return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]))
}

const descriptors = (value: any, result: Array<{ path: string, sha256: string }> = []) => {
	if (Array.isArray(value)) for (const item of value) descriptors(item, result)
	else if (value && typeof value === "object") {
		if (typeof value.path === "string" && /^[0-9a-f]{64}$/.test(value.sha256 ?? ""))
			result.push({ path: value.path, sha256: value.sha256 })
		for (const item of Object.values(value)) descriptors(item, result)
	}
	return result
}

const regionHash = (pixels: Uint8Array, width: number, height: number) =>
	sha256(Buffer.concat([Buffer.from(`${width}x${height}:`), Buffer.from(pixels)]))

const png = async (seed: number, highDiff = false) => {
	const width = 32
	const height = 24
	const pixels = new Uint8Array(width * height * 4)
	for (let index = 0; index < width * height; ++index) {
		pixels[index * 4] = highDiff ? 255 : (index * 7 + seed) % 256
		pixels[index * 4 + 1] = highDiff ? 0 : (index * 11 + seed * 2) % 256
		pixels[index * 4 + 2] = highDiff ? 255 : (index * 13 + seed * 3) % 256
		pixels[index * 4 + 3] = 255
	}
	return {
		bytes: await sharp(pixels, { raw: { width, height, channels: 4 } }).png().toBuffer(),
		pixels,
		width,
		height,
	}
}

const minimalManifest = (publicKeyPem: string) => ({
	schema: "burl-native-state-cohort-receipt-manifest-v1",
	receiptCompatibility: {
		baseSchema: "burl-live-react-interaction-receipt-v2",
		expansionRules: { "key-sequence": "one base receipt per key" },
	},
	sourceAuthority: {
		revision: "source-revision",
		files: [{ path: "settings.tsx", sha256: "f".repeat(64) }],
	},
	environment: { viewport: { width: 32, height: 24, deviceScaleFactor: 1 }, systemColorScheme: "light" },
	semanticTargets: ["settings.theme.light", "settings.theme.dark"],
	initialState: {
		react: { "appearance.colorScheme.selection": "dark", "appearance.colorScheme.resolved": "dark" },
		importedTree: { "appearance.colorScheme.selection": "dark", "appearance.colorScheme.resolved": "dark" },
		storage: { "localStorage:colorScheme": "\"dark\"" },
		theme: { paletteRegions: { "settings.sidebar": "dark" } },
	},
	scenarios: [{
		id: "keyboard-focus",
		resetToInitialState: true,
		steps: [{
			id: "tab-through-theme",
			operation: "key-sequence",
			keys: ["Tab", "Tab"],
			expected: { callbackDelta: 0, stateChanges: {}, focusOrder: ["settings.theme.light", "settings.theme.dark"] },
		}],
	}],
	screenshotRegions: [{ id: "settings.sidebar", anchor: "settings.sidebar" }],
	captureGate: {
		comparison: {
			metric: "tolerance-mae-plus-region-diff",
			pixelChannelTolerance: 16,
			maxMeanAbsoluteError: 8,
			maxDifferentPixelPercent: 5,
			contentFloor: {
				minUniqueColors: 16,
				minLuminanceStddev: 1,
				minNonBackgroundCoverage: 0.05,
				minOpaqueCoverage: 0.95,
			},
			contentFloorRequired: true,
			skiaBackendOnlyForNative: true,
		},
		independentReview: {
			signatureAlgorithm: "ed25519",
			allowedReviewerPublicKeys: [{ reviewerId: "reviewer-key-1", publicKeyPem,
				publicKeySha256: sha256(publicKeyPem) }],
		},
	},
	failureClasses: { "cohort-theme-split": "Dark selected with a light sidebar fails." },
})

async function validFixture() {
	const root = await mkdtemp(join(tmpdir(), "appearance-state-cohort-"))
	temporaryDirectories.push(root)
	const { publicKey, privateKey } = generateKeyPairSync("ed25519")
	const publicKeyPem = publicKey.export({ format: "pem", type: "spki" }).toString()
	const manifest = minimalManifest(publicKeyPem)
	const manifestBytes = `${JSON.stringify(manifest, null, 2)}\n`
	const cohortSha = stateCohortSha256(manifest)
	const candidateBytes = `${JSON.stringify({ root: { type: "settings" } })}\n`
	const sourceExecutableBytes = "electron-source-executable"
	const nativeExecutableBytes = "native-executable"
	await Promise.all([
		writeFile(join(root, "candidate.json"), candidateBytes),
		writeFile(join(root, "Palot-Electron"), sourceExecutableBytes),
		writeFile(join(root, "Palot"), nativeExecutableBytes),
	])
	const candidateArtifacts = [
		{ role: "canonical-candidate", path: "candidate.json", sha256: sha256(candidateBytes) },
		{ role: "source-executable", path: "Palot-Electron", sha256: sha256(sourceExecutableBytes) },
		{ role: "native-executable", path: "Palot", sha256: sha256(nativeExecutableBytes) },
	]
	const candidateSetSha256 = candidateArtifactSetSha256(candidateArtifacts)
	const captureRunId = "capture-run-00000001"
	const rect = { x: 0, y: 0, width: 32, height: 24 }
	const state = structuredClone(manifest.initialState.react)
	const theme = { rootClasses: ["dark"], nativeThemeSource: "dark", paletteRegions: { "settings.sidebar": "dark" } }
	const windowState = { material: "liquid-glass", isOpaque: false, relaunchRequests: 0 }
	const callback = { callbackCount: 0, actionId: "", payload: "" }

	const writeLayout = async (name: string, stepId: string, sequence: number) => {
		const artifact = {
			schema: "burl-settled-layout-receipt-v1",
			viewport: manifest.environment.viewport,
			captureRunId,
			scenarioId: "keyboard-focus",
			stepId,
			postStateSha256: canonicalSha256(state),
			processGeneration: 1,
			sequence,
			candidateArtifactSetSha256: candidateSetSha256,
			source: { processId: "source-pid-200", nodes: { "settings.sidebar": rect },
				regions: { "settings.sidebar": rect } },
			native: { processId: "pid-100", nodes: { "settings.sidebar": rect },
				regions: { "settings.sidebar": rect } },
		}
		const bytes = `${JSON.stringify(artifact, null, 2)}\n`
		await writeFile(join(root, name), bytes)
		return { path: name, sha256: sha256(bytes) }
	}

	const writeCapturePair = async (name: string, seed: number, stepId: string, sequence: number) => {
		const image = await png(seed)
		const sourcePath = `${name}-source.png`
		const nativePath = `${name}-native.png`
		await Promise.all([writeFile(join(root, sourcePath), image.bytes), writeFile(join(root, nativePath), image.bytes)])
		const common = {
			sourceRevision: manifest.sourceAuthority.revision,
			stateCohortSha256: cohortSha,
			viewport: manifest.environment.viewport,
			capturedAt: `2026-07-16T20:00:0${sequence}.300Z`,
			processGeneration: 1,
			processId: "pid-100",
			captureRunId,
			scenarioId: "keyboard-focus",
			stepId,
			postStateSha256: canonicalSha256(state),
			sequence,
			regions: { "settings.sidebar": { ...rect, sha256: regionHash(image.pixels, 32, 24) } },
		}
		const source = {
			...common, role: "source", path: sourcePath, sha256: sha256(image.bytes),
			executableSha256: candidateArtifacts[1].sha256, processId: "source-pid-200",
		}
		const native = {
			...common, role: "native", path: nativePath, sha256: sha256(image.bytes),
			executableSha256: candidateArtifacts[2].sha256, backend: "skia-dawn-metal",
			candidateArtifactSetSha256: candidateSetSha256,
		}
		const comparisons = {
			"settings.sidebar": {
				metric: manifest.captureGate.comparison.metric,
				sourceRegionHash: source.regions["settings.sidebar"].sha256,
				nativeRegionHash: native.regions["settings.sidebar"].sha256,
				observedMae: 0,
				regionDiffPixels: 0,
				differentPixelPercent: 0,
				contentFloorPassed: true,
			},
		}
		return { source, native, comparisons }
	}

	const initial = await writeCapturePair("initial", 1, "initial", 0)
	const initialLayout = await writeLayout("initial-layout.json", "initial", 0)
	let previous = { source: initial.source.sha256, native: initial.native.sha256, layout: initialLayout.sha256 }
	let previousFocus = ""
	const steps = []
	for (let index = 0; index < 2; ++index) {
		const sequence = index + 1
		const pair = await writeCapturePair(`step-${index}`, 20 + index, `tab-through-theme:${index}`, sequence)
		const layout = await writeLayout(`layout-${index}.json`, `tab-through-theme:${index}`, sequence)
		const focusAfter = index === 0 ? "settings.theme.light" : "settings.theme.dark"
		steps.push({
			schema: "burl-live-react-interaction-receipt-v2",
			manifestStepId: "tab-through-theme",
			id: `tab-through-theme:${index}`,
			operation: "key-down",
			key: "Tab",
			sequenceIndex: index,
			sequence,
			trustedEvents: [{ type: "keydown", trusted: true, key: "Tab" }, { type: "keyup", trusted: true, key: "Tab" }],
			resolvedIdentities: [],
			targetResolvedExactlyOnce: true,
			pointerDownDispatched: false,
			pointerUpDispatched: false,
			callbackBefore: structuredClone(callback),
			callbackAfter: structuredClone(callback),
			callbackDelta: 0,
			stateBefore: structuredClone(state),
			stateAfter: structuredClone(state),
			importedStateAfter: structuredClone(state),
			changedStateKeys: [],
			storageBefore: structuredClone(manifest.initialState.storage),
			storageAfter: structuredClone(manifest.initialState.storage),
			themeBefore: structuredClone(theme),
			themeAfter: structuredClone(theme),
			windowBefore: structuredClone(windowState),
			windowAfter: structuredClone(windowState),
			processGenerationBefore: 1,
			processGenerationAfter: 1,
			processIdBefore: "pid-100",
			processIdAfter: "pid-100",
			focusBefore: previousFocus,
			focusAfter,
			overlaysBefore: [],
			overlaysAfter: [],
			screenshotBeforeHash: previous.native,
			sourceScreenshotBeforeHash: previous.source,
			screenshotAfterHash: pair.native.sha256,
			layoutBeforeHash: previous.layout,
			layoutAfterHash: layout.sha256,
			layoutAfter: layout,
			dispatchTimestamp: `2026-07-16T20:00:0${sequence}.000Z`,
			settledTimestamp: `2026-07-16T20:00:0${sequence}.100Z`,
			layoutReceiptTimestamp: `2026-07-16T20:00:0${sequence}.200Z`,
			sourceCapture: pair.source,
			nativeCapture: pair.native,
			comparisons: pair.comparisons,
			failureClasses: [],
			passed: true,
		})
		previous = { source: pair.source.sha256, native: pair.native.sha256, layout: layout.sha256 }
		previousFocus = focusAfter
	}

	const bundle: Record<string, any> = {
		schema: "burl-native-state-cohort-receipt-bundle-v1",
		manifestSha256: manifestSha256(manifestBytes),
		stateCohortSha256: cohortSha,
		captureRunId,
		sourceProcessId: "source-pid-200",
		candidateArtifacts,
		candidateArtifactSetSha256: candidateSetSha256,
		producerId: "capture-runner",
		scenarios: [{
			id: "keyboard-focus",
			initialState: manifest.initialState.react,
			initialImportedState: manifest.initialState.importedTree,
			initialStorage: manifest.initialState.storage,
			initialCallback: callback,
			initialFocus: "",
			initialOverlays: [],
			initialProcessGeneration: 1,
			initialProcessId: "pid-100",
			initialSourceCapture: initial.source,
			initialNativeCapture: initial.native,
			initialTheme: theme,
			initialWindow: windowState,
			initialScreenshotHash: initial.native.sha256,
			initialLayoutHash: initialLayout.sha256,
			initialLayout,
			initialComparisons: initial.comparisons,
			steps,
		}],
		passed: true,
	}

	const seal = async () => {
		const bundleBytes = `${JSON.stringify(bundle, null, 2)}\n`
		await writeFile(join(root, "bundle.json"), bundleBytes)
		const payload: Record<string, any> = {
			schema: "burl-native-state-cohort-independent-review-v1",
			status: "accepted",
			independent: true,
			reviewerId: "reviewer-key-1",
			manifestSha256: manifestSha256(manifestBytes),
			bundleSha256: bundleEvidenceSha256(bundleBytes),
			verifiedArtifactSetSha256: canonicalSha256(descriptors(bundle)
				.sort((left, right) => left.path.localeCompare(right.path) || left.sha256.localeCompare(right.sha256))),
			reviewedAt: "2026-07-16T21:00:00.000Z",
		}
		payload.signature = sign(null, Buffer.from(JSON.stringify(canonicalize(payload))), privateKey).toString("base64")
		const reviewBytes = `${JSON.stringify(payload, null, 2)}\n`
		await writeFile(join(root, "review.json"), reviewBytes)
		return { bundleBytes, reviewBytes }
	}
	return { root, manifest, manifestBytes, bundle, bundlePath: join(root, "bundle.json"), candidateBytes, seal }
}

const verify = async (fixture: Awaited<ReturnType<typeof validFixture>>) => {
	const sealed = await fixture.seal()
	return verifyAppearanceStateCohortBundle({
		manifestBytes: fixture.manifestBytes,
		bundleBytes: sealed.bundleBytes,
		bundlePath: fixture.bundlePath,
		reviewBytes: sealed.reviewBytes,
		trustedManifestSha256: manifestSha256(fixture.manifestBytes),
	})
}

describe("appearance state-cohort receipt verification", () => {
	test("the product contract is structurally executable and expands every native key", async () => {
		const bytes = await readFile(resolve(import.meta.dir,
			"../../contracts/appearance-state-cohort.receipt-manifest.v1.json"), "utf8")
		const manifest = JSON.parse(bytes)
		expect(validateAppearanceStateCohortManifest(manifest)).toEqual([])
		expect(manifest.scenarios.flatMap((scenario: any) => scenario.steps).length).toBe(30)
		expect(manifest.scenarios.flatMap((scenario: any) => scenario.steps)
			.reduce((count: number, step: any) => count + (step.operation === "key-sequence" ? step.keys.length : 1), 0)).toBe(39)
		const opacity = manifest.scenarios.find((scenario: any) =>
			scenario.id === "opacity-pointer-keyboard-relaunch")
		expect(opacity.steps[0].expected.geometryDeltas["settings.opacity.switch.thumb"])
			.toMatchObject({ axis: "x", direction: "positive" })
		expect(opacity.steps[2].expected.geometryDeltas["settings.opacity.switch.thumb"])
			.toMatchObject({ axis: "x", direction: "negative" })
		const navigation = manifest.scenarios.find((scenario: any) =>
			scenario.id === "settings-sidebar-navigation")
		expect(navigation.steps).toHaveLength(7)
		expect(navigation.steps.every((step: any) => step.expected.visibleContent &&
			step.expected.paintDeltaRegions.includes("settings.content"))).toBe(true)
	})

	test("accepts real PNG, geometry, provenance, trusted events, and signed independent review", async () => {
		const fixture = await validFixture()
		const report = await verify(fixture)
		expect(report).toMatchObject({ passed: true, status: "accepted", expandedStepCount: 2 })
		expect(report.failures).toEqual([])
	})

	test("rejects non-PNG bytes and producer-forged comparison metrics", async () => {
		const fixture = await validFixture()
		const capture = fixture.bundle.scenarios[0].steps[0].nativeCapture
		await writeFile(join(fixture.root, capture.path), "not a PNG")
		capture.sha256 = sha256("not a PNG")
		fixture.bundle.scenarios[0].steps[0].screenshotAfterHash = capture.sha256
		const report = await verify(fixture)
		expect(report.failures.map((failure) => failure.class)).toContain("artifact-hash-mismatch")
	})

	test("rejects a high-diff image despite producer-authored passing metrics", async () => {
		const fixture = await validFixture()
		const step = fixture.bundle.scenarios[0].steps[0]
		const bad = await png(0, true)
		await writeFile(join(fixture.root, step.nativeCapture.path), bad.bytes)
		step.nativeCapture.sha256 = sha256(bad.bytes)
		step.nativeCapture.regions["settings.sidebar"].sha256 = regionHash(bad.pixels, 32, 24)
		step.screenshotAfterHash = step.nativeCapture.sha256
		const report = await verify(fixture)
		expect(report.failures.map((failure) => failure.class)).toContain("screenshot-region-mismatch")
	})

	test("rejects same-RGB evidence with a materially different alpha channel", async () => {
		const fixture = await validFixture()
		const step = fixture.bundle.scenarios[0].steps[0]
		const decoded = await sharp(await readFile(join(fixture.root, step.nativeCapture.path)))
			.ensureAlpha().raw().toBuffer({ resolveWithObject: true })
		for (let index = 3; index < decoded.data.length; index += 4) decoded.data[index] = 0
		const bytes = await sharp(decoded.data, { raw: decoded.info }).png().toBuffer()
		await writeFile(join(fixture.root, step.nativeCapture.path), bytes)
		step.nativeCapture.sha256 = sha256(bytes)
		step.nativeCapture.regions["settings.sidebar"].sha256 = regionHash(decoded.data, 32, 24)
		step.screenshotAfterHash = step.nativeCapture.sha256
		const report = await verify(fixture)
		expect(report.failures.map((failure) => failure.class)).toContain("screenshot-region-mismatch")
	})

	test("rejects a matching crop displaced away from verified semantic geometry", async () => {
		const fixture = await validFixture()
		const step = fixture.bundle.scenarios[0].steps[0]
		for (const role of ["sourceCapture", "nativeCapture"]) {
			const capture = step[role]
			const decoded = await sharp(await readFile(join(fixture.root, capture.path)))
				.ensureAlpha().raw().toBuffer({ resolveWithObject: true })
			const cropped = new Uint8Array(31 * 24 * 4)
			for (let row = 0; row < 24; ++row)
				cropped.set(decoded.data.subarray((row * 32 + 1) * 4, (row * 32 + 32) * 4), row * 31 * 4)
			capture.regions["settings.sidebar"] = {
				x: 1, y: 0, width: 31, height: 24, sha256: regionHash(cropped, 31, 24),
			}
		}
		const comparison = step.comparisons["settings.sidebar"]
		comparison.sourceRegionHash = step.sourceCapture.regions["settings.sidebar"].sha256
		comparison.nativeRegionHash = step.nativeCapture.regions["settings.sidebar"].sha256
		const report = await verify(fixture)
		expect(report.failures.map((failure) => failure.class)).toContain("layout-receipt-mismatch")
	})

	test("rejects duplicate executable artifact paths and substituted manifest bytes", async () => {
		const fixture = await validFixture()
		fixture.bundle.candidateArtifacts[2].path = fixture.bundle.candidateArtifacts[1].path
		fixture.bundle.candidateArtifacts[2].sha256 = fixture.bundle.candidateArtifacts[1].sha256
		let report = await verify(fixture)
		expect(report.failures.map((failure) => failure.class)).toContain("artifact-hash-mismatch")

		const clean = await validFixture()
		const sealed = await clean.seal()
		const substituted = structuredClone(clean.manifest)
		substituted.captureGate.comparison.maxMeanAbsoluteError = 255
		const substitutedBytes = JSON.stringify(substituted)
		report = await verifyAppearanceStateCohortBundle({
			manifestBytes: substitutedBytes,
			bundleBytes: sealed.bundleBytes,
			bundlePath: clean.bundlePath,
			reviewBytes: sealed.reviewBytes,
			trustedManifestSha256: manifestSha256(clean.manifestBytes),
		})
		expect(report.failures.map((failure) => failure.class)).toContain("source-cohort-mismatch")
	})

	test("rejects missing trusted key delivery and broken receipt continuity", async () => {
		const fixture = await validFixture()
		const step = fixture.bundle.scenarios[0].steps[1]
		step.trustedEvents = []
		step.focusBefore = "wrong-focus"
		step.processGenerationBefore = 7
		const report = await verify(fixture)
		const classes = report.failures.map((failure) => failure.class)
		expect(classes).toContain("trusted-event-sequence-mismatch")
		expect(classes).toContain("receipt-continuity-mismatch")
	})

	test("rejects stale capture provenance and an arbitrary layout hash", async () => {
		const fixture = await validFixture()
		const step = fixture.bundle.scenarios[0].steps[0]
		step.nativeCapture.stepId = "different-step"
		step.layoutAfterHash = "a".repeat(64)
		const report = await verify(fixture)
		const classes = report.failures.map((failure) => failure.class)
		expect(classes).toContain("native-cohort-mismatch")
		expect(classes).toContain("layout-receipt-mismatch")
	})

	test("rejects unsigned self-review and review stripping", async () => {
		const fixture = await validFixture()
		const sealed = await fixture.seal()
		const selfReview = JSON.parse(sealed.reviewBytes)
		selfReview.reviewerId = fixture.bundle.producerId
		const report = await verifyAppearanceStateCohortBundle({
			manifestBytes: fixture.manifestBytes,
			bundleBytes: sealed.bundleBytes,
			bundlePath: fixture.bundlePath,
			reviewBytes: JSON.stringify(selfReview),
			trustedManifestSha256: manifestSha256(fixture.manifestBytes),
		})
		expect(report.failures.map((failure) => failure.class)).toContain("independent-review-missing")
		const stripped = await verifyAppearanceStateCohortBundle({
			manifestBytes: fixture.manifestBytes,
			bundleBytes: sealed.bundleBytes,
			bundlePath: fixture.bundlePath,
			trustedManifestSha256: manifestSha256(fixture.manifestBytes),
		})
		expect(stripped.failures.map((failure) => failure.class)).toContain("independent-review-missing")
	})

	test("promotion reruns verification and rejects forged reports or changed artifacts", async () => {
		const fixture = await validFixture()
		const sealed = await fixture.seal()
		const report = await verifyAppearanceStateCohortBundle({
			manifestBytes: fixture.manifestBytes,
			bundleBytes: sealed.bundleBytes,
			bundlePath: fixture.bundlePath,
			reviewBytes: sealed.reviewBytes,
			trustedManifestSha256: manifestSha256(fixture.manifestBytes),
		})
		await expect(requireAcceptedAppearanceStateCohortReport({
			reportBytes: JSON.stringify(report),
			manifestBytes: fixture.manifestBytes,
			bundleBytes: sealed.bundleBytes,
			bundlePath: fixture.bundlePath,
			reviewBytes: sealed.reviewBytes,
			trustedManifestSha256: manifestSha256(fixture.manifestBytes),
			candidateBytes: fixture.candidateBytes,
		})).resolves.toMatchObject({ status: "accepted" })
		const forged = { ...report, expandedStepCount: 99 }
		await expect(requireAcceptedAppearanceStateCohortReport({
			reportBytes: JSON.stringify(forged),
			manifestBytes: fixture.manifestBytes,
			bundleBytes: sealed.bundleBytes,
			bundlePath: fixture.bundlePath,
			reviewBytes: sealed.reviewBytes,
			trustedManifestSha256: manifestSha256(fixture.manifestBytes),
			candidateBytes: fixture.candidateBytes,
		})).rejects.toThrow("exact manifest and evidence bytes")
		await unlink(join(fixture.root, fixture.bundle.scenarios[0].steps[0].nativeCapture.path))
		await expect(requireAcceptedAppearanceStateCohortReport({
			reportBytes: JSON.stringify(report),
			manifestBytes: fixture.manifestBytes,
			bundleBytes: sealed.bundleBytes,
			bundlePath: fixture.bundlePath,
			reviewBytes: sealed.reviewBytes,
			trustedManifestSha256: manifestSha256(fixture.manifestBytes),
			candidateBytes: fixture.candidateBytes,
		})).rejects.toThrow("exact manifest and evidence bytes")
	})

	test("the CLI requires the signed review and writes the accepted report", async () => {
		const fixture = await validFixture()
		const sealed = await fixture.seal()
		const manifestPath = join(fixture.root, "manifest.json")
		const reportPath = join(fixture.root, "verification.json")
		await writeFile(manifestPath, fixture.manifestBytes)
		const child = Bun.spawn({
			cmd: [process.execPath, resolve(import.meta.dir, "../verify-appearance-state-cohort.ts"),
				"--manifest", manifestPath, "--bundle", fixture.bundlePath,
				"--review", join(fixture.root, "review.json"),
				"--trusted-manifest-sha256", manifestSha256(fixture.manifestBytes),
				"--report", reportPath],
			stdout: "pipe", stderr: "pipe",
		})
		expect(await child.exited).toBe(0)
		expect(JSON.parse(await readFile(reportPath, "utf8"))).toMatchObject({ status: "accepted", passed: true })
		expect(sealed.bundleBytes.length).toBeGreaterThan(0)
	})
})
