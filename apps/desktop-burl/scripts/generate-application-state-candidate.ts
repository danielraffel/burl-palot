#!/usr/bin/env bun
import { readFile, writeFile } from "node:fs/promises"
import { pathToFileURL } from "node:url"
import { basename, dirname, resolve } from "node:path"
import { createHash } from "node:crypto"
import { normalizeCollapsedLeadingPaneGeometry } from "./application-state-geometry"

const args = new Map<string, string>()
for (let index = 2; index < process.argv.length; index += 2) args.set(process.argv[index], process.argv[index + 1])
const burl = resolve(args.get("--burl-source") ?? "")
const key = args.get("--key") ?? ""
const output = resolve(args.get("--output") ?? "")
const revision = args.get("--source-revision") ?? ""
const wholeTree = args.get("--whole-tree") === "true"
const normalizeCollapsedLeadingPane = args.get("--normalize-collapsed-leading-pane") === "true"
const localizedAssetsPath = args.get("--localized-assets") ? resolve(args.get("--localized-assets")!) : ""
const bindingPolicyPath = args.get("--binding-policy") ? resolve(args.get("--binding-policy")!) : ""
const hasActionScope = args.has("--actions")
const scopedActionSpecs = (args.get("--actions") ?? "").split(",").filter(Boolean)
const transitionSpecs = (args.get("--transitions") ?? "").split(";").filter(Boolean).map((entry) => {
	const split = entry.indexOf(":"); const arrow = entry.indexOf(">", split + 1)
	if (split < 1 || arrow < split + 2) throw new Error("transitions must be action:before>after")
	return { action: entry.slice(0, split), before: entry.slice(split + 1, arrow), after: entry.slice(arrow + 1) }
})
const settledOverlaySpecs = new Map((args.get("--settled-overlays") ?? "").split(",").filter(Boolean).map((entry) => {
	const split = entry.indexOf("="); if (split < 1) throw new Error("settled-overlays must be state=source.json")
	return [entry.slice(0, split), resolve(entry.slice(split + 1))]
}))
const specs = (args.get("--states") ?? "").split(",").filter(Boolean).map((entry) => {
	const split = entry.indexOf("="); if (split < 1) throw new Error("states must be state=source.json")
	return { state: entry.slice(0, split), path: resolve(entry.slice(split + 1)) }
})
if (!burl || !key || !output || !revision || specs.length < 2) throw new Error("missing state candidate arguments")
const importer = await import(pathToFileURL(resolve(burl, "packages/pulp-import-ir/src/index.ts")).href)
let cohort = ""
let cohortKey = ""
const pageUrls: Record<string, string> = {}
let sourceOrigin = ""
const overlayHosts = new Set<string>()
const observedApplicationActions = new Set<string>()
const excludedInfrastructure: Array<{ state: string; sourceId: string; kind: string }> = []
const localizedAssets = localizedAssetsPath
	? JSON.parse(await readFile(localizedAssetsPath, "utf8")) as Record<string, string> : {}
for (const [source, data] of Object.entries(localizedAssets)) {
	if (!/^https:\/\//.test(source) || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(data))
		throw new Error(`invalid localized asset mapping for ${source}`)
}
const localizedAssetUsage = new Map<string, number>()
const normalizations: Array<Record<string, unknown>> = []
const sourceSlug = (input: string) => input.toLowerCase().replace(/\s+/g, " ").trim()
	.replace(/[^a-z0-9._-]+/g, "-").replace(/^-|-$/g, "").slice(0, 48)
const sourceHash = (input: string) => {
	let value = 0x811c9dc5
	for (let index = 0; index < input.length; index++) {
		value ^= input.charCodeAt(index); value = Math.imul(value, 0x01000193)
	}
	return (value >>> 0).toString(16).padStart(8, "0")
}
const canonicalizeAtomicSourceIdentities = (observedRoot: any) => {
	const signature = (node: any) => {
		const tag = String(node.tagName ?? "").toLowerCase()
		const attributes = node.attributes ?? {}
		const volatileIdentifier = (identifier: string) => /(?:base-ui|radix)-_?r_/i.test(identifier)
		for (const name of ["id", "data-testid", "data-slot", "data-pulp-semantic-id", "data-pulp-list-key", "name"])
			if (attributes[name] && !(name === "id" && volatileIdentifier(attributes[name])))
				return `${tag}-${sourceSlug(name)}-${sourceSlug(attributes[name])}`
		const role = attributes.role ?? ""
		const accessible = attributes["aria-label"] ?? attributes.title ?? ""
		if (role || accessible) return `${tag}-${sourceSlug(role || "semantic")}-${sourceSlug(accessible || "unnamed")}`
		const stableClass = String(attributes.class ?? "").split(/\s+/)
			.filter((item) => item && !/^(css-|sc-|_[a-z0-9]{6,})/i.test(item)).sort().join(".")
		return `${tag}-shape-${sourceHash(`${tag}|${stableClass}`)}`
	}
	const rootSignature = signature(observedRoot)
	const syntheticHtml = observedRoot.tagName?.toLowerCase() === "body"
		? `dom/html-shape-${sourceHash("html|")}:0/` : "dom/"
	const rebase = (node: any, sourceId: string): any => {
		const priorIds = new Map<string, string>()
		const counts = new Map<string, number>()
		const children = (node.children ?? []).map((child: any) => {
			const childSignature = signature(child)
			const ordinal = counts.get(childSignature) ?? 0
			counts.set(childSignature, ordinal + 1)
			const childSourceId = `${sourceId}/${childSignature}:${ordinal}`
			priorIds.set(child.sourceId, childSourceId)
			return rebase(child, childSourceId)
		})
		return { ...node, sourceId, children,
			...(Array.isArray(node.content) ? { content: node.content.map((item: any) =>
				item.kind === "child" && priorIds.has(item.sourceId)
					? { ...item, sourceId: priorIds.get(item.sourceId) } : item) } : {}) }
	}
	return rebase(observedRoot, `${syntheticHtml}${rootSignature}:0`)
}
const readCaptureEvidence = async (path: string) => {
	const evidence = JSON.parse(await readFile(path, "utf8"))
	if (evidence.policy && evidence.observedDom) return evidence
	if (!evidence.semantics?.observedDom)
		throw new Error(`${path} is neither full capture evidence nor an atomic interaction capture`)
	const captureDirectory = dirname(path)
	const collectionDirectory = dirname(captureDirectory)
	const metaPath = resolve(captureDirectory, "meta.json")
	const manifestPath = resolve(dirname(collectionDirectory), `${basename(collectionDirectory)}.manifest.json`)
	const meta = JSON.parse(await readFile(metaPath, "utf8"))
	const manifest = JSON.parse(await readFile(manifestPath, "utf8"))
	if (meta.sourceRevision !== manifest.sourceRevision)
		throw new Error(`${path} atomic capture revision disagrees with its manifest`)
	if (JSON.stringify(meta.viewport) !== JSON.stringify(manifest.viewport))
		throw new Error(`${path} atomic capture viewport disagrees with its manifest`)
	return {
		schema: "pulp-atomic-interaction-capture-normalized-v1",
		page: { url: meta.pageUrl ?? evidence.capture?.url },
		policy: {
			sourceRevision: meta.sourceRevision,
			clock: manifest.clock,
			viewport: meta.viewport,
			reload: manifest.reloadBeforeCapture,
			clearStorage: false,
			animations: "atomic-live-state",
			transitions: "atomic-live-state",
			network: "unchanged-live-session",
			hostServices: "live-existing",
		},
		observedDom: canonicalizeAtomicSourceIdentities(evidence.semantics.observedDom),
	}
}
const captures = await Promise.all(specs.map(async ({ state, path }) => {
	const evidence = await readCaptureEvidence(path)
	const signature = JSON.stringify({ revision: evidence.policy?.sourceRevision,
		clock: evidence.policy?.clock, viewport: evidence.policy?.viewport,
		cohortSha256: evidence.policy?.cohortSha256 ?? null })
	const captureCohort = importer.captureCohortKey(evidence,
		{ includeViewport: true, includePageUrl: false })
	if (evidence.policy?.sourceRevision !== revision) throw new Error(`${state} source revision mismatch`)
	if (cohort && cohort !== signature) throw new Error(`${state} crosses build/clock/viewport cohort`)
	if (cohortKey && cohortKey !== captureCohort) throw new Error(`${state} crosses capture cohort`)
	cohortKey = captureCohort; cohort = signature
	const pageUrl = String(evidence.page?.url ?? "")
	const origin = new URL(pageUrl).origin
	if (sourceOrigin && sourceOrigin !== origin) throw new Error(`${state} crosses source origin`)
	sourceOrigin = origin
	pageUrls[state] = pageUrl
	let root = evidence.observedDom.tagName?.toLowerCase() === "html"
		? evidence.observedDom.children.find((child: any) => child.tagName?.toLowerCase() === "body") : evidence.observedDom
	const settledPath = settledOverlaySpecs.get(state)
	if (settledPath) {
		const settledEvidence = await readCaptureEvidence(settledPath)
		if (settledEvidence.policy?.sourceRevision !== revision)
			throw new Error(`${state} settled overlay source revision mismatch`)
		const settledRoot = settledEvidence.observedDom.tagName?.toLowerCase() === "html"
			? settledEvidence.observedDom.children.find((child: any) => child.tagName?.toLowerCase() === "body")
			: settledEvidence.observedDom
		const surfaceKey = (node: any) => {
			const slot = String(node.attributes?.["data-slot"] ?? "")
			const role = String(node.attributes?.role ?? "")
			if (!/(?:tooltip|popover|menu|select)-content$/.test(slot) &&
				!(/^(?:tooltip|menu|dialog|listbox)$/.test(role))) return ""
			const text: string[] = []
			const collectText = (candidate: any) => {
				for (const item of candidate.content ?? [])
					if (item.kind === "text" && item.text?.trim()) text.push(item.text.trim())
				if (candidate.text?.trim()) text.push(candidate.text.trim())
				for (const child of candidate.children ?? []) collectText(child)
			}
			collectText(node)
			return `${slot}\0${role}\0${text.join(" ").replace(/\s+/g, " ")}`
		}
		const surfaces = (candidateRoot: any) => {
			const result = new Map<string, any>()
			const visit = (node: any) => {
				const key = surfaceKey(node)
				if (key) {
					if (result.has(key)) throw new Error(`${state} has ambiguous settled overlay surface ${key}`)
					result.set(key, node)
				}
				for (const child of node.children ?? []) visit(child)
			}
			visit(candidateRoot); return result
		}
		const referenceSurfaces = surfaces(root)
		const settledSurfaces = surfaces(settledRoot)
		for (const [surface, settled] of settledSurfaces) {
			const reference = referenceSurfaces.get(surface)
			if (!reference) throw new Error(`${state} settled overlay surface is absent from identity reference: ${surface}`)
			const sourceIdMap = new Map<string, string>()
			const rebase = (fresh: any, prior: any): any => {
				const freshSlot = fresh.attributes?.["data-slot"] ?? ""
				const priorSlot = prior.attributes?.["data-slot"] ?? ""
				if (fresh.tagName !== prior.tagName || freshSlot !== priorSlot ||
					(fresh.children?.length ?? 0) !== (prior.children?.length ?? 0))
					throw new Error(`${state} settled overlay topology diverged at ${fresh.sourceId}`)
				sourceIdMap.set(fresh.sourceId, prior.sourceId)
				return { ...structuredClone(fresh), sourceId: prior.sourceId,
					children: (fresh.children ?? []).map((child: any, index: number) => rebase(child, prior.children[index])) }
			}
			const rebased = rebase(settled, reference)
			const rewriteContent = (node: any) => {
				for (const item of node.content ?? []) if (item.kind === "child" && sourceIdMap.has(item.sourceId))
					item.sourceId = sourceIdMap.get(item.sourceId)
				for (const child of node.children ?? []) rewriteContent(child)
			}
			rewriteContent(rebased)
			const replace = (node: any): boolean => {
				const index = (node.children ?? []).findIndex((child: any) => child.sourceId === reference.sourceId)
				if (index >= 0) { node.children[index] = rebased; return true }
				return (node.children ?? []).some(replace)
			}
			if (root.sourceId === reference.sourceId) root = rebased
			else if (!replace(root)) throw new Error(`${state} failed to replace settled overlay surface ${surface}`)
		}
	}
	const isFocusSentinel = (node: any) => node.computedStyle?.position === "fixed" &&
		node.rect?.width <= 1 && node.rect?.height <= 1 &&
		(/clip-path\s*:\s*inset\(50%\)/i.test(node.attributes?.style ?? "") ||
			(node.rect?.x <= -1 && node.rect?.y <= -1 &&
				node.computedStyle?.marginTop === "-1px" &&
				node.computedStyle?.overflowX === "hidden" && node.computedStyle?.overflowY === "hidden")) &&
		(node.children?.length ?? 0) === 0 && !(node.content ?? []).some((item: any) => item.kind === "text" && item.text?.trim())
	const clean = (node: any) => {
		const localized = localizedAssets[node.attributes?.src]
		if (localized) {
			localizedAssetUsage.set(node.attributes.src, (localizedAssetUsage.get(node.attributes.src) ?? 0) + 1)
			node.attributes.src = localized
		}
		if (node.tagName?.toLowerCase() === "svg") { node.content = []; node.children = []; delete node.text; return }
		node.children = (node.children ?? []).filter((child: any) => {
			if (["script", "style", "template", "link", "meta"].includes(child.tagName?.toLowerCase())) return false
			if (isFocusSentinel(child)) {
				excludedInfrastructure.push({ state, sourceId: child.sourceId, kind: "focus-sentinel" })
				return false
			}
			return true
		})
		const children = new Set(node.children.map((child: any) => child.sourceId))
		if (Array.isArray(node.content)) node.content = node.content.filter((item: any) => item.kind === "child" ? children.has(item.sourceId) : item.kind !== "text" || item.text?.trim())
		for (const child of node.children) clean(child)
	}; clean(root)
	const containsOverlaySurface = (node: any): boolean => {
		const slot = String(node.attributes?.["data-slot"] ?? "")
		const role = String(node.attributes?.role ?? "")
		if (/^(?:tooltip|menu|dialog|listbox)$/.test(role) ||
			/(?:tooltip|popover|menu|select)-content$/.test(slot)) return true
		return (node.children ?? []).some(containsOverlaySurface)
	}
	const visit = (node: any, parent?: any) => {
		if (node.attributes?.["data-base-ui-portal"] !== undefined) overlayHosts.add(node.sourceId)
		// Newer Base UI releases do not always retain a portal marker on the
		// detached host. A direct body child containing an authored overlay
		// surface is equivalent structural evidence and keeps capture support
		// independent of one framework's private attribute.
		if (parent?.tagName?.toLowerCase() === "body" && containsOverlaySurface(node))
			overlayHosts.add(node.sourceId)
		if (node.attributes?.["data-pulp-action"]) observedApplicationActions.add(node.attributes["data-pulp-action"])
		for (const child of node.children ?? []) visit(child, node)
	}
	visit(root)
	return { state, root }
}))
const applicationActions = new Set(hasActionScope ? scopedActionSpecs : observedApplicationActions)
for (const action of applicationActions) {
	if (!observedApplicationActions.has(action)) throw new Error(`scoped action is not present in captured source: ${action}`)
}
const stripUnscopedActions = (node: any) => {
	const action = node.attributes?.["data-pulp-action"]
	if (action && !applicationActions.has(action)) {
		for (const attribute of ["data-pulp-action", "data-pulp-event", "data-pulp-action-required", "data-pulp-payload-contract"])
			delete node.attributes[attribute]
	}
	for (const child of node.children ?? []) stripUnscopedActions(child)
}
for (const capture of captures) stripUnscopedActions(capture.root)
const cohortViewport = cohort ? JSON.parse(cohort).viewport : null
const rootsFillViewport = cohortViewport && captures.every(({ root }) =>
	root.rect?.x === 0 && root.rect?.y === 0 &&
	root.rect?.width === cohortViewport.width && root.rect?.height === cohortViewport.height)
if (rootsFillViewport) {
	const baseline = captures[0]!.root.computedStyle ?? {}
	for (const property of ["overflowX", "overflowY"] as const) {
		const values = new Set(captures.map(({ root }) => root.computedStyle?.[property] ?? ""))
		if (values.size <= 1) continue
		for (const { root } of captures) root.computedStyle[property] = baseline[property]
		normalizations.push({ kind: "viewport-root-overlay-scroll-lock", property,
			from: [...values].sort(), to: baseline[property] ?? "" })
	}
}
const lowered = captures.map(({ state, root }) => ({ state,
	root: importer.lowerObservedDom(root, cohort ? JSON.parse(cohort).clock : "", {
		applicationActions: [...applicationActions].sort(),
	}) }))
const stateNames = new Set(lowered.map(({ state }) => state))
for (const transition of transitionSpecs) {
	if (!applicationActions.has(transition.action)) throw new Error(`transition action is not captured: ${transition.action}`)
	if (!stateNames.has(transition.before) || !stateNames.has(transition.after))
		throw new Error(`transition references uncaptured state: ${transition.before}>${transition.after}`)
}
const cloneWholeTreeBranch = (node: any, state: string, branchRoot = true): any => ({
	...node,
	stable_anchor_id: `application-state:${state}::${node.stable_anchor_id}`,
	children: node.children.map((child: any) => cloneWholeTreeBranch(child, state, false)),
	...(branchRoot ? { responsive: {
		...(node.responsive ?? {}), visibility: [{ visible: true, structural: true }],
		layoutVariants: [], sampledViewports: [], applicationStateKey: key,
		visibilityByApplicationState: Object.fromEntries(lowered.map((capture) => [capture.state, capture.state === state])),
	} } : {}),
})
const merged = wholeTree ? {
	...lowered[0].root,
	children: lowered.flatMap((capture) => capture.root.children.map((child: any) =>
		cloneWholeTreeBranch(child, capture.state))),
} : importer.unionApplicationStateTrees(key, lowered, { overlayHostIds: [...overlayHosts] })
const prunedSemanticallyClosedTransientPortals =
	importer.pruneSemanticallyClosedTransientStatePortals(merged)
if (prunedSemanticallyClosedTransientPortals) normalizations.push({
	kind: "semantically-closed-transient-portal-prune",
	count: prunedSemanticallyClosedTransientPortals,
})
const bindingPolicy = bindingPolicyPath
	? JSON.parse(await readFile(bindingPolicyPath, "utf8")) : null
const scopedBindingPolicy = bindingPolicy ? {
	...bindingPolicy,
	rules: bindingPolicy.rules.filter((rule: any) => !rule.attributes?.pulpHostAction ||
		applicationActions.has(rule.attributes.pulpHostAction)),
} : null
const bindingPolicyReceipts = scopedBindingPolicy
	? importer.applySourceBindingPolicy(merged, scopedBindingPolicy, { requireAllRules: false })
	: []
if (normalizeCollapsedLeadingPane) {
	const collapsed = lowered.find(({ state }) => /collapsed|closed/i.test(state))
	if (!collapsed) throw new Error("collapsed leading-pane normalization requires a collapsed state")
	const findBySlot = (node: any, slot: string): any => node.raw_source?.node?.attributes?.["data-slot"] === slot
		? node : (node.children ?? []).map((child: any) => findBySlot(child, slot)).find(Boolean)
	const leadingPane = findBySlot(collapsed.root, "sidebar")
	const survivingPane = findBySlot(collapsed.root, "sidebar-inset")
	const viewportWidth = JSON.parse(cohort).viewport.width
	if (!leadingPane || !survivingPane || !viewportWidth)
		throw new Error("collapsed leading-pane normalization requires sidebar, sidebar-inset, and viewport geometry")
	const geometry = normalizeCollapsedLeadingPaneGeometry(
		viewportWidth,
		leadingPane.raw_source.node.rect,
		survivingPane.raw_source.node.rect,
	)
	Object.assign(leadingPane.layout, { display: "none", width: 0, minWidth: 0, maxWidth: 0,
		flexGrow: 0, flexShrink: 0, flexBasis: 0 })
	Object.assign(leadingPane.raw_source.node.rect, { width: 0 })
	Object.assign(survivingPane.layout, { width: geometry.width,
		marginLeft: geometry.leadingInset, marginRight: geometry.trailingInset,
		flexGrow: 1, flexShrink: 1, flexBasis: "0%" })
	Object.assign(survivingPane.raw_source.node.rect, {
		x: geometry.leadingInset,
		width: geometry.width,
	})
	const collapsedBranch = (() => {
		const visit = (node: any): any => node.responsive?.visibilityByApplicationState?.[collapsed.state] === true &&
			node.stable_anchor_id?.startsWith(`application-state:${collapsed.state}::`) ? node :
			(node.children ?? []).map(visit).find(Boolean)
		return visit(merged)
	})()
	const mergedLeadingPane = collapsedBranch && findBySlot(collapsedBranch, "sidebar")
	const mergedSurvivingPane = collapsedBranch && findBySlot(collapsedBranch, "sidebar-inset")
	if (!mergedLeadingPane || !mergedSurvivingPane) throw new Error("collapsed branch was not preserved by application-state union")
	Object.assign(mergedLeadingPane.layout, leadingPane.layout)
	Object.assign(mergedLeadingPane.raw_source.node.rect, leadingPane.raw_source.node.rect)
	Object.assign(mergedSurvivingPane.layout, survivingPane.layout)
	Object.assign(mergedSurvivingPane.raw_source.node.rect, survivingPane.raw_source.node.rect)
	normalizations.push({ kind: "collapsed-leading-pane-reflow", state: collapsed.state,
		leadingSlot: "sidebar", survivingSlot: "sidebar-inset", ...geometry })
}
const assetLocalizations = Object.entries(localizedAssets).map(([source, data]) => {
	const count = localizedAssetUsage.get(source) ?? 0
	if (!count) throw new Error(`localized asset mapping was not observed: ${source}`)
	const bytes = Buffer.from(data.slice(data.indexOf(",") + 1), "base64")
	return { source, mime: data.slice(5, data.indexOf(";")), sha256: createHash("sha256").update(bytes).digest("hex"), count }
})
await writeFile(output, JSON.stringify({ schema: "pulp-application-state-candidate-v1", key,
	revision, mode: wholeTree ? "whole-tree" : "structural-union", cohort: JSON.parse(cohort), overlayHosts: [...overlayHosts].sort(),
	pageUrls,
	applicationActions: [...applicationActions].sort(),
	stateTransitions: transitionSpecs.map((transition) => ({ key, ...transition })),
	normalizations,
	assetLocalizations,
	bindingPolicy: bindingPolicyPath ? { path: bindingPolicyPath, receipts: bindingPolicyReceipts } : null,
	excludedInfrastructure: excludedInfrastructure.sort((a, b) => a.sourceId.localeCompare(b.sourceId)), root: merged }, null, 2) + "\n")
