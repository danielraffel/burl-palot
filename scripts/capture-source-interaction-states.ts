#!/usr/bin/env bun

import { createHash } from "node:crypto"
import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import sharp from "sharp"
import { bootstrapSource, Cdp, semanticExpression } from "./capture-source-cdp"

const args = new Map<string, string>()
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i], process.argv[i + 1])
const scenarioPath = resolve(
	args.get("--scenario-manifest") ?? "evidence/visual-parity/scenarios.v1.json",
)
const statesPath = resolve(
	args.get("--states-manifest") ??
		"evidence/phase-b/source-interaction-states/source-interaction-states.v1.json",
)
const output = resolve(
	args.get("--output") ?? "evidence/phase-b/source-interaction-states/generated-v1",
)
const scenarios = JSON.parse(await readFile(scenarioPath, "utf8"))
const states = JSON.parse(await readFile(statesPath, "utf8"))
const scenario = scenarios.scenarios.find((value: { id: string }) => value.id === states.scenario)
if (!scenario || states.schemaVersion !== 1) throw new Error("invalid interaction-state manifest")
const capture = { ...scenarios.captureDefaults, ...(scenario.capture ?? {}) }
const sha256 = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex")
interface SemanticNode {
	sourceId: string
	children?: SemanticNode[]
	content?: Array<{ kind: string; text?: string }>
}
const pages = await fetch("http://127.0.0.1:9222/json/list").then((response) => response.json())
const page = pages.find((item: { type: string }) => item.type === "page")
if (!page?.webSocketDebuggerUrl) throw new Error("no Electron renderer on CDP port 9222")
const cdp = await Cdp.connect(page.webSocketDebuggerUrl)
await rm(output, { recursive: true, force: true })
await mkdir(output, { recursive: true })
const records = []
try {
	await cdp.command("Page.enable")
	await cdp.command("Runtime.enable")
	await cdp.command("DOM.enable")
	await cdp.command("CSS.enable")
	await cdp.command("Emulation.setDeviceMetricsOverride", {
		width: capture.logicalWidth,
		height: capture.logicalHeight,
		deviceScaleFactor: capture.deviceScaleFactor,
		mobile: false,
	})
	await cdp.command("Page.addScriptToEvaluateOnNewDocument", {
		source: bootstrapSource(scenarios.clock, scenarios.sourceBootstrap.localStorage),
	})
	for (const state of states.states) {
		if (state.availability === "gap") {
			records.push({ id: state.id, status: "GAP", gapCode: state.gapCode })
			continue
		}
		const navigation = new URL(page.url)
		navigation.hash = `${scenarios.route.slice(1)}&visualCapture=${encodeURIComponent(state.id)}`
		await cdp.command("Page.navigate", { url: navigation.toString() })
		await cdp.command("Page.reload", { ignoreCache: true })
		await Bun.sleep(700)
		await cdp.command("Runtime.evaluate", {
			expression:
				"Promise.race([document.fonts.ready.then(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))),new Promise(r=>setTimeout(r,2500))])",
			awaitPromise: true,
		})
		await cdp.command("Input.dispatchMouseEvent", {
			type: "mouseMoved",
			x: capture.logicalWidth - 2,
			y: capture.logicalHeight - 2,
		})
		const locate = `(() => { const sid=(element)=>{const parts=[];for(let current=element;current&&current.nodeType===1;current=current.parentElement){const parent=current.parentElement,index=parent?Array.from(parent.children).indexOf(current)+1:1,stable=current.getAttribute('data-testid')||current.id||current.getAttribute('data-slot');parts.push(current.tagName.toLowerCase()+(stable?'['+stable+']:'+index:':'+index));}return parts.reverse().join('/')}; const candidates=[...document.querySelectorAll(${JSON.stringify(state.selector)})]; const el=candidates.find(e=>!${JSON.stringify(state.descendantText ?? "")} || (e.textContent||'').trim().replace(/\\s+/g,' ')===${JSON.stringify(state.descendantText ?? "")}); if(!el)return null; const r=el.getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height,sourceId:sid(el)}; })()`
		const found = (
			await cdp.command("Runtime.evaluate", { expression: locate, returnByValue: true })
		).result.value
		if (!found) {
			if (state.availability !== "optional")
				throw new Error(`${state.id}: source target unavailable`)
			records.push({
				id: state.id,
				status: "GAP",
				gapCode: "source-state-unavailable",
				selector: state.selector,
			})
			continue
		}
		const cx = found.x + found.width / 2,
			cy = found.y + found.height / 2
		let mouseDownHeld = false
		if (state.action.type === "hover")
			await cdp.command("Input.dispatchMouseEvent", { type: "mouseMoved", x: cx, y: cy })
		if (state.action.type === "pressed") {
			const document = await cdp.command("DOM.getDocument")
			const selected = await cdp.command("DOM.querySelector", {
				nodeId: document.root.nodeId,
				selector: state.selector,
			})
			if (!selected.nodeId) throw new Error(`${state.id}: pseudo-state target unavailable`)
			await cdp.command("CSS.forcePseudoState", {
				nodeId: selected.nodeId,
				forcedPseudoClasses: ["active"],
			})
			await cdp.command("Input.dispatchMouseEvent", { type: "mouseMoved", x: cx, y: cy })
			await cdp.command("Input.dispatchMouseEvent", {
				type: "mousePressed",
				x: cx,
				y: cy,
				button: "left",
				clickCount: 1,
			})
			mouseDownHeld = true
		}
		if (state.action.type === "focus" || state.action.type === "type")
			await cdp.command("Runtime.evaluate", {
				expression: `document.querySelector(${JSON.stringify(state.selector)}).focus()`,
			})
		if (state.action.type === "type")
			await cdp.command("Input.insertText", { text: state.action.text })
		if (state.action.type === "scroll") {
			const result = await cdp.command("Runtime.evaluate", {
				expression: `(() => { const roots=[...document.querySelectorAll(${JSON.stringify(state.selector)})]; const el=[...roots,...roots.flatMap(r=>[...r.querySelectorAll('*')])].filter(e=>e.scrollHeight>e.clientHeight+20).sort((a,b)=>(b.scrollHeight-b.clientHeight)-(a.scrollHeight-a.clientHeight))[0]; if(!el)return null; el.scrollTop=${state.action.top}; const r=el.getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height,scrollTop:el.scrollTop}; })()`,
				returnByValue: true,
			})
			if (!result.result.value || result.result.value.scrollTop !== state.action.top) {
				records.push({ id: state.id, status: "GAP", gapCode: "stable-scroll-region-unavailable" })
				continue
			}
			Object.assign(found, result.result.value)
		}
		await Bun.sleep(50)
		const post = (
			await cdp.command("Runtime.evaluate", {
				expression: `(() => { const candidates=[...document.querySelectorAll(${JSON.stringify(state.selector)})]; const el=candidates.find(e=>!${JSON.stringify(state.descendantText ?? "")} || (e.textContent||'').trim().replace(/\\s+/g,' ')===${JSON.stringify(state.descendantText ?? "")}); return {active:document.activeElement===el,value:'value' in el?el.value:'',dataActive:el?.hasAttribute('data-active'),disabled:!!(el?.disabled||el?.getAttribute('aria-disabled')==='true'),hover:el?.matches(':hover'),activePseudo:el?.matches(':active'),rect:el?(()=>{const r=el.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height}})():null}; })()`,
				returnByValue: true,
			})
		).result.value
		post.mouseDownHeldAtCapture = mouseDownHeld
		post.visualStateMethod =
			state.action.type === "pressed" ? "CSS.forcePseudoState(:active)" : "natural"
		const semantics = (
			await cdp.command("Runtime.evaluate", { expression: semanticExpression, returnByValue: true })
		).result.value
		const shot = await cdp.command("Page.captureScreenshot", {
			format: "png",
			fromSurface: true,
			captureBeyondViewport: false,
		})
		const full = Buffer.from(shot.data, "base64")
		const rect = post.rect ?? found
		const flatten = (node: SemanticNode): SemanticNode[] => [
			node,
			...(node.children ?? []).flatMap(flatten),
		]
		const targetSemantic = flatten(semantics.observedDom).find(
			(node) => node.sourceId === found.sourceId,
		)
		if (!targetSemantic) throw new Error(`${state.id}: target semantic subtree unavailable`)
		const targetSemantics = { capture: semantics.capture, observedDom: targetSemantic }
		const orderedNodes = flatten(targetSemantic)
		const orderedText = orderedNodes
			.flatMap((node) => node.content ?? [])
			.filter((item: { kind: string }) => item.kind === "text")
			.map((item: { text: string }) => item.text)
			.join("")
		const childThenText = orderedNodes.some((node) => {
			const kinds = (node.content ?? []).map((item: { kind: string }) => item.kind)
			return kinds.indexOf("child") >= 0 && kinds.indexOf("text") > kinds.indexOf("child")
		})
		const left = Math.floor(rect.x * capture.deviceScaleFactor),
			top = Math.floor(rect.y * capture.deviceScaleFactor)
		const width = Math.ceil((rect.x + rect.width) * capture.deviceScaleFactor) - left
		const height = Math.ceil((rect.y + rect.height) * capture.deviceScaleFactor) - top
		const crop = await sharp(full)
			.extract({ left, top, width, height })
			.png({ compressionLevel: 9 })
			.toBuffer()
		post.contentFloorPass = (await sharp(crop).stats()).entropy > 0.01
		const directory = resolve(output, state.id)
		await mkdir(directory, { recursive: true })
		await Promise.all([
			writeFile(resolve(directory, "crop.png"), crop),
			writeFile(
				resolve(directory, "semantics.json"),
				`${JSON.stringify(targetSemantics, null, 2)}\n`,
			),
		])
		const postconditionPass =
			state.postcondition === "matches-hover"
				? post.hover
				: state.postcondition === "mouse-down-held"
					? post.hover && mouseDownHeld && post.activePseudo && post.contentFloorPass
					: state.postcondition === "active-element"
						? post.active
						: state.postcondition === "data-active-present"
							? post.dataActive
							: state.postcondition === "focused-empty"
								? post.active && post.value === ""
								: state.postcondition === "focused-value-exact"
									? post.active && post.value === state.action.text
									: state.postcondition === "scroll-top-exact"
										? found.scrollTop === state.action.top
										: state.postcondition === "ordered-content-present"
											? /\d+m\s+\d+s/.test(orderedText) && childThenText
											: state.postcondition === "disabled"
												? post.disabled
												: false
		if (state.action.type === "pressed")
			await cdp.command("Input.dispatchMouseEvent", {
				type: "mouseReleased",
				x: cx,
				y: cy,
				button: "left",
				clickCount: 1,
			})
		if (!postconditionPass) throw new Error(`${state.id}: postcondition failed`)
		const record = {
			id: state.id,
			status: "PASS",
			action: state.action,
			postcondition: state.postcondition,
			post,
			geometry: {
				logical: rect,
				pixel: { left, top, width, height },
				devicePixelRatio: capture.deviceScaleFactor,
			},
			files: {
				crop: `${state.id}/crop.png`,
				semantics: `${state.id}/semantics.json`,
			},
			hashes: {
				crop: sha256(crop),
				semantics: sha256(`${JSON.stringify(targetSemantics, null, 2)}\n`),
			},
		}
		await writeFile(resolve(directory, "evidence.json"), `${JSON.stringify(record, null, 2)}\n`)
		records.push(record)
	}
} finally {
	cdp.close()
}
await writeFile(
	resolve(output, "evidence.json"),
	`${JSON.stringify({ schemaVersion: 1, sourceRevision: scenarios.source.revision, clock: scenarios.clock, capture, records }, null, 2)}\n`,
)
