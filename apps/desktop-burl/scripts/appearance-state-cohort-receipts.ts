import { createHash, createPublicKey, verify as verifySignature } from "node:crypto"
import { readFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import sharp from "sharp"

export interface CohortFailure {
	class: string
	path: string
	message: string
}

export interface CohortVerificationReport {
	schema: "burl-native-state-cohort-verification-report-v1"
	manifestSha256: string
	bundleSha256: string
	verifiedArtifactSetSha256: string
	reviewArtifactSha256: string
	stateCohortSha256: string
	candidateArtifactSetSha256: string
	expandedStepCount: number
	failures: CohortFailure[]
	status: "accepted" | "rejected"
	passed: boolean
}

interface ExpandedManifestStep {
	scenarioId: string
	manifestStepId: string
	id: string
	operation: string
	target?: string
	key?: string
	sequenceIndex?: number
	expected: Record<string, any>
}

const SHA256 = /^[0-9a-f]{64}$/

const isObject = (value: unknown): value is Record<string, any> =>
	typeof value === "object" && value !== null && !Array.isArray(value)

const canonicalize = (value: unknown): unknown => {
	if (Array.isArray(value)) return value.map(canonicalize)
	if (!isObject(value)) return value
	return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]))
}

export const canonicalSha256 = (value: unknown): string =>
	createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex")

export const manifestSha256 = (manifestBytes: string | Uint8Array): string =>
	createHash("sha256").update(manifestBytes).digest("hex")

export const stateCohortSha256 = (manifest: Record<string, any>): string => canonicalSha256({
	sourceRevision: manifest.sourceAuthority?.revision,
	environment: manifest.environment,
	initialState: manifest.initialState,
})

export const bundleEvidenceSha256 = (bundleBytes: string | Uint8Array): string =>
	createHash("sha256").update(bundleBytes).digest("hex")

export const candidateArtifactSetSha256 = (artifacts: Record<string, any>[]): string =>
	canonicalSha256(artifacts.map(({ role, sha256 }) => ({ role, sha256 })))

const artifactDescriptors = (
	value: unknown,
	result: Array<{ path: string, sha256: string }> = [],
): Array<{ path: string, sha256: string }> => {
	if (Array.isArray(value)) {
		for (const item of value) artifactDescriptors(item, result)
	} else if (isObject(value)) {
		if (typeof value.path === "string" && SHA256.test(value.sha256 ?? ""))
			result.push({ path: value.path, sha256: value.sha256 })
		for (const item of Object.values(value)) artifactDescriptors(item, result)
	}
	return result
}

const pushFailure = (
	failures: CohortFailure[],
	failureClass: string,
	path: string,
	message: string,
) => failures.push({ class: failureClass, path, message })

const same = (left: unknown, right: unknown): boolean =>
	JSON.stringify(canonicalize(left)) === JSON.stringify(canonicalize(right))

const containsSubset = (
	actual: Record<string, any> | undefined,
	expected: Record<string, any> | undefined,
): boolean => {
	if (!expected) return true
	if (!actual) return false
	return Object.entries(expected).every(([key, value]) => same(actual[key], value))
}

const changedKeys = (
	before: Record<string, any> = {},
	after: Record<string, any> = {},
): string[] => [...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])]
	.filter((key) => !same(before?.[key], after?.[key]))
	.sort()

const project = (value: Record<string, any> = {}, keys: string[]): Record<string, any> =>
	Object.fromEntries(keys.map((key) => [key, value?.[key]]))

const expandedManifestSteps = (manifest: Record<string, any>): ExpandedManifestStep[] =>
	(manifest.scenarios ?? []).flatMap((scenario: any) =>
		(scenario.steps ?? []).flatMap((step: any) => {
			if (step.operation !== "key-sequence") return [{
				scenarioId: scenario.id,
				manifestStepId: step.id,
				id: step.id,
				operation: step.operation,
				target: step.target,
				key: step.key,
				expected: step.expected ?? {},
			}]
			return (step.keys ?? []).map((key: string, sequenceIndex: number) => ({
				scenarioId: scenario.id,
				manifestStepId: step.id,
				id: `${step.id}:${sequenceIndex}`,
				operation: "key-down",
				key,
				sequenceIndex,
				expected: {
					callbackDelta: step.expected?.callbackDelta ?? 0,
					stateChanges: step.expected?.stateChanges ?? {},
					focus: step.expected?.focusOrder?.[sequenceIndex],
				},
			}))
	}))

export function validateAppearanceStateCohortManifest(manifest: Record<string, any>): CohortFailure[] {
	const failures: CohortFailure[] = []
	if (manifest.schema !== "burl-native-state-cohort-receipt-manifest-v1")
		pushFailure(failures, "receipt-schema-drift", "manifest.schema", "unexpected manifest schema")
	if (manifest.receiptCompatibility?.baseSchema !== "burl-live-react-interaction-receipt-v2")
		pushFailure(failures, "receipt-schema-drift", "manifest.receiptCompatibility.baseSchema",
			"the cohort must extend the native interaction receipt v2 schema")
	if (!manifest.sourceAuthority?.revision)
		pushFailure(failures, "source-cohort-mismatch", "manifest.sourceAuthority.revision",
			"source revision is required")
	if (!Array.isArray(manifest.sourceAuthority?.files) || manifest.sourceAuthority.files.length === 0 ||
		manifest.sourceAuthority.files.some((file: any) => !file.path || !SHA256.test(file.sha256 ?? "")))
		pushFailure(failures, "source-cohort-mismatch", "manifest.sourceAuthority.files",
			"source authority requires path and SHA-256 pins")
	if ((manifest.sourceAuthority?.existingCaptures ?? [])
		.some((capture: any) => !capture.path || !SHA256.test(capture.sha256 ?? "")))
		pushFailure(failures, "source-cohort-mismatch", "manifest.sourceAuthority.existingCaptures",
			"existing capture references require path and SHA-256 pins")
	if (!isObject(manifest.environment?.viewport) ||
		!["width", "height", "deviceScaleFactor"].every((key) =>
			Number.isFinite(manifest.environment.viewport[key])))
		pushFailure(failures, "source-cohort-mismatch", "manifest.environment.viewport",
			"viewport and device scale factor are required")

	const targets = new Set(manifest.semanticTargets ?? [])
	const stepIds = new Set<string>()
	for (const scenario of manifest.scenarios ?? []) {
		if (!scenario.resetToInitialState)
			pushFailure(failures, "persistence-reload-mismatch", `manifest.scenarios.${scenario.id}`,
				"every scenario must begin from the explicit initial state")
		for (const step of scenario.steps ?? []) {
			if (stepIds.has(step.id))
				pushFailure(failures, "receipt-schema-drift", `manifest.scenarios.${scenario.id}.${step.id}`,
					"manifest step IDs must be unique")
			stepIds.add(step.id)
			if (["click", "hover-enter", "hover-leave"].includes(step.operation)) {
				if (!step.target)
					pushFailure(failures, "target-required", `manifest.scenarios.${scenario.id}.${step.id}`,
						"pointer and hover steps require a semantic target")
				else if (!targets.has(step.target))
					pushFailure(failures, "target-unresolved", `manifest.scenarios.${scenario.id}.${step.id}.target`,
						"step target is absent from semanticTargets")
			}
			if (step.operation === "key-sequence" &&
				(!Array.isArray(step.keys) || step.keys.length === 0 ||
					step.keys.length !== step.expected?.focusOrder?.length))
				pushFailure(failures, "receipt-schema-drift", `manifest.scenarios.${scenario.id}.${step.id}`,
					"key sequences require one expected focus target per native key")
		}
	}

	const regionIds = (manifest.screenshotRegions ?? []).map((region: any) => region.id)
	if (regionIds.length === 0 || new Set(regionIds).size !== regionIds.length)
		pushFailure(failures, "receipt-schema-drift", "manifest.screenshotRegions",
			"screenshot region IDs must be present and unique")
	if (manifest.captureGate?.comparison?.skiaBackendOnlyForNative !== true)
		pushFailure(failures, "native-cohort-mismatch", "manifest.captureGate.comparison",
			"native cohort capture must be restricted to the Skia backend")
	const comparator = manifest.captureGate?.comparison
	if (![comparator?.pixelChannelTolerance, comparator?.maxMeanAbsoluteError,
		comparator?.maxDifferentPixelPercent].every((value) => Number.isFinite(value) && value >= 0) ||
		!isObject(comparator?.contentFloor) ||
		!["minUniqueColors", "minLuminanceStddev", "minNonBackgroundCoverage",
			"minOpaqueCoverage"].every((key) => Number.isFinite(comparator.contentFloor[key])))
		pushFailure(failures, "screenshot-region-mismatch", "manifest.captureGate.comparison",
			"trusted manifest must pin comparator limits and content-floor limits")
	if (manifest.captureGate?.independentReview?.signatureAlgorithm !== "ed25519" ||
		!Array.isArray(manifest.captureGate?.independentReview?.allowedReviewerPublicKeys) ||
		manifest.captureGate.independentReview.allowedReviewerPublicKeys.length === 0 ||
		manifest.captureGate.independentReview.allowedReviewerPublicKeys.some((key: any) =>
			!key.reviewerId || !key.publicKeyPem || sha256Bytes(key.publicKeyPem) !== key.publicKeySha256))
		pushFailure(failures, "independent-review-missing", "manifest.captureGate.independentReview",
			"manifest must declare Ed25519 review policy")
	if (!manifest.failureClasses?.["cohort-theme-split"])
		pushFailure(failures, "receipt-schema-drift", "manifest.failureClasses.cohort-theme-split",
			"theme palette disagreement needs a named hard failure")
	return failures
}

const capturePath = (bundlePath: string, path: string): string =>
	resolve(dirname(bundlePath), path)

async function verifyPinnedArtifact(
	artifactPath: unknown,
	sha256: unknown,
	bundlePath: string,
	path: string,
	failures: CohortFailure[],
): Promise<Uint8Array | undefined> {
	if (typeof artifactPath !== "string" || !SHA256.test(typeof sha256 === "string" ? sha256 : "")) {
		pushFailure(failures, "artifact-hash-mismatch", path,
			"artifact path and SHA-256 are required")
		return undefined
	}
	try {
		const bytes = await readFile(capturePath(bundlePath, artifactPath))
		if (createHash("sha256").update(bytes).digest("hex") !== sha256) {
			pushFailure(failures, "artifact-hash-mismatch", `${path}.sha256`,
				"artifact bytes do not match the receipt")
			return undefined
		}
		return bytes
	} catch {
		pushFailure(failures, "artifact-hash-mismatch", `${path}.path`,
			"artifact is unreadable")
		return undefined
	}
}

interface DecodedCapture {
	bytes: Uint8Array
	width: number
	height: number
	pixels: Uint8Array
}

const sha256Bytes = (bytes: string | Uint8Array): string =>
	createHash("sha256").update(bytes).digest("hex")

async function decodePng(bytes: Uint8Array): Promise<DecodedCapture> {
	const decoded = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
	if (decoded.info.channels !== 4 || decoded.info.width < 1 || decoded.info.height < 1)
		throw new Error("capture did not decode to RGBA pixels")
	return {
		bytes,
		width: decoded.info.width,
		height: decoded.info.height,
		pixels: decoded.data,
	}
}

const cropPixels = (capture: DecodedCapture, rect: Record<string, any>): Uint8Array => {
	const { x, y, width, height } = rect
	if (![x, y, width, height].every(Number.isInteger) || x < 0 || y < 0 || width < 1 || height < 1 ||
		x + width > capture.width || y + height > capture.height)
		throw new Error("region is outside decoded capture bounds")
	const result = new Uint8Array(width * height * 4)
	for (let row = 0; row < height; ++row) {
		const start = ((y + row) * capture.width + x) * 4
		result.set(capture.pixels.subarray(start, start + width * 4), row * width * 4)
	}
	return result
}

const regionHash = (pixels: Uint8Array, width: number, height: number): string =>
	sha256Bytes(Buffer.concat([Buffer.from(`${width}x${height}:`), Buffer.from(pixels)]))

function contentStats(pixels: Uint8Array) {
	const colors = new Map<number, number>()
	let luminanceSum = 0
	let luminanceSquaredSum = 0
	let opaque = 0
	for (let index = 0; index < pixels.length; index += 4) {
		const red = pixels[index]
		const green = pixels[index + 1]
		const blue = pixels[index + 2]
		const alpha = pixels[index + 3]
		const color = (((red << 24) >>> 0) | (green << 16) | (blue << 8) | alpha) >>> 0
		colors.set(color, (colors.get(color) ?? 0) + 1)
		const luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue
		luminanceSum += luminance
		luminanceSquaredSum += luminance * luminance
		if (alpha >= 250) opaque++
	}
	const total = pixels.length / 4
	const mean = luminanceSum / total
	const dominant = Math.max(...colors.values())
	return {
		uniqueColors: colors.size,
		luminanceStddev: Math.sqrt(Math.max(0, luminanceSquaredSum / total - mean * mean)),
		nonBackgroundCoverage: (total - dominant) / total,
		opaqueCoverage: opaque / total,
	}
}

async function verifyCapture(
	capture: Record<string, any> | undefined,
	path: string,
	role: "source" | "native",
	manifest: Record<string, any>,
	cohortSha256: string,
	candidateSetSha256: string,
	processGeneration: number,
	bundlePath: string,
	failures: CohortFailure[],
	provenance?: Record<string, any>,
): Promise<DecodedCapture | undefined> {
	if (!capture) {
		pushFailure(failures, `${role}-cohort-mismatch`, path, `${role} capture is missing`)
		return undefined
	}
	if (capture.sourceRevision !== manifest.sourceAuthority.revision ||
		capture.stateCohortSha256 !== cohortSha256 ||
		!same(capture.viewport, manifest.environment.viewport))
		pushFailure(failures, `${role}-cohort-mismatch`, path,
			`${role} capture revision, viewport, or cohort identity differs from the manifest`)
	if (role === "native" && capture.backend !== "skia-dawn-metal")
		pushFailure(failures, "native-cohort-mismatch", `${path}.backend`,
			"native visual evidence must use skia-dawn-metal")
	if (role === "native" && capture.candidateArtifactSetSha256 !== candidateSetSha256)
		pushFailure(failures, "native-cohort-mismatch", `${path}.candidateArtifactSetSha256`,
			"native capture is detached from the launched candidate artifacts")
	if (capture.role !== role || (provenance &&
		(capture.captureRunId !== provenance.captureRunId ||
			capture.scenarioId !== provenance.scenarioId || capture.stepId !== provenance.stepId ||
			capture.postStateSha256 !== provenance.postStateSha256 ||
			capture.executableSha256 !== provenance.executableSha256 ||
			capture.processId !== provenance.processId ||
			capture.sequence !== provenance.sequence)))
		pushFailure(failures, `${role}-cohort-mismatch`, `${path}.provenance`,
			`${role} capture provenance is detached from this run, step, state, or executable`)
	if (capture.processGeneration !== processGeneration)
		pushFailure(failures, `${role}-cohort-mismatch`, `${path}.processGeneration`,
			`${role} capture process generation differs from the state receipt`)
	if (!capture.path || !SHA256.test(capture.sha256 ?? "")) {
		pushFailure(failures, "artifact-hash-mismatch", path,
			`${role} capture path and SHA-256 are required`)
		return undefined
	}
	try {
		const bytes = await readFile(capturePath(bundlePath, capture.path))
		const actual = createHash("sha256").update(bytes).digest("hex")
		if (actual !== capture.sha256) {
			pushFailure(failures, "artifact-hash-mismatch", `${path}.sha256`,
				`${role} capture bytes do not match the receipt`)
			return undefined
		}
		const decoded = await decodePng(bytes)
		const viewport = manifest.environment.viewport
		const expectedWidth = Math.round(viewport.width * viewport.deviceScaleFactor)
		const expectedHeight = Math.round(viewport.height * viewport.deviceScaleFactor)
		if (decoded.width !== expectedWidth || decoded.height !== expectedHeight)
			pushFailure(failures, `${role}-cohort-mismatch`, `${path}.viewport`,
				"decoded capture dimensions differ from the manifest viewport and scale")
		for (const region of manifest.screenshotRegions ?? []) {
			const receipt = capture.regions?.[region.id]
			try {
				const pixels = cropPixels(decoded, receipt)
				if (receipt.sha256 !== regionHash(pixels, receipt.width, receipt.height))
					pushFailure(failures, "screenshot-region-mismatch", `${path}.regions.${region.id}.sha256`,
						"region hash was not derived from decoded PNG pixels")
			} catch {
				pushFailure(failures, "screenshot-region-mismatch", `${path}.regions.${region.id}`,
					"region geometry is missing or outside decoded PNG bounds")
			}
		}
		return decoded
	} catch {
		pushFailure(failures, "artifact-hash-mismatch", `${path}.path`,
			`${role} capture artifact is unreadable or is not a valid PNG`)
		return undefined
	}
}

async function verifyLayoutReceipt(
	receipt: Record<string, any> | undefined,
	manifest: Record<string, any>,
	expected: Record<string, any>,
	bundlePath: string,
	path: string,
	failures: CohortFailure[],
): Promise<Record<string, any> | undefined> {
	const bytes = await verifyPinnedArtifact(receipt?.path, receipt?.sha256, bundlePath, path, failures)
	if (!bytes) return undefined
	try {
		const artifact = JSON.parse(bytes.toString())
		if (artifact.schema !== "burl-settled-layout-receipt-v1" ||
			!same(artifact.viewport, manifest.environment.viewport) ||
			!["captureRunId", "scenarioId", "stepId", "postStateSha256", "processGeneration",
				"sequence", "candidateArtifactSetSha256"].every((key) => same(artifact[key], expected[key])) ||
			artifact.source?.processId !== expected.sourceProcessId ||
			artifact.native?.processId !== expected.nativeProcessId)
			throw new Error("layout provenance mismatch")
		const viewport = manifest.environment.viewport
		for (const role of ["source", "native"]) for (const region of manifest.screenshotRegions ?? []) {
			const layout = artifact[role]
			const rect = layout?.regions?.[region.id]
			if (![rect?.x, rect?.y, rect?.width, rect?.height].every(Number.isFinite) ||
				rect.x < 0 || rect.y < 0 || rect.width <= 0 || rect.height <= 0 ||
				rect.x + rect.width > viewport.width || rect.y + rect.height > viewport.height)
				throw new Error(`invalid geometry for ${region.id}`)
			const anchorIds = region.anchors ?? [region.anchor]
			const anchors = anchorIds.map((id: string) => layout?.nodes?.[id]).filter(Boolean)
			if (anchors.length === 0 || !layout?.nodes?.[anchorIds[0]] ||
				(expected.overlays ?? []).some((id: string) => anchorIds.includes(id) && !layout?.nodes?.[id]))
				throw new Error(`missing anchor for ${region.id}`)
			let left = Math.min(...anchors.map((node: any) => node.x))
			let top = Math.min(...anchors.map((node: any) => node.y))
			let right = Math.max(...anchors.map((node: any) => node.x + node.width))
			let bottom = Math.max(...anchors.map((node: any) => node.y + node.height))
			const padding = Number(region.padding ?? 0)
			const inset = Number(region.inset ?? 0)
			left = Math.max(0, left - padding + inset)
			top = Math.max(0, top - padding + inset)
			right = Math.min(viewport.width, right + padding - inset)
			bottom = Math.min(viewport.height, bottom + padding - inset)
			for (const excludedId of region.exclude ?? []) {
				const excluded = layout?.nodes?.[excludedId]
				if (!excluded) throw new Error(`missing exclusion for ${region.id}`)
				if (excluded.x <= left && excluded.x + excluded.width > left)
					left = Math.min(right, excluded.x + excluded.width)
				else if (excluded.x < right && excluded.x + excluded.width >= right)
					right = Math.max(left, excluded.x)
				else if (excluded.y <= top && excluded.y + excluded.height > top)
					top = Math.min(bottom, excluded.y + excluded.height)
				else if (excluded.y < bottom && excluded.y + excluded.height >= bottom)
					bottom = Math.max(top, excluded.y)
				else if (excluded.x < right && excluded.x + excluded.width > left &&
					excluded.y < bottom && excluded.y + excluded.height > top)
					throw new Error(`interior exclusion cannot form rectangular crop for ${region.id}`)
			}
			const derived = { x: left, y: top, width: right - left, height: bottom - top }
			if (!same(rect, derived)) throw new Error(`region not derived from anchors for ${region.id}`)
		}
		return artifact
	} catch {
		pushFailure(failures, "layout-receipt-mismatch", path,
			"layout artifact is invalid, stale, cropped, or detached from settled state")
		return undefined
	}
}

const dateValue = (value: unknown): number =>
	typeof value === "string" ? Date.parse(value) : Number.NaN

function verifyTheme(
	actual: Record<string, any> | undefined,
	expected: Record<string, any> | undefined,
	resolvedScheme: unknown,
	paletteRegionIds: string[],
	path: string,
	failures: CohortFailure[],
) {
	if (expected) {
		const required = expected.rootClassesContain ?? expected.postRelaunchRootClassesContain ?? []
		const excluded = expected.rootClassesExclude ?? expected.postRelaunchRootClassesExclude ?? []
		if (!required.every((name: string) => actual?.rootClasses?.includes(name)) ||
			excluded.some((name: string) => actual?.rootClasses?.includes(name)) ||
			(expected.nativeThemeSource !== undefined &&
				actual?.nativeThemeSource !== expected.nativeThemeSource))
			pushFailure(failures, "theme-resolution-mismatch", path,
				"root classes or native theme source differ from the expected theme")
		if (expected.allPaletteRegions &&
			!Object.values(actual?.paletteRegions ?? {}).every((value) => value === expected.allPaletteRegions))
			pushFailure(failures, "cohort-theme-split", `${path}.paletteRegions`,
				"theme-selected controls and palette regions disagree")
		if (expected.paletteRegions && !containsSubset(actual?.paletteRegions, expected.paletteRegions))
			pushFailure(failures, "cohort-theme-split", `${path}.paletteRegions`,
				"initial palette regions disagree with the resolved theme")
	}
	if ((resolvedScheme === "dark" || resolvedScheme === "light") &&
		(paletteRegionIds.some((id) => actual?.paletteRegions?.[id] !== resolvedScheme) ||
			Object.keys(actual?.paletteRegions ?? {}).length === 0))
		pushFailure(failures, "cohort-theme-split", `${path}.paletteRegions`,
			"resolved color scheme does not match every declared palette region")
}

function verifyExpectedStep(
	expected: ExpandedManifestStep,
	actual: Record<string, any>,
	previousState: Record<string, any>,
	previousStorage: Record<string, any>,
	previousGeneration: number,
	previousProcessId: unknown,
	previousScreenshotHash: string,
	previousSourceScreenshotHash: string,
	previousCallback: Record<string, any>,
	previousFocus: unknown,
	previousOverlays: unknown,
	previousTheme: unknown,
	previousWindow: unknown,
	previousLayoutHash: string,
	expectedSequence: number,
	paletteRegionIds: string[],
	importedStateKeys: string[],
	path: string,
	failures: CohortFailure[],
) {
	if (actual.schema !== "burl-live-react-interaction-receipt-v2" ||
		actual.manifestStepId !== expected.manifestStepId || actual.id !== expected.id ||
		actual.operation !== expected.operation || actual.key !== expected.key ||
		actual.sequenceIndex !== expected.sequenceIndex)
		pushFailure(failures, "receipt-schema-drift", path,
			"receipt identity, operation, key, or sequence index differs from the expanded manifest")
	if (expected.target) {
		if (!actual.targetResolvedExactlyOnce)
			pushFailure(failures, "target-unresolved", path, "semantic target did not resolve exactly once")
		if (!same(actual.resolvedIdentities, [expected.target]))
			pushFailure(failures, "target-ambiguous", `${path}.resolvedIdentities`,
				"receipt identity differs from the manifest semantic target")
	}
	if (["click", "outside-click"].includes(expected.operation) &&
		(!actual.pointerDownDispatched || !actual.pointerUpDispatched))
		pushFailure(failures, "dispatch-failed", path, "native pointer down/up was not delivered")
	const requiredEvents: Record<string, string[]> = {
		"key-down": ["keydown", "keyup"],
		click: ["pointerdown", "pointerup", "click"],
		"outside-click": ["pointerdown", "pointerup", "click"],
		"hover-enter": ["pointermove", "pointerenter"],
		"hover-leave": ["pointermove", "pointerleave"],
	}
	const eventTrace = actual.trustedEvents ?? []
	if (!same(eventTrace.map((event: any) => event.type), requiredEvents[expected.operation] ?? []) ||
		eventTrace.some((event: any) => event.trusted !== true) ||
		(expected.key && eventTrace.some((event: any) => event.key !== expected.key)))
		pushFailure(failures, "trusted-event-sequence-mismatch", `${path}.trustedEvents`,
			"receipt lacks the exact trusted native key, pointer, or hover event sequence")
	if (actual.sequence !== expectedSequence)
		pushFailure(failures, "receipt-schema-drift", `${path}.sequence`,
			"capture-run sequence is not monotonic")
	if (!same(actual.callbackBefore, previousCallback) || actual.focusBefore !== previousFocus ||
		!same(actual.overlaysBefore, previousOverlays) || !same(actual.themeBefore, previousTheme) ||
		!same(actual.windowBefore, previousWindow) || actual.processGenerationBefore !== previousGeneration ||
		actual.processIdBefore !== previousProcessId ||
		actual.layoutBeforeHash !== previousLayoutHash ||
		actual.sourceScreenshotBeforeHash !== previousSourceScreenshotHash)
		pushFailure(failures, "receipt-continuity-mismatch", path,
			"callback, focus, overlay, theme, window, process, layout, or source frame broke continuity")
	if (actual.callbackAfter?.callbackCount - actual.callbackBefore?.callbackCount !== actual.callbackDelta ||
		actual.callbackDelta !== expected.expected.callbackDelta)
		pushFailure(failures, "callback-delta-mismatch", `${path}.callbackDelta`,
			"application closure count differs from the expected delta")
	if (expected.expected.callbackDelta === 0 && !same(actual.callbackBefore, actual.callbackAfter))
		pushFailure(failures, "callback-delta-mismatch", `${path}.callbackAfter`,
			"component-only behavior fabricated an application closure")
	if (expected.expected.actionId !== undefined &&
		actual.callbackAfter?.actionId !== expected.expected.actionId)
		pushFailure(failures, "callback-action-mismatch", `${path}.callbackAfter.actionId`,
			"application closure action differs from the manifest")
	if (expected.expected.payload !== undefined &&
		actual.callbackAfter?.payload !== expected.expected.payload)
		pushFailure(failures, "callback-payload-mismatch", `${path}.callbackAfter.payload`,
			"application closure payload differs from the manifest")
	if (!same(actual.stateBefore, previousState))
		pushFailure(failures, "react-state-mismatch", `${path}.stateBefore`,
			"receipt state does not continue from the preceding step")
	if (!containsSubset(actual.stateAfter, expected.expected.state))
		pushFailure(failures, "react-state-mismatch", `${path}.stateAfter`,
			"React-owned state differs from the expected post-state")
	if (expected.expected.stateChanges && Object.keys(expected.expected.stateChanges).length === 0 &&
		!same(actual.stateAfter, previousState))
		pushFailure(failures, "unexpected-state-mutation", `${path}.stateAfter`,
			"a no-state-change step mutated canonical application state")
	const stateChanges = changedKeys(previousState, actual.stateAfter)
	const allowedStateChanges = new Set(Object.keys(expected.expected.state ?? {}))
	if (stateChanges.some((key) => !allowedStateChanges.has(key)))
		pushFailure(failures, "unexpected-state-mutation", `${path}.stateAfter`,
			"a canonical state key outside the declared post-state changed")
	if (!same(actual.changedStateKeys, stateChanges))
		pushFailure(failures, "react-state-mismatch", `${path}.changedStateKeys`,
			"changedStateKeys does not describe the canonical state transition")
	if (!same(actual.importedStateAfter, project(actual.stateAfter, importedStateKeys)))
		pushFailure(failures, "imported-state-mismatch", `${path}.importedStateAfter`,
			"imported native state does not mirror React-owned state")
	if (!same(actual.storageBefore, previousStorage))
		pushFailure(failures, "storage-state-mismatch", `${path}.storageBefore`,
			"storage receipt does not continue from the preceding step")
	if (!containsSubset(actual.storageAfter, expected.expected.storage))
		pushFailure(failures, "storage-state-mismatch", `${path}.storageAfter`,
			"persistent storage differs from the expected state")
	const storageChanges = changedKeys(previousStorage, actual.storageAfter)
	const allowedStorageChanges = new Set(Object.keys(expected.expected.storage ?? {}))
	if (storageChanges.some((key) => !allowedStorageChanges.has(key)))
		pushFailure(failures, "unexpected-state-mutation", `${path}.storageAfter`,
			"a storage key outside the declared post-state changed")
	if (expected.expected.focus !== undefined && actual.focusAfter !== expected.expected.focus)
		pushFailure(failures, "focus-mismatch", `${path}.focusAfter`,
			"native focus differs from the expected semantic control")
	if (expected.expected.focusAfterRelaunch !== undefined &&
		actual.focusAfter !== expected.expected.focusAfterRelaunch)
		pushFailure(failures, "focus-mismatch", `${path}.focusAfter`,
			"post-relaunch focus differs from the contract")
	if (expected.expected.overlays && !same(actual.overlaysAfter, expected.expected.overlays))
		pushFailure(failures, "overlay-lifecycle-mismatch", `${path}.overlaysAfter`,
			"overlay set differs from the expected lifecycle")
	if (expected.expected.activeDescendant !== undefined &&
		actual.activeDescendantAfter !== expected.expected.activeDescendant)
		pushFailure(failures, "active-descendant-mismatch", `${path}.activeDescendantAfter`,
			"active select option differs from the expected option")
	if (expected.expected.visibleContent !== undefined &&
		actual.visibleContentAfter !== expected.expected.visibleContent)
		pushFailure(failures, "react-state-mismatch", `${path}.visibleContentAfter`,
			"settings route changed without mounting the expected content root")

	verifyTheme(actual.themeAfter, expected.expected.theme,
		actual.stateAfter?.["appearance.colorScheme.resolved"], paletteRegionIds,
		`${path}.themeAfter`, failures)
	const expectedWindow = expected.expected.window
	if (expectedWindow) {
		if (actual.windowAfter?.relaunchRequests !== expectedWindow.relaunchRequests)
			pushFailure(failures, actual.windowAfter?.relaunchRequests > 1 ?
				"relaunch-multiplicity" : "relaunch-missing", `${path}.windowAfter.relaunchRequests`,
				"opacity transition must request exactly one relaunch")
		if (actual.windowAfter?.material !== expectedWindow.postRelaunchMaterial ||
			actual.windowAfter?.isOpaque !== expectedWindow.postRelaunchIsOpaque)
			pushFailure(failures, "window-material-mismatch", `${path}.windowAfter`,
				"post-relaunch native material differs from the opacity preference")
		if (actual.processGenerationAfter - previousGeneration !== expectedWindow.processGenerationDelta)
			pushFailure(failures, "relaunch-generation-mismatch", `${path}.processGenerationAfter`,
				"opacity transition did not produce exactly the next process generation")
		if (expectedWindow.processGenerationDelta > 0 && actual.processIdAfter === previousProcessId)
			pushFailure(failures, "relaunch-generation-mismatch", `${path}.processIdAfter`,
				"relaunch generation changed without a new process identity")
	} else if (actual.processGenerationAfter !== previousGeneration ||
		actual.processIdAfter !== previousProcessId || actual.windowAfter?.relaunchRequests !== 0) {
		pushFailure(failures, "relaunch-generation-mismatch", `${path}.processGenerationAfter`,
			"non-relaunch interaction changed process generation or requested relaunch")
	}
	const opacity = actual.stateAfter?.["appearance.opacity.preference"]
	if ((opacity === "opaque" &&
		(actual.windowAfter?.material !== "opaque" || actual.windowAfter?.isOpaque !== true)) ||
		(opacity === "transparent" &&
			(!["liquid-glass", "vibrancy"].includes(actual.windowAfter?.material) ||
				actual.windowAfter?.isOpaque !== false)))
		pushFailure(failures, "window-material-mismatch", `${path}.windowAfter`,
			"native material is incoherent with the canonical opacity preference")
	if (actual.passed !== true || (actual.failureClasses ?? []).length !== 0)
		pushFailure(failures, "dispatch-failed", path, "base interaction receipt did not pass cleanly")
	if (actual.screenshotBeforeHash !== previousScreenshotHash)
		pushFailure(failures, "screenshot-stale", `${path}.screenshotBeforeHash`,
			"visual evidence does not continue from the preceding native frame")
}

async function verifyVisualEvidence(
	manifest: Record<string, any>,
	bundle: Record<string, any>,
	actual: Record<string, any>,
	expectedStep: ExpandedManifestStep,
	cohortSha256: string,
	bundlePath: string,
	path: string,
	failures: CohortFailure[],
	seenSourceHashes: Set<string>,
	seenNativeHashes: Set<string>,
	previousLayout: Record<string, any> | undefined,
	previousNativeCapture: Record<string, any> | undefined,
): Promise<Record<string, any> | undefined> {
	const sourceExecutable = bundle.candidateArtifacts.find((item: any) => item.role === "source-executable")
	const nativeExecutable = bundle.candidateArtifacts.find((item: any) => item.role === "native-executable")
	const postStateSha256 = canonicalSha256(actual.stateAfter)
	const provenance = {
		captureRunId: bundle.captureRunId,
		scenarioId: expectedStep.scenarioId,
		stepId: expectedStep.id,
		postStateSha256,
		sequence: actual.sequence,
	}
	if (actual.sourceCapture?.path === actual.nativeCapture?.path ||
		sourceExecutable?.sha256 === nativeExecutable?.sha256)
		pushFailure(failures, "source-cohort-mismatch", path,
			"source and native evidence must come from distinct artifacts and executables")
	if (seenSourceHashes.has(actual.sourceCapture?.sha256) || seenNativeHashes.has(actual.nativeCapture?.sha256))
		pushFailure(failures, "screenshot-stale", path,
			"capture bytes were reused from an earlier step in the same run")
	const [sourceDecoded, nativeDecoded] = await Promise.all([
		verifyCapture(actual.sourceCapture, `${path}.sourceCapture`, "source", manifest,
			cohortSha256, bundle.candidateArtifactSetSha256, actual.processGenerationAfter,
			bundlePath, failures, { ...provenance, executableSha256: sourceExecutable?.sha256,
				processId: bundle.sourceProcessId }),
		verifyCapture(actual.nativeCapture, `${path}.nativeCapture`, "native", manifest,
			cohortSha256, bundle.candidateArtifactSetSha256, actual.processGenerationAfter,
			bundlePath, failures, { ...provenance, executableSha256: nativeExecutable?.sha256,
				processId: actual.processIdAfter }),
	])
	if (!actual.screenshotBeforeHash)
		pushFailure(failures, "screenshot-before-missing", `${path}.screenshotBeforeHash`,
			"pre-state screenshot hash is required")
	if (!actual.screenshotAfterHash)
		pushFailure(failures, "screenshot-after-missing", `${path}.screenshotAfterHash`,
			"post-state screenshot hash is required")
	if (actual.screenshotBeforeHash === actual.screenshotAfterHash)
		pushFailure(failures, "screenshot-stale", path,
			"visual interaction reused the pre-state frame")
	if (actual.screenshotAfterHash !== actual.nativeCapture?.sha256)
		pushFailure(failures, "artifact-hash-mismatch", `${path}.screenshotAfterHash`,
			"post-state screenshot hash is detached from the native capture bytes")
	const dispatch = dateValue(actual.dispatchTimestamp)
	const settled = dateValue(actual.settledTimestamp)
	const layoutTimestamp = dateValue(actual.layoutReceiptTimestamp)
	const sourceCaptured = dateValue(actual.sourceCapture?.capturedAt)
	const nativeCaptured = dateValue(actual.nativeCapture?.capturedAt)
	if (![dispatch, settled, layoutTimestamp, sourceCaptured, nativeCaptured].every(Number.isFinite) ||
		settled < dispatch || layoutTimestamp < settled || sourceCaptured < settled || nativeCaptured < settled)
		pushFailure(failures, "screenshot-stale", path,
			"capture and layout timestamps must follow dispatch settlement")
	const layout = await verifyLayoutReceipt(actual.layoutAfter, manifest, {
		...provenance,
		processGeneration: actual.processGenerationAfter,
		sourceProcessId: bundle.sourceProcessId,
		nativeProcessId: actual.processIdAfter,
		candidateArtifactSetSha256: bundle.candidateArtifactSetSha256,
		overlays: actual.overlaysAfter,
	}, bundlePath, `${path}.layoutAfter`, failures)
	if (layout && actual.layoutAfterHash !== actual.layoutAfter.sha256)
		pushFailure(failures, "layout-receipt-mismatch", `${path}.layoutAfterHash`,
			"layout hash differs from verified layout artifact bytes")
	if (layout) {
		const scale = manifest.environment.viewport.deviceScaleFactor
		for (const region of manifest.screenshotRegions ?? []) {
			const sourceRect = actual.sourceCapture?.regions?.[region.id]
			const nativeRect = actual.nativeCapture?.regions?.[region.id]
			const sourceLogical = layout.source.regions[region.id]
			const nativeLogical = layout.native.regions[region.id]
			const scaled = (logical: any) => ({ x: Math.round(logical.x * scale),
				y: Math.round(logical.y * scale), width: Math.round(logical.width * scale),
				height: Math.round(logical.height * scale) })
			if (!containsSubset(sourceRect, scaled(sourceLogical)) ||
				!containsSubset(nativeRect, scaled(nativeLogical)))
				pushFailure(failures, "layout-receipt-mismatch", `${path}.regions.${region.id}`,
					"capture crop does not match the verified semantic layout geometry")
		}
		for (const [nodeId, delta] of Object.entries(expectedStep.expected.geometryDeltas ?? {}) as any) {
			const before = previousLayout?.native?.nodes?.[nodeId]
			const after = layout.native?.nodes?.[nodeId]
			const axis = delta.axis === "y" ? "y" : "x"
			const observed = Number(after?.[axis]) - Number(before?.[axis])
			if (!Number.isFinite(observed) || Math.abs(observed) < delta.minimumAbsoluteDelta ||
				(delta.direction === "positive" && observed <= 0) ||
				(delta.direction === "negative" && observed >= 0))
				pushFailure(failures, "layout-receipt-mismatch", `${path}.geometryDeltas.${nodeId}`,
					"semantic control geometry did not move in the required direction")
		}
	}
	for (const regionId of expectedStep.expected.paintDeltaRegions ?? [])
		if (previousNativeCapture?.regions?.[regionId]?.sha256 ===
			actual.nativeCapture?.regions?.[regionId]?.sha256)
			pushFailure(failures, "screenshot-region-mismatch", `${path}.paintDeltaRegions.${regionId}`,
				"required semantic paint region did not change")
	verifyRegionComparisons(manifest, actual.sourceCapture, actual.nativeCapture,
		sourceDecoded, nativeDecoded, actual.comparisons, path, failures)
	seenSourceHashes.add(actual.sourceCapture?.sha256)
	seenNativeHashes.add(actual.nativeCapture?.sha256)
	return layout
}

function verifyRegionComparisons(
	manifest: Record<string, any>,
	sourceCapture: Record<string, any> | undefined,
	nativeCapture: Record<string, any> | undefined,
	sourceDecoded: DecodedCapture | undefined,
	nativeDecoded: DecodedCapture | undefined,
	comparisons: Record<string, any> | undefined,
	path: string,
	failures: CohortFailure[],
) {
	const policy = manifest.captureGate.comparison
	for (const region of manifest.screenshotRegions ?? []) {
		const comparison = comparisons?.[region.id]
		try {
			if (!sourceDecoded || !nativeDecoded) throw new Error("capture decode failed")
			const sourceRect = sourceCapture?.regions?.[region.id]
			const nativeRect = nativeCapture?.regions?.[region.id]
			if (sourceRect.width !== nativeRect.width || sourceRect.height !== nativeRect.height)
				throw new Error("region sizes differ")
			const sourcePixels = cropPixels(sourceDecoded, sourceRect)
			const nativePixels = cropPixels(nativeDecoded, nativeRect)
			let absolute = 0
			let different = 0
			for (let index = 0; index < sourcePixels.length; index += 4) {
				let maxDelta = 0
				for (let channel = 0; channel < 4; ++channel) {
					const delta = Math.abs(sourcePixels[index + channel] - nativePixels[index + channel])
					absolute += delta
					maxDelta = Math.max(maxDelta, delta)
				}
				if (maxDelta > policy.pixelChannelTolerance) different++
			}
			const mae = absolute / sourcePixels.length
			const differentPercent = different * 100 / (sourcePixels.length / 4)
			const floor = contentStats(nativePixels)
			const floorPolicy = policy.contentFloor
			const floorPassed = floor.uniqueColors >= floorPolicy.minUniqueColors &&
				floor.luminanceStddev >= floorPolicy.minLuminanceStddev &&
				floor.nonBackgroundCoverage >= floorPolicy.minNonBackgroundCoverage &&
				floor.opaqueCoverage >= floorPolicy.minOpaqueCoverage
			if (!comparison || comparison.metric !== policy.metric ||
				comparison.sourceRegionHash !== sourceRect.sha256 ||
				comparison.nativeRegionHash !== nativeRect.sha256 ||
				comparison.observedMae !== mae || comparison.regionDiffPixels !== different ||
				comparison.differentPixelPercent !== differentPercent ||
				comparison.contentFloorPassed !== floorPassed ||
				mae > policy.maxMeanAbsoluteError ||
				differentPercent > policy.maxDifferentPixelPercent || !floorPassed)
				throw new Error("recomputed comparison failed")
		} catch {
			pushFailure(failures, "screenshot-region-mismatch", `${path}.comparisons.${region.id}`,
				"verifier-computed PNG crop, metric, or content floor failed trusted manifest policy")
		}
	}
}

async function verifyIndependentReview(
	reviewBytes: string | Uint8Array | undefined,
	producerId: unknown,
	manifest: Record<string, any>,
	expectedManifestSha: string,
	expectedBundleSha: string,
	expectedArtifactSetSha: string,
	failures: CohortFailure[],
): Promise<string> {
	if (!reviewBytes) {
		pushFailure(failures, "independent-review-missing", "review",
			"promotion requires a separately supplied signed review artifact")
		return ""
	}
	const reviewSha = sha256Bytes(reviewBytes)
	try {
		const artifact = JSON.parse(reviewBytes.toString())
		const key = manifest.captureGate.independentReview.allowedReviewerPublicKeys
			.find((item: any) => item.reviewerId === artifact.reviewerId)
		const payload = { ...artifact }
		delete payload.signature
		if (artifact.schema !== "burl-native-state-cohort-independent-review-v1" ||
			artifact.status !== "accepted" || artifact.independent !== true ||
			artifact.reviewerId === producerId || !key?.publicKeyPem ||
			artifact.manifestSha256 !== expectedManifestSha ||
			artifact.bundleSha256 !== expectedBundleSha ||
			artifact.verifiedArtifactSetSha256 !== expectedArtifactSetSha ||
			!Number.isFinite(dateValue(artifact.reviewedAt)) ||
			!verifySignature(null, Buffer.from(JSON.stringify(canonicalize(payload))),
				createPublicKey(key.publicKeyPem), Buffer.from(artifact.signature ?? "", "base64")))
			throw new Error("invalid review")
	} catch {
		pushFailure(failures, "independent-review-missing", "review",
			"review is not a valid allowlisted Ed25519 acceptance of exact bundle and artifact bytes")
	}
	return reviewSha
}

export async function verifyAppearanceStateCohortBundle(options: {
	manifestBytes: string | Uint8Array
	bundleBytes: string | Uint8Array
	bundlePath: string
	reviewBytes?: string | Uint8Array
	trustedManifestSha256: string
}): Promise<CohortVerificationReport> {
	const manifest = JSON.parse(options.manifestBytes.toString())
	const bundle = JSON.parse(options.bundleBytes.toString())
	const failures = validateAppearanceStateCohortManifest(manifest)
	const expectedManifestSha = manifestSha256(options.manifestBytes)
	if (!SHA256.test(options.trustedManifestSha256) || expectedManifestSha !== options.trustedManifestSha256)
		pushFailure(failures, "source-cohort-mismatch", "manifest",
			"manifest bytes do not match the externally trusted manifest SHA-256")
	const expectedCohortSha = stateCohortSha256(manifest)
	const expectedBundleSha = bundleEvidenceSha256(options.bundleBytes)
	const candidateArtifacts = Array.isArray(bundle.candidateArtifacts) ? bundle.candidateArtifacts : []
	const expectedCandidateSetSha = candidateArtifactSetSha256(candidateArtifacts)
	const descriptors = artifactDescriptors(bundle)
	const verifiedArtifactSetSha = canonicalSha256(descriptors
		.map(({ path, sha256 }) => ({ path, sha256 }))
		.sort((left, right) => left.path.localeCompare(right.path) || left.sha256.localeCompare(right.sha256)))
	const expanded = expandedManifestSteps(manifest)
	if (bundle.schema !== "burl-native-state-cohort-receipt-bundle-v1")
		pushFailure(failures, "receipt-schema-drift", "bundle.schema", "unexpected receipt bundle schema")
	if (bundle.manifestSha256 !== expectedManifestSha)
		pushFailure(failures, "source-cohort-mismatch", "bundle.manifestSha256",
			"bundle is detached from the exact manifest bytes")
	if (bundle.stateCohortSha256 !== expectedCohortSha)
		pushFailure(failures, "source-cohort-mismatch", "bundle.stateCohortSha256",
			"bundle state cohort differs from source revision, environment, or initial state")
	const candidateRoles = candidateArtifacts.map((artifact: any) => artifact.role)
	if (!candidateRoles.includes("canonical-candidate") ||
		!candidateRoles.includes("source-executable") ||
		!candidateRoles.includes("native-executable") ||
		new Set(candidateRoles).size !== candidateRoles.length ||
		new Set(candidateArtifacts.map((artifact: any) => artifact.path)).size !== candidateArtifacts.length ||
		bundle.candidateArtifactSetSha256 !== expectedCandidateSetSha)
		pushFailure(failures, "artifact-hash-mismatch", "bundle.candidateArtifacts",
			"candidate artifacts must uniquely bind canonical candidate and launched native executable")
	if (typeof bundle.captureRunId !== "string" || bundle.captureRunId.length < 16)
		pushFailure(failures, "source-cohort-mismatch", "bundle.captureRunId",
			"capture run needs a stable nonempty identity")
	if (typeof bundle.sourceProcessId !== "string" || bundle.sourceProcessId.length === 0)
		pushFailure(failures, "source-cohort-mismatch", "bundle.sourceProcessId",
			"Electron source capture process identity is required independently of native process identity")
	await Promise.all(descriptors.map(({ path: artifactPath, sha256 }, index) =>
		verifyPinnedArtifact(artifactPath, sha256, options.bundlePath,
			`bundle.artifacts.${index}`, failures)))

	const actualScenarios = new Map((bundle.scenarios ?? []).map((scenario: any) => [scenario.id, scenario]))
	const paletteRegionIds = Object.keys(manifest.initialState?.theme?.paletteRegions ?? {})
	const importedStateKeys = Object.keys(manifest.initialState?.importedTree ?? {})
	for (const manifestScenario of manifest.scenarios ?? []) {
		const scenarioPath = `bundle.scenarios.${manifestScenario.id}`
		const actualScenario = actualScenarios.get(manifestScenario.id) as Record<string, any> | undefined
		if (!actualScenario) {
			pushFailure(failures, "receipt-schema-drift", scenarioPath, "scenario receipt is missing")
			continue
		}
		if (!same(actualScenario.initialState, manifest.initialState.react) ||
			!same(actualScenario.initialImportedState, manifest.initialState.importedTree) ||
			!same(actualScenario.initialStorage, manifest.initialState.storage))
			pushFailure(failures, "persistence-reload-mismatch", scenarioPath,
				"scenario did not reset to the explicit initial state")
		const initialPostStateSha = canonicalSha256(actualScenario.initialState)
		const initialProvenance = {
			captureRunId: bundle.captureRunId,
			scenarioId: manifestScenario.id,
			stepId: "initial",
			postStateSha256: initialPostStateSha,
			sequence: 0,
		}
		const [initialSourceDecoded, initialNativeDecoded] = await Promise.all([
			verifyCapture(actualScenario.initialSourceCapture, `${scenarioPath}.initialSourceCapture`,
				"source", manifest, expectedCohortSha, bundle.candidateArtifactSetSha256,
				actualScenario.initialProcessGeneration,
				options.bundlePath, failures, { ...initialProvenance, executableSha256:
					candidateArtifacts.find((item: any) => item.role === "source-executable")?.sha256,
					processId: bundle.sourceProcessId }),
			verifyCapture(actualScenario.initialNativeCapture, `${scenarioPath}.initialNativeCapture`,
				"native", manifest, expectedCohortSha, bundle.candidateArtifactSetSha256,
				actualScenario.initialProcessGeneration,
				options.bundlePath, failures, { ...initialProvenance, executableSha256:
					candidateArtifacts.find((item: any) => item.role === "native-executable")?.sha256,
					processId: actualScenario.initialProcessId }),
		])
		verifyTheme(actualScenario.initialTheme, manifest.initialState.theme,
			actualScenario.initialState?.["appearance.colorScheme.resolved"], paletteRegionIds,
			`${scenarioPath}.initialTheme`, failures)
		if (!containsSubset(actualScenario.initialWindow, manifest.initialState.window))
			pushFailure(failures, "window-material-mismatch", `${scenarioPath}.initialWindow`,
				"initial native window does not match the explicit cohort seed")
		if (actualScenario.initialScreenshotHash !== actualScenario.initialNativeCapture?.sha256)
			pushFailure(failures, "artifact-hash-mismatch", `${scenarioPath}.initialScreenshotHash`,
				"initial screenshot hash is detached from the native capture bytes")
		const initialLayoutArtifact = await verifyLayoutReceipt(actualScenario.initialLayout, manifest, {
			...initialProvenance,
			processGeneration: actualScenario.initialProcessGeneration,
			sourceProcessId: bundle.sourceProcessId,
			nativeProcessId: actualScenario.initialProcessId,
			candidateArtifactSetSha256: bundle.candidateArtifactSetSha256,
			overlays: actualScenario.initialOverlays,
		}, options.bundlePath, `${scenarioPath}.initialLayout`, failures)
		if (actualScenario.initialLayoutHash !== actualScenario.initialLayout?.sha256)
			pushFailure(failures, "layout-receipt-mismatch", `${scenarioPath}.initialLayoutHash`,
				"initial layout hash differs from verified layout artifact bytes")
		if (initialLayoutArtifact) {
			const scale = manifest.environment.viewport.deviceScaleFactor
			for (const region of manifest.screenshotRegions ?? []) {
				const scaled = (rect: any) => ({ x: Math.round(rect.x * scale), y: Math.round(rect.y * scale),
					width: Math.round(rect.width * scale), height: Math.round(rect.height * scale) })
				if (!containsSubset(actualScenario.initialSourceCapture?.regions?.[region.id],
					scaled(initialLayoutArtifact.source.regions[region.id])) ||
					!containsSubset(actualScenario.initialNativeCapture?.regions?.[region.id],
						scaled(initialLayoutArtifact.native.regions[region.id])))
					pushFailure(failures, "layout-receipt-mismatch", `${scenarioPath}.initialRegions.${region.id}`,
						"initial capture crop does not match verified semantic layout geometry")
			}
		}
		verifyRegionComparisons(manifest, actualScenario.initialSourceCapture,
			actualScenario.initialNativeCapture, initialSourceDecoded, initialNativeDecoded,
			actualScenario.initialComparisons,
			`${scenarioPath}.initialComparisons`, failures)
		let previousState = actualScenario.initialState
		let previousStorage = actualScenario.initialStorage
		let previousGeneration = actualScenario.initialProcessGeneration
		let previousProcessId = actualScenario.initialProcessId
		let previousScreenshotHash = actualScenario.initialNativeCapture?.sha256
		let previousSourceScreenshotHash = actualScenario.initialSourceCapture?.sha256
		let previousCallback = actualScenario.initialCallback
		let previousFocus = actualScenario.initialFocus
		let previousOverlays = actualScenario.initialOverlays
		let previousTheme = actualScenario.initialTheme
		let previousWindow = actualScenario.initialWindow
		let previousLayoutHash = actualScenario.initialLayout?.sha256
		const seenSourceHashes = new Set<string>([actualScenario.initialSourceCapture?.sha256])
		const seenNativeHashes = new Set<string>([actualScenario.initialNativeCapture?.sha256])
		let previousLayoutArtifact = initialLayoutArtifact
		let previousNativeCapture = actualScenario.initialNativeCapture
		const expectedSteps = expanded.filter((step) => step.scenarioId === manifestScenario.id)
		if ((actualScenario.steps ?? []).length !== expectedSteps.length)
			pushFailure(failures, "receipt-schema-drift", `${scenarioPath}.steps`,
				"key sequences must expand to one receipt per native key")
		for (let index = 0; index < expectedSteps.length; ++index) {
			const expected = expectedSteps[index]
			const actual = actualScenario.steps?.[index]
			const stepPath = `${scenarioPath}.steps.${expected.id}`
			if (!actual) continue
			verifyExpectedStep(expected, actual, previousState, previousStorage, previousGeneration,
				previousProcessId,
				previousScreenshotHash, previousSourceScreenshotHash, previousCallback, previousFocus,
				previousOverlays, previousTheme, previousWindow, previousLayoutHash, index + 1,
				paletteRegionIds, importedStateKeys, stepPath, failures)
			const verifiedLayout = await verifyVisualEvidence(manifest, bundle, actual, expected,
				expectedCohortSha, options.bundlePath, stepPath, failures, seenSourceHashes,
				seenNativeHashes, previousLayoutArtifact, previousNativeCapture)
			previousState = actual.stateAfter
			previousStorage = actual.storageAfter
			previousGeneration = actual.processGenerationAfter
			previousProcessId = actual.processIdAfter
			previousScreenshotHash = actual.nativeCapture?.sha256
			previousSourceScreenshotHash = actual.sourceCapture?.sha256
			previousCallback = actual.callbackAfter
			previousFocus = actual.focusAfter
			previousOverlays = actual.overlaysAfter
			previousTheme = actual.themeAfter
			previousWindow = actual.windowAfter
			previousLayoutHash = actual.layoutAfter?.sha256
			previousLayoutArtifact = verifiedLayout
			previousNativeCapture = actual.nativeCapture
		}
	}
	if ((bundle.scenarios ?? []).length !== (manifest.scenarios ?? []).length)
		pushFailure(failures, "receipt-schema-drift", "bundle.scenarios",
			"receipt bundle has missing or unexpected scenarios")

	const reviewArtifactSha256 = await verifyIndependentReview(options.reviewBytes, bundle.producerId,
		manifest, expectedManifestSha, expectedBundleSha, verifiedArtifactSetSha, failures)
	if (bundle.passed !== true)
		pushFailure(failures, "dispatch-failed", "bundle.passed", "producer did not mark the bundle passed")

	return {
		schema: "burl-native-state-cohort-verification-report-v1",
		manifestSha256: expectedManifestSha,
		bundleSha256: expectedBundleSha,
		verifiedArtifactSetSha256: verifiedArtifactSetSha,
		reviewArtifactSha256,
		stateCohortSha256: expectedCohortSha,
		candidateArtifactSetSha256: expectedCandidateSetSha,
		expandedStepCount: expanded.length,
		failures,
		status: failures.length === 0 ? "accepted" : "rejected",
		passed: failures.length === 0,
	}
}

export async function requireAcceptedAppearanceStateCohortReport(options: {
	reportBytes: string | Uint8Array
	manifestBytes: string | Uint8Array
	bundleBytes: string | Uint8Array
	bundlePath: string
	reviewBytes: string | Uint8Array
	trustedManifestSha256: string
	candidateBytes: string | Uint8Array
}): Promise<CohortVerificationReport> {
	const report = JSON.parse(options.reportBytes.toString()) as CohortVerificationReport
	const bundle = JSON.parse(options.bundleBytes.toString())
	const canonicalCandidate = (bundle.candidateArtifacts ?? [])
		.find((artifact: any) => artifact.role === "canonical-candidate")
	const candidateBytesSha = createHash("sha256").update(options.candidateBytes).digest("hex")
	const recomputed = await verifyAppearanceStateCohortBundle({
		manifestBytes: options.manifestBytes,
		bundleBytes: options.bundleBytes,
		bundlePath: options.bundlePath,
		reviewBytes: options.reviewBytes,
		trustedManifestSha256: options.trustedManifestSha256,
	})
	if (recomputed.status !== "accepted" || recomputed.passed !== true ||
		!same(report, recomputed) ||
		canonicalCandidate?.sha256 !== candidateBytesSha)
		throw new Error(
			"canonical promotion requires an accepted appearance state-cohort report " +
				"for the exact manifest and evidence bytes",
		)
	return report
}
