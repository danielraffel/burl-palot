#!/usr/bin/env bun
import { readFile, writeFile } from "node:fs/promises"
import { basename, relative, resolve } from "node:path"

const args = new Map<string, string>()
for (let index = 2; index < process.argv.length; index += 2) args.set(process.argv[index], process.argv[index + 1])
const sourceRoots = (args.get("--source-roots") ?? args.get("--source-root") ?? "")
	.split(",").filter(Boolean).map((root) => resolve(root))
const output = resolve(args.get("--output") ?? "")
if (sourceRoots.length === 0 || !output) throw new Error("required: --source-roots root[,root] --output")

const textOf = (node: any): string => [node.text ?? "",
	...(node.content ?? []).filter((item: any) => item.kind === "text").map((item: any) => item.text ?? ""),
	...(node.children ?? []).map(textOf)].join(" ").replace(/\s+/g, " ").trim()
const candidates = new Map<string, any>()
const files = sourceRoots.flatMap((root) => [...new Bun.Glob("**/source.json").scanSync({ cwd: root, absolute: true })]
	.map((file) => ({ root, file }))).sort((a, b) => a.file.localeCompare(b.file))
for (const { root, file } of files) {
	const source = JSON.parse(await readFile(file, "utf8"))
	const state = `${basename(root)}/${relative(root, resolve(file, "..")).replaceAll("\\", "/")}`
	const route = new URL(source.page.url).hash.split("?")[0]
	const visit = (node: any, region = "root") => {
		const slot = node.attributes?.["data-slot"]
		const nextRegion = slot === "sidebar" || slot === "sidebar-content" || slot === "sidebar-footer" ? "sidebar"
			: slot === "app-bar" ? "topbar" : node.tagName?.toLowerCase() === "form" ? "composer" : region
		const tag = node.tagName?.toLowerCase()
		const role = node.attributes?.role ?? ({ button: "button", textarea: "textbox", input: "textbox", select: "combobox", a: "link" } as any)[tag]
		const tabIndex = node.attributes?.tabindex === undefined ? (["button", "textarea", "input", "select", "a"].includes(tag) ? 0 : -1) : Number(node.attributes.tabindex)
		const isTarget = ["button", "textarea", "input", "select", "a"].includes(tag) ||
			["button", "combobox", "menuitem", "option", "textbox", "link", "switch", "checkbox"].includes(role) || tabIndex >= 0
		if (isTarget) {
			const key = `${route}::${node.sourceId}`
			const entry = candidates.get(key) ?? { route, sourceId: node.sourceId, tag, role, region: nextRegion,
				accessibleName: node.attributes?.["aria-label"] ?? node.attributes?.title ?? textOf(node) ?? node.attributes?.placeholder ?? "",
				dataSlot: slot ?? null, states: new Set<string>(), actions: new Set<string>(), expanded: new Set<string>(),
				dataStates: new Set<string>(), hitRects: [] as any[] }
			entry.states.add(state)
			if (node.attributes?.["data-pulp-action"]) entry.actions.add(node.attributes["data-pulp-action"])
			if (node.attributes?.["aria-expanded"] !== undefined) entry.expanded.add(node.attributes["aria-expanded"])
			if (node.attributes?.["data-state"] !== undefined) entry.dataStates.add(node.attributes["data-state"])
			if (node.rect) entry.hitRects.push({ state, ...node.rect })
			candidates.set(key, entry)
		}
		for (const child of node.children ?? []) visit(child, nextRegion)
	}
	visit(source.observedDom)
}
const items = [...candidates.values()].map((entry) => {
	const actions = [...entry.actions].sort(), expanded = [...entry.expanded].sort(), dataStates = [...entry.dataStates].sort()
	const editable = entry.tag === "textarea" || (entry.tag === "input" && !["hidden", "checkbox", "radio"].includes(entry.role))
	const hasObservedStateChange = expanded.length > 1 || dataStates.length > 1
	const classification = actions.length ? "captured-action"
		: editable ? "native-editable"
		: hasObservedStateChange ? "captured-state-missing-action"
		: expanded.length ? "stateful-missing-capture-or-action"
		: entry.tag === "button" || entry.role === "button" || entry.role === "combobox" ? "observable-action-uncaptured"
		: "native-local-or-static"
	return { ...entry, states: [...entry.states].sort(), actions, expanded, dataStates,
		hitRects: entry.hitRects, allHitRectsPositive: entry.hitRects.length > 0 && entry.hitRects.every((rect: any) => rect.width > 0 && rect.height > 0),
		classification }
}).sort((a, b) => `${a.route}:${a.region}:${a.sourceId}`.localeCompare(`${b.route}:${b.region}:${b.sourceId}`))
const summary = Object.fromEntries([...new Set(items.map((item) => item.classification))].sort().map((classification) =>
	[classification, items.filter((item) => item.classification === classification).length]))
await writeFile(output, JSON.stringify({ schema: "pulp-source-action-inventory-v1", sourceRoots, sourceFiles: files.length,
	summary: { total: items.length, ...summary }, items }, null, 2) + "\n")
console.log(`source action inventory: ${items.length} targets from ${files.length} states`)
