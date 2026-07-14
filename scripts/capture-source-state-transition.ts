#!/usr/bin/env bun

import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import { Cdp, captureAtomicFrame, semanticExpression } from "./capture-source-cdp"

interface Target {
	selector: string
	descendantText?: string
}

interface StateCaptureManifest {
	schemaVersion: number
	cdpEndpoint: string
	pageUrlPattern?: string
	viewport: { width: number; height: number; deviceScaleFactor: number }
	sourceRevision: string
	clock?: string
	reloadBeforeCapture?: boolean
	reloadSettleMs?: number
	setup?: Array<
		| { type: "evaluate"; expression: string }
		| { type: "pointer"; target: Target; button?: "left" | "right" }
	>
	initialStateCapture?: { state: string }
	scenarios: Array<{
		id: string
		action:
			| { type: "pointer"; target: Target; button?: "left" | "right" }
			| { type: "focus"; target: Target; maxTabs?: number }
			| { type: "key"; key: string; code?: string; windowsVirtualKeyCode?: number }
			| {
					type: "hover"
					target: Target
					appearance: { selector: string; timeoutMs: number; pollMs?: number }
				}
		settleMs?: number
		stateCapture?: { state: string }
	}>
}

async function dispatchFocus(
	target: Target,
	maxTabs = 60,
): Promise<Record<string, unknown>> {
	const targetIdentity = (
		await cdp.command("Runtime.evaluate", {
			expression: `(() => { const normalize=value=>(value||'').trim().replace(/\\s+/g,' '); const candidates=[...document.querySelectorAll(${JSON.stringify(target.selector)})]; const expected=${JSON.stringify(target.descendantText ?? "")}; const element=candidates.find(value=>!expected||normalize(value.textContent)===expected); if(!element)return null; const sid=value=>{const parts=[];for(let current=value;current&&current.nodeType===1;current=current.parentElement){const parent=current.parentElement,index=parent?Array.from(parent.children).filter(value=>value.tagName===current.tagName).indexOf(current)+1:1,stable=current.getAttribute('data-testid')||current.id||current.getAttribute('data-slot');parts.push(current.tagName.toLowerCase()+(stable?'['+stable+']:'+index:':'+index));}return parts.reverse().join('/')}; return {sourceId:sid(element),accessibleName:normalize(element.getAttribute('aria-label'))||normalize(element.textContent)}; })()`,
			returnByValue: true,
		})
	).result.value as { sourceId: string; accessibleName: string } | null
	if (!targetIdentity) throw new Error(`focus target unavailable: ${JSON.stringify(target)}`)
	const eventIndex = (
		await cdp.command("Runtime.evaluate", {
			expression: `(window.__burlSourceFocusEvents||[]).length`,
			returnByValue: true,
		})
	).result.value as number
	let tabs = 0
	for (; tabs <= maxTabs; tabs += 1) {
		const focused = (
			await cdp.command("Runtime.evaluate", {
				expression: `(() => { const normalize=value=>(value||'').trim().replace(/\\s+/g,' '); const candidates=[...document.querySelectorAll(${JSON.stringify(target.selector)})]; const expected=${JSON.stringify(target.descendantText ?? "")}; const target=candidates.find(value=>!expected||normalize(value.textContent)===expected); return Boolean(target&&document.activeElement===target); })()`,
				returnByValue: true,
			})
		).result.value as boolean
		if (focused) break
		if (tabs === maxTabs) throw new Error(`focus target not reached after ${maxTabs} Tab keys`)
		await cdp.command("Input.dispatchKeyEvent", {
			type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9,
		})
		await cdp.command("Input.dispatchKeyEvent", {
			type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9,
		})
	}
	const result = (
		await cdp.command("Runtime.evaluate", {
			expression: `(() => { const sid=element=>{const parts=[];for(let current=element;current&&current.nodeType===1;current=current.parentElement){const parent=current.parentElement,index=parent?Array.from(parent.children).filter(value=>value.tagName===current.tagName).indexOf(current)+1:1,stable=current.getAttribute('data-testid')||current.id||current.getAttribute('data-slot');parts.push(current.tagName.toLowerCase()+(stable?'['+stable+']:'+index:':'+index));}return parts.reverse().join('/')}; return {focusAfter:document.activeElement&&document.activeElement!==document.body?sid(document.activeElement):null,events:(window.__burlSourceFocusEvents||[]).slice(${eventIndex})}; })()`,
			returnByValue: true,
		})
	).result.value as { focusAfter: string | null; events: Array<Record<string, unknown>> }
	return { ...targetIdentity, focusAfter: result.focusAfter, events: result.events, tabs }
}

const structuralStateExpression = `(() => {
  const round = value => Math.round(value * 1000) / 1000;
  const sourceId = element => {
    const parts = [];
    for (let current = element; current && current.nodeType === 1; current = current.parentElement) {
      const parent = current.parentElement;
      const index = parent
        ? Array.from(parent.children).filter(value => value.tagName === current.tagName).indexOf(current) + 1
        : 1;
      const stable = current.getAttribute("data-testid") || current.id || current.getAttribute("data-slot");
      parts.push(current.tagName.toLowerCase() + (stable ? "[" + stable + "]:" + index : ":" + index));
    }
    return parts.reverse().join("/");
  };
  const elements = Array.from(document.querySelectorAll("*")).map(element => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return {
      sourceId: sourceId(element),
      captureInstanceId: globalThis.__burlCaptureElementId?.(element) ?? null,
      tagName: element.tagName.toLowerCase(),
      id: element.id || null,
      dataSlot: element.getAttribute("data-slot"),
      role: element.getAttribute("role"),
      ariaExpanded: element.getAttribute("aria-expanded"),
      ariaControls: element.getAttribute("aria-controls"),
      normalizedText: (element.textContent || "").trim().replace(/\\s+/g, " "),
      hidden: !!element.hidden,
      rect: {x:round(rect.x),y:round(rect.y),width:round(rect.width),height:round(rect.height)},
      computedStyle: {
        display: style.display, position: style.position, visibility: style.visibility,
        flexDirection: style.flexDirection, flexGrow: style.flexGrow, flexShrink: style.flexShrink,
        width: style.width, height: style.height, minWidth: style.minWidth, minHeight: style.minHeight,
        padding: style.padding, margin: style.margin, gap: style.gap,
        transform: style.transform, overflowX: style.overflowX, overflowY: style.overflowY
      }
    };
  });
  return {
    capture: {innerWidth,innerHeight,devicePixelRatio,title:document.title,url:location.href},
    bodyRect: (() => { const rect=document.body.getBoundingClientRect(); return {x:round(rect.x),y:round(rect.y),width:round(rect.width),height:round(rect.height)}; })(),
    elements
  };
})()`

const args = new Map<string, string>()
for (let index = 2; index < process.argv.length; index += 2)
	args.set(process.argv[index], process.argv[index + 1])
const manifestArg = args.get("--manifest")
if (!manifestArg) throw new Error("--manifest is required")
const manifestPath = resolve(manifestArg)
const outputArg = args.get("--output")
if (!outputArg)
	throw new Error("--output is required; canonical capture directories are never inferred")
const output = resolve(outputArg)
const initialCondition = args.get("--initial-condition")
const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as StateCaptureManifest
if (manifest.schemaVersion !== 1) throw new Error("unsupported source state capture manifest")

const pages = (await fetch(`${manifest.cdpEndpoint}/json/list`).then((response) =>
	response.json(),
)) as Array<{ type: string; url: string; webSocketDebuggerUrl?: string }>
const pattern = manifest.pageUrlPattern ? new RegExp(manifest.pageUrlPattern) : null
const page = pages.find((item) => item.type === "page" && (!pattern || pattern.test(item.url)))
if (!page?.webSocketDebuggerUrl) throw new Error("no matching Electron renderer page")
const cdp = await Cdp.connect(page.webSocketDebuggerUrl)

interface PointerObservation {
	selector: string
	descendantText: string | null
	tagName: string
	role: string | null
	accessibleName: string
	dataSlot: string | null
	observedActionAttribute: string | null
	normalizedText: string
	sourceId: string
	captureInstanceId: string | null
	ariaExpandedBefore: string | null
	button: "left" | "right"
	anchorPoint: { x: number; y: number }
	events: Array<{
		type: string
		isTrusted: boolean
		targetSourceId: string
		targetCaptureInstanceId: string | null
		intendedTargetCaptureInstanceId: string | null
		intendedTargetInComposedPath: boolean
	}>
	focusBefore: string | null
	focusAfter: string | null
}

async function dispatchPointer(
	target: Target,
	button: "left" | "right" = "left",
): Promise<PointerObservation> {
	const before = (
		await cdp.command("Runtime.evaluate", {
			expression: `({eventIndex:(window.__burlSourcePointerEvents||[]).length,focus:(()=>{const el=document.activeElement;if(!el||el===document.body)return null;const parts=[];for(let current=el;current&&current.nodeType===1;current=current.parentElement){const parent=current.parentElement,index=parent?Array.from(parent.children).filter(value=>value.tagName===current.tagName).indexOf(current)+1:1,stable=current.getAttribute('data-testid')||current.id||current.getAttribute('data-slot');parts.push(current.tagName.toLowerCase()+(stable?'['+stable+']:'+index:':'+index));}return parts.reverse().join('/');})()})`,
			returnByValue: true,
		})
	).result.value as { eventIndex: number; focus: string | null }
	const location = (
		await cdp.command("Runtime.evaluate", {
			expression: `(() => { const normalize=value=>(value||'').trim().replace(/\\s+/g,' '); const sourceId=element=>{const parts=[];for(let current=element;current&&current.nodeType===1;current=current.parentElement){const parent=current.parentElement,index=parent?Array.from(parent.children).filter(value=>value.tagName===current.tagName).indexOf(current)+1:1,stable=current.getAttribute('data-testid')||current.id||current.getAttribute('data-slot');parts.push(current.tagName.toLowerCase()+(stable?'['+stable+']:'+index:':'+index));}return parts.reverse().join('/')}; const candidates=[...document.querySelectorAll(${JSON.stringify(target.selector)})]; const expected=${JSON.stringify(target.descendantText ?? "")}; const element=candidates.find(value=>!expected||normalize(value.textContent)===expected); if(!element)return null; window.__burlIntendedPointerTarget=element; const rect=element.getBoundingClientRect(); const tagName=element.tagName.toLowerCase(); const role=element.getAttribute('role')||(tagName==='button'?'button':tagName==='a'?'link':null); const normalizedText=normalize(element.textContent); return {x:rect.x+rect.width/2,y:rect.y+rect.height/2,tagName,role,accessibleName:normalize(element.getAttribute('aria-label'))||normalizedText,dataSlot:element.getAttribute('data-slot'),observedActionAttribute:element.getAttribute('data-pulp-action'),normalizedText,sourceId:sourceId(element),captureInstanceId:window.__burlCaptureElementId?.(element)??null,ariaExpandedBefore:element.getAttribute('aria-expanded')}; })()`,
			returnByValue: true,
		})
	).result.value as {
		x: number
		y: number
		tagName: string
		role: string | null
		accessibleName: string
		dataSlot: string | null
		observedActionAttribute: string | null
		normalizedText: string
		sourceId: string
		captureInstanceId: string | null
		ariaExpandedBefore: string | null
	} | null
	if (!location) throw new Error(`pointer target unavailable: ${JSON.stringify(target)}`)
	await cdp.command("Input.dispatchMouseEvent", {
		type: "mouseMoved",
		x: location.x,
		y: location.y,
	})
	await cdp.command("Input.dispatchMouseEvent", {
		type: "mousePressed",
		x: location.x,
		y: location.y,
		button,
		clickCount: 1,
	})
	await cdp.command("Input.dispatchMouseEvent", {
		type: "mouseReleased",
		x: location.x,
		y: location.y,
		button,
		clickCount: 1,
	})
	await cdp.command("Input.dispatchMouseEvent", {
		type: "mouseMoved",
		x: manifest.viewport.width - 2,
		y: manifest.viewport.height - 2,
	})
	const after = (
		await cdp.command("Runtime.evaluate", {
			expression: `(() => { const sid=element=>{const parts=[];for(let current=element;current&&current.nodeType===1;current=current.parentElement){const parent=current.parentElement,index=parent?Array.from(parent.children).filter(value=>value.tagName===current.tagName).indexOf(current)+1:1,stable=current.getAttribute('data-testid')||current.id||current.getAttribute('data-slot');parts.push(current.tagName.toLowerCase()+(stable?'['+stable+']:'+index:':'+index));}return parts.reverse().join('/')}; const focus=document.activeElement&&document.activeElement!==document.body?sid(document.activeElement):null; return {focus,events:(window.__burlSourcePointerEvents||[]).slice(${before.eventIndex})}; })()`,
			returnByValue: true,
		})
	).result.value as {
		focus: string | null
		events: PointerObservation["events"]
	}
	return {
		selector: target.selector,
		descendantText: target.descendantText ?? null,
		tagName: location.tagName,
		role: location.role,
		accessibleName: location.accessibleName,
		dataSlot: location.dataSlot,
		observedActionAttribute: location.observedActionAttribute,
		normalizedText: location.normalizedText,
		sourceId: location.sourceId,
		captureInstanceId: location.captureInstanceId,
		ariaExpandedBefore: location.ariaExpandedBefore,
		button,
		anchorPoint: { x: location.x, y: location.y },
		events: after.events,
		focusBefore: before.focus,
		focusAfter: after.focus,
	}
}

async function dispatchKey(action: {
	key: string
	code?: string
	windowsVirtualKeyCode?: number
}): Promise<Record<string, unknown>> {
	const focusExpression = `(() => { const el=document.activeElement;if(!el||el===document.body)return null;const parts=[];for(let current=el;current&&current.nodeType===1;current=current.parentElement){const parent=current.parentElement,index=parent?Array.from(parent.children).filter(value=>value.tagName===current.tagName).indexOf(current)+1:1,stable=current.getAttribute('data-testid')||current.id||current.getAttribute('data-slot');parts.push(current.tagName.toLowerCase()+(stable?'['+stable+']:'+index:':'+index));}return parts.reverse().join('/'); })()`
	const eventIndex = (
		await cdp.command("Runtime.evaluate", {
			expression: `({eventIndex:(window.__burlSourceKeyEvents||[]).length,focus:${focusExpression}})`,
			returnByValue: true,
		})
	).result.value as { eventIndex: number; focus: string | null }
	const code = action.code ?? action.key
	const windowsVirtualKeyCode = action.windowsVirtualKeyCode
		?? (action.key === "Escape" ? 27 : action.key.length === 1 ? action.key.charCodeAt(0) : 0)
	await cdp.command("Input.dispatchKeyEvent", {
		type: "keyDown", key: action.key, code, windowsVirtualKeyCode,
	})
	await cdp.command("Input.dispatchKeyEvent", {
		type: "keyUp", key: action.key, code, windowsVirtualKeyCode,
	})
	return (
		await cdp.command("Runtime.evaluate", {
			expression: `({events:(window.__burlSourceKeyEvents||[]).slice(${eventIndex.eventIndex}),focusBefore:${JSON.stringify(eventIndex.focus)},focusAfter:${focusExpression}})`,
			returnByValue: true,
		})
	).result.value as Record<string, unknown>
}

async function dispatchHover(
	target: Target,
	appearance: { selector: string; timeoutMs: number; pollMs?: number },
): Promise<PointerObservation & { timing: Record<string, unknown> }> {
	const location = (
		await cdp.command("Runtime.evaluate", {
			expression: `(() => { const normalize=value=>(value||'').trim().replace(/\\s+/g,' '); const candidates=[...document.querySelectorAll(${JSON.stringify(target.selector)})]; const expected=${JSON.stringify(target.descendantText ?? "")}; const element=candidates.find(value=>!expected||normalize(value.textContent)===expected); if(!element)return null; if(document.querySelector(${JSON.stringify(appearance.selector)}))throw new Error('hover appearance already mounted'); const rect=element.getBoundingClientRect(); const sid=value=>{const parts=[];for(let current=value;current&&current.nodeType===1;current=current.parentElement){const parent=current.parentElement,index=parent?Array.from(parent.children).filter(value=>value.tagName===current.tagName).indexOf(current)+1:1,stable=current.getAttribute('data-testid')||current.id||current.getAttribute('data-slot');parts.push(current.tagName.toLowerCase()+(stable?'['+stable+']:'+index:':'+index));}return parts.reverse().join('/')}; const probe={armedAt:performance.now(),enteredAt:null,mountedAt:null,enterTrusted:null,targetSourceId:sid(element)}; element.addEventListener('pointerenter',event=>{probe.enteredAt=performance.now();probe.enterTrusted=event.isTrusted},{once:true}); const observer=new MutationObserver(()=>{if(probe.mountedAt===null&&document.querySelector(${JSON.stringify(appearance.selector)})){probe.mountedAt=performance.now();observer.disconnect();}}); observer.observe(document.documentElement,{childList:true,subtree:true}); window.__burlHoverProbe=probe; window.__burlHoverObserver=observer; const tagName=element.tagName.toLowerCase(); const role=element.getAttribute('role')||(tagName==='button'?'button':tagName==='a'?'link':null); return {x:rect.x+rect.width/2,y:rect.y+rect.height/2,tagName,role,accessibleName:normalize(element.getAttribute('aria-label'))||normalize(element.textContent),dataSlot:element.getAttribute('data-slot'),observedActionAttribute:element.getAttribute('data-pulp-action'),normalizedText:normalize(element.textContent)}; })()`,
			returnByValue: true,
		})
		).result.value as (Omit<PointerObservation, "events" | "focusBefore" | "focusAfter" |
			"sourceId" | "ariaExpandedBefore" | "button" | "anchorPoint"> & {
		x: number
		y: number
	}) | null
	if (!location) throw new Error(`hover target unavailable: ${JSON.stringify(target)}`)
	const dispatchIssuedAtHostMs = performance.now()
	const dispatch = cdp.command("Input.dispatchMouseEvent", {
		type: "mouseMoved", x: location.x, y: location.y,
	})
	const deadline = Date.now() + appearance.timeoutMs
	let probe: Record<string, unknown> | null = null
	let lastAbsentAtHostMs = dispatchIssuedAtHostMs
	let firstPresentAtHostMs: number | null = null
	do {
		probe = (
			await cdp.command("Runtime.evaluate", {
				expression: `window.__burlHoverProbe`,
				returnByValue: true,
			})
		).result.value as Record<string, unknown> | null
		if (probe?.mountedAt !== null && probe?.mountedAt !== undefined) {
			firstPresentAtHostMs = performance.now()
			break
		}
		lastAbsentAtHostMs = performance.now()
		await Bun.sleep(appearance.pollMs ?? 5)
	} while (Date.now() < deadline)
	await dispatch
	const dispatchCompletedAtHostMs = performance.now()
	await cdp.command("Runtime.evaluate", {
		expression: `window.__burlHoverObserver?.disconnect()`,
		returnByValue: true,
	})
	if (!probe || probe.enteredAt === null || probe.mountedAt === null)
		throw new Error(`hover appearance did not mount: ${appearance.selector}`)
	return {
		selector: target.selector,
		descendantText: target.descendantText ?? null,
		tagName: location.tagName,
		role: location.role,
		accessibleName: location.accessibleName,
		dataSlot: location.dataSlot,
		observedActionAttribute: location.observedActionAttribute,
		normalizedText: location.normalizedText,
		sourceId: "",
		ariaExpandedBefore: null,
		events: [],
		focusBefore: null,
		focusAfter: null,
		timing: {
			clock: "renderer-performance-now",
			armedAtMs: probe.armedAt,
			pointerEnteredAtMs: probe.enteredAt,
			contentMountedAtMs: probe.mountedAt,
			openDelayMs: Number(probe.mountedAt) - Number(probe.enteredAt),
			hostMonotonicBracket: {
				dispatchIssuedAtMs: dispatchIssuedAtHostMs,
				dispatchCompletedAtMs: dispatchCompletedAtHostMs,
				lastAbsentAtMs: lastAbsentAtHostMs,
				firstPresentAtMs: firstPresentAtHostMs,
				openDelayLowerBoundMs: Math.max(0, lastAbsentAtHostMs - dispatchIssuedAtHostMs),
				openDelayUpperBoundMs: Math.max(0, Number(firstPresentAtHostMs) - dispatchIssuedAtHostMs),
			},
			pointerEnterTrusted: probe.enterTrusted,
			appearanceSelector: appearance.selector,
		},
	}
}

async function writeCapture(
	directoryName: string,
	state: string,
): Promise<Record<string, unknown>> {
	const capture = await captureAtomicFrame<Record<string, unknown>>(
		cdp,
		`Object.assign(${structuralStateExpression}, { semantics: ${semanticExpression} })`,
	)
	const elements = (capture.snapshot.elements ?? []) as Array<{
		dataSlot?: string | null
		rect: { x: number; y: number; width: number; height: number }
	}>
	const landmarkGeometry = elements
		.filter((element) => element.dataSlot)
		.map((element) => ({
			dataSlot: element.dataSlot,
			...element.rect,
			right: element.rect.x + element.rect.width,
			bottom: element.rect.y + element.rect.height,
			viewportRightGap: manifest.viewport.width - (element.rect.x + element.rect.width),
			viewportBottomGap: manifest.viewport.height - (element.rect.y + element.rect.height),
		}))
	const directory = resolve(output, directoryName)
	await mkdir(directory, { recursive: true })
	await Promise.all([
		writeFile(resolve(directory, "source.png"), capture.png),
		writeFile(resolve(directory, "source.json"), `${JSON.stringify(capture.snapshot, null, 2)}\n`),
		writeFile(
			resolve(directory, "meta.json"),
			`${JSON.stringify(
				{
					schemaVersion: 1,
					state,
					sourceRevision: manifest.sourceRevision,
					pageUrl: page?.url,
					viewport: manifest.viewport,
					landmarkGeometry,
					atomicity: capture.proof,
				},
				null,
				2,
			)}\n`,
		),
	])
	return { state, directory, landmarkGeometry, atomicity: capture.proof }
}

await rm(output, { recursive: true, force: true })
await mkdir(output, { recursive: true })
const records: Array<Record<string, unknown>> = []
try {
	await cdp.command("Page.enable")
	await cdp.command("Runtime.enable")
	if (manifest.clock) {
		const epoch = Date.parse(manifest.clock)
		if (!Number.isFinite(epoch)) throw new Error("invalid source state capture clock")
		await cdp.command("Page.addScriptToEvaluateOnNewDocument", {
			source: `(() => { const NativeDate=Date; const epoch=${epoch}; class CapturedDate extends NativeDate { constructor(...args) { super(...(args.length ? args : [epoch])); } static now() { return epoch; } } globalThis.Date=CapturedDate; })()`,
		})
	}
	await cdp.command("Emulation.setDeviceMetricsOverride", {
		width: manifest.viewport.width,
		height: manifest.viewport.height,
		deviceScaleFactor: manifest.viewport.deviceScaleFactor,
		mobile: false,
		screenWidth: manifest.viewport.width,
		screenHeight: manifest.viewport.height,
	})
	if (manifest.reloadBeforeCapture) {
		await cdp.command("Page.reload", { ignoreCache: true })
		await Bun.sleep(manifest.reloadSettleMs ?? 700)
		await cdp.command("Runtime.evaluate", {
			expression: "Promise.race([document.fonts.ready.then(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))),new Promise(r=>setTimeout(r,2500))])",
			awaitPromise: true,
			returnByValue: true,
		})
	}
	await cdp.command("Runtime.evaluate", {
		expression: `(() => { const sid=element=>{const parts=[];for(let current=element;current&&current.nodeType===1;current=current.parentElement){const parent=current.parentElement,index=parent?Array.from(parent.children).filter(value=>value.tagName===current.tagName).indexOf(current)+1:1,stable=current.getAttribute('data-testid')||current.id||current.getAttribute('data-slot');parts.push(current.tagName.toLowerCase()+(stable?'['+stable+']:'+index:':'+index));}return parts.reverse().join('/')}; window.__burlCaptureElementIds=new WeakMap();window.__burlCaptureElementCounter=0;window.__burlCaptureElementId=element=>{if(!element||element.nodeType!==1)return null;let value=window.__burlCaptureElementIds.get(element);if(!value){value='capture-instance-'+(++window.__burlCaptureElementCounter);window.__burlCaptureElementIds.set(element,value);}return value;}; window.__burlSourcePointerEvents=[]; window.__burlSourceFocusEvents=[]; window.__burlSourceKeyEvents=[]; if(!window.__burlSourcePointerListenerInstalled){window.__burlSourcePointerListenerInstalled=true;for(const type of ['pointerdown','pointerup','click','auxclick','contextmenu'])document.addEventListener(type,event=>{const intended=window.__burlIntendedPointerTarget;window.__burlSourcePointerEvents.push({type,isTrusted:event.isTrusted,button:event.button,targetSourceId:sid(event.target),targetCaptureInstanceId:window.__burlCaptureElementId(event.target),intendedTargetCaptureInstanceId:window.__burlCaptureElementId(intended),intendedTargetInComposedPath:Boolean(intended&&event.composedPath().includes(intended))})},true);} if(!window.__burlSourceFocusListenerInstalled){window.__burlSourceFocusListenerInstalled=true;for(const type of ['focusin','focusout'])document.addEventListener(type,event=>window.__burlSourceFocusEvents.push({type,isTrusted:event.isTrusted,targetSourceId:sid(event.target)}),true);} if(!window.__burlSourceKeyListenerInstalled){window.__burlSourceKeyListenerInstalled=true;for(const type of ['keydown','keyup'])document.addEventListener(type,event=>window.__burlSourceKeyEvents.push({type,isTrusted:event.isTrusted,key:event.key,code:event.code,targetSourceId:sid(event.target)}),true);} })()`,
		returnByValue: true,
	})
	await cdp.command("Input.dispatchMouseEvent", {
		type: "mouseMoved",
		x: manifest.viewport.width - 2,
		y: manifest.viewport.height - 2,
	})
	await cdp.command("Runtime.evaluate", {
		expression: `(() => { const id="burl-source-state-capture-motion-guard"; if(document.getElementById(id))return; const style=document.createElement("style"); style.id=id; style.textContent="*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}"; document.documentElement.appendChild(style); })()`,
	})
	await Bun.sleep(200)
	await cdp.command("Runtime.evaluate", {
		expression:
			"Promise.race([document.fonts.ready.then(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))),new Promise(r=>setTimeout(r,2500))])",
		awaitPromise: true,
		returnByValue: true,
	})
	for (const action of manifest.setup ?? []) {
		if (action.type === "pointer") await dispatchPointer(action.target, action.button)
		else if (action.type === "evaluate" && action.expression.trim())
			await cdp.command("Runtime.evaluate", {
				expression: action.expression,
				awaitPromise: true,
				returnByValue: true,
			})
		else throw new Error("unsupported source state capture setup action")
	}
	if (initialCondition) {
		const satisfied = (
			await cdp.command("Runtime.evaluate", {
				expression: `Boolean(${initialCondition})`,
				returnByValue: true,
			})
		).result.value
		if (!satisfied) {
			const normalizer = manifest.scenarios[0]
			if (!normalizer || normalizer.action.type !== "pointer")
				throw new Error("initial condition failed without a pointer normalizer")
			await dispatchPointer(normalizer.action.target, normalizer.action.button)
			if (normalizer.settleMs) await Bun.sleep(normalizer.settleMs)
			const normalized = (
				await cdp.command("Runtime.evaluate", {
					expression: `Boolean(${initialCondition})`,
					returnByValue: true,
				})
			).result.value
			if (!normalized) throw new Error("pointer normalizer did not satisfy initial condition")
		}
	}
	if (manifest.initialStateCapture)
		records.push(await writeCapture("initial", manifest.initialStateCapture.state))
	for (const scenario of manifest.scenarios) {
		const targetObservation = scenario.action.type === "pointer"
			? await dispatchPointer(scenario.action.target, scenario.action.button)
			: scenario.action.type === "focus"
				? await dispatchFocus(scenario.action.target, scenario.action.maxTabs)
				: scenario.action.type === "hover"
					? await dispatchHover(scenario.action.target, scenario.action.appearance)
					: await dispatchKey(scenario.action)
		if (scenario.settleMs) await Bun.sleep(scenario.settleMs)
		records.push({
			...(await writeCapture(scenario.id, scenario.stateCapture?.state ?? scenario.id)),
			action: scenario.action,
			targetObservation,
		})
	}
} finally {
	cdp.close()
}

await writeFile(
	resolve(output, "evidence.json"),
	`${JSON.stringify({ schemaVersion: 1, manifest: manifestPath, records }, null, 2)}\n`,
)
console.log(JSON.stringify({ output, records }))
