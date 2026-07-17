#!/usr/bin/env bun

import { createHash } from "node:crypto"
import { readFile, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import { Cdp } from "./capture-source-cdp"

const args = new Map<string, string>()
for (let index = 2; index < process.argv.length; index += 2)
	args.set(process.argv[index], process.argv[index + 1])
const candidatesPath = resolve(
	args.get("--candidates") ?? "evidence/phase-b/interaction-candidates.generated.v1.json",
)
const ipcMapPath = resolve(args.get("--ipc-map") ?? "evidence/phase-b/electron-ipc-map.v1.json")
const scenariosPath = resolve(args.get("--scenarios") ?? "evidence/visual-parity/scenarios.v1.json")
const tracePath = resolve(args.get("--trace") ?? "/tmp/burl-palot-ipc-trace.jsonl")
const outputPath = resolve(
	args.get("--output") ?? "evidence/phase-b/electron-interaction-traces.v1.json",
)
const [candidateReport, ipcMap, scenarios] = await Promise.all(
	[candidatesPath, ipcMapPath, scenariosPath].map(async (file) =>
		JSON.parse(await readFile(file, "utf8")),
	),
)
if (candidateReport.summary?.total !== candidateReport.candidates?.length)
	throw new Error("interaction candidate inventory is incomplete")

const pages = await fetch("http://127.0.0.1:9222/json/list").then((response) => response.json())
const page = pages.find((item: { type: string }) => item.type === "page")
if (!page?.webSocketDebuggerUrl) throw new Error("no Electron renderer on CDP port 9222")
const cdp = await Cdp.connect(page.webSocketDebuggerUrl)
const sourceIdFunction = `(element) => { const parts=[]; for(let current=element;current&&current.nodeType===1;current=current.parentElement){const parent=current.parentElement,index=parent?Array.from(parent.children).indexOf(current)+1:1,stable=current.getAttribute('data-testid')||current.id||current.getAttribute('data-slot');parts.push(current.tagName.toLowerCase()+(stable?'['+stable+']:'+index:':'+index));} return parts.reverse().join('/'); }`
const records: unknown[] = []
const channelIndex = new Map(ipcMap.mappings.map((mapping: any) => [mapping.channel, mapping]))
try {
	await cdp.command("Page.enable")
	await cdp.command("Runtime.enable")
	await cdp.command("Emulation.setDeviceMetricsOverride", {
		width: 1200,
		height: 800,
		deviceScaleFactor: 2,
		mobile: false,
	})
	for (let index = 0; index < candidateReport.candidates.length; index += 1) {
		const candidate = candidateReport.candidates[index]
		const activation = `candidate-${String(index + 1).padStart(2, "0")}`
		const navigation = new URL(page.url)
		navigation.hash = scenarios.route.slice(1)
		await cdp.command("Page.navigate", { url: navigation.toString() })
		await Bun.sleep(350)
		await cdp.command("Runtime.evaluate", {
			expression: `localStorage.setItem('palot:mockMode','true');localStorage.setItem('palot:onboarding','{"completed":true}');localStorage.setItem('palot:theme','"dark"');localStorage.removeItem('burlIpcTraceActivation');`,
		})
		await cdp.command("Page.reload", { ignoreCache: true })
		await Bun.sleep(900)
		await cdp.command("Runtime.evaluate", {
			expression: `localStorage.setItem('burlIpcTraceActivation',${JSON.stringify(activation)})`,
		})
		const expression = `(() => { const sid=${sourceIdFunction}; const normalize=value=>value.replace(/\\[base-ui-[^\\]]+\\]/g,''); const visible=e=>{const r=e.getBoundingClientRect();return getComputedStyle(e).display!=='none'&&r.width>0&&r.height>0}; const live=[...document.querySelectorAll('button,input,textarea,select,a,[role=button],[role=combobox],[role=textbox]')].filter(visible); const target=normalize(${JSON.stringify(candidate.sourceId)}); const matches=live.filter(value=>normalize(sid(value))===target); const element=matches.length===1?matches[0]:null,resolution='normalized-structural-source-id'; if(!element)return {found:false,liveCount:live.length,matchCount:matches.length,resolution}; const tag=element.tagName.toLowerCase(),role=element.getAttribute('role')||(tag==='textarea'||tag==='input'?'textbox':tag); if(tag!==${JSON.stringify(candidate.tag)}||role!==${JSON.stringify(candidate.role)})return {found:false,liveCount:live.length,resolution,error:'structural-candidate-mismatch',actual:{tag,role}}; const snapshot=()=>({hash:location.hash,tag,role,expanded:element.getAttribute('aria-expanded'),state:element.getAttribute('data-state'),active:element.getAttribute('data-active'),value:'value' in element?element.value:null,dialogCount:document.querySelectorAll('[role=dialog]').length}); const before=snapshot(),clickTimestampMs=Date.now(); element.click(); return {found:true,resolution,observedSourceId:sid(element),clickTimestampMs,before}; })()`
		const activated = (await cdp.command("Runtime.evaluate", { expression, returnByValue: true }))
			.result.value
		await Bun.sleep(140)
		const after = (
			await cdp.command("Runtime.evaluate", {
				expression: `(() => ({captureTimestampMs:Date.now(),hash:location.hash,activeSourceId:document.activeElement?(${sourceIdFunction})(document.activeElement):null,dialogCount:document.querySelectorAll('[role=dialog]').length,menuCount:document.querySelectorAll('[role=menu],[role=listbox]').length,bodyTextHashInput:(document.body.innerText||'').replace(/\\s+/g,' ').trim()}))()`,
				returnByValue: true,
			})
		).result.value
		after.bodyTextSha256 = createHash("sha256").update(after.bodyTextHashInput).digest("hex")
		delete after.bodyTextHashInput
		let traces: any[] = []
		try {
			traces = (await readFile(tracePath, "utf8"))
				.trim()
				.split("\n")
				.filter(Boolean)
				.map((line) => JSON.parse(line))
				.filter(
					(entry) =>
						entry.activation === activation &&
						entry.timestampMs >= activated.clickTimestampMs &&
						entry.timestampMs <= after.captureTimestampMs,
				)
		} catch {}
		const joined = traces.map((trace) => ({
			...trace,
			ipcContract: trace.channel ? (channelIndex.get(trace.channel) ?? null) : null,
		}))
		records.push({
			index: index + 1,
			activation,
			sourceId: candidate.sourceId,
			evidence: candidate.evidence,
			priorReview: candidate.review,
			activated,
			after,
			traces: joined,
		})
		await cdp.command("Input.dispatchKeyEvent", {
			type: "keyDown",
			key: "Escape",
			code: "Escape",
			windowsVirtualKeyCode: 27,
		})
		await cdp.command("Input.dispatchKeyEvent", {
			type: "keyUp",
			key: "Escape",
			code: "Escape",
			windowsVirtualKeyCode: 27,
		})
	}
} finally {
	cdp.close()
}
const document = {
	schema: "burl-electron-interaction-trace-v1",
	sourceRevision: ipcMap.source.revision,
	inputs: {
		interactionCandidates: "interaction-candidates.generated.v1.json",
		ipcMap: "electron-ipc-map.v1.json",
	},
	summary: {
		total: records.length,
		found: records.filter((record: any) => record.activated.found).length,
		ipcProducing: records.filter((record: any) => record.traces.length).length,
	},
	records,
}
await writeFile(outputPath, `${JSON.stringify(document, null, 2)}\n`)
console.log(JSON.stringify(document.summary))
