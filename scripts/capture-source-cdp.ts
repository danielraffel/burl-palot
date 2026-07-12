#!/usr/bin/env bun

import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"

type Json = Record<string, unknown>

export function bootstrapSource(clock: string, storage: Record<string, string>): string {
	const epoch = Date.parse(clock)
	if (!Number.isFinite(epoch)) throw new Error("invalid frozen clock")
	return `(() => {
const NativeDate = Date;
const epoch = ${epoch};
class FrozenDate extends NativeDate {
  constructor(...args) { super(...(args.length ? args : [epoch])); }
  static now() { return epoch; }
}
globalThis.Date = FrozenDate;
const apply = () => {
  ${Object.entries(storage)
		.map(([key, value]) => `localStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(value)});`)
		.join("\n  ")}
  const style = document.createElement("style");
  style.dataset.visualCapture = "true";
  style.textContent = "*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}";
  document.documentElement.appendChild(style);
};
if (document.documentElement) apply(); else addEventListener("DOMContentLoaded", apply, {once:true});
})();`
}

export const semanticExpression = `(() => {
  const visible = (element) => !!element && getComputedStyle(element).display !== "none" && element.getBoundingClientRect().width > 0;
  const selectedAttributes = ["id", "role", "aria-label", "aria-selected", "aria-expanded", "aria-disabled", "data-slot", "data-state", "data-active", "data-testid"];
  const sourceId = (element) => {
    const parts = [];
    for (let current = element; current && current.nodeType === 1; current = current.parentElement) {
      const parent = current.parentElement;
      const index = parent ? Array.from(parent.children).indexOf(current) + 1 : 1;
      const stable = current.getAttribute("data-testid") || current.id || current.getAttribute("data-slot");
      parts.push(current.tagName.toLowerCase() + (stable ? "[" + stable + "]:" + index : ":" + index));
    }
    return parts.reverse().join("/");
  };
  const observed = (element) => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    const attrs = {};
    for (const name of selectedAttributes) if (element.hasAttribute(name)) attrs[name] = element.getAttribute(name);
    const children = Array.from(element.children).filter(visible).map(observed);
    return {
      sourceId: sourceId(element),
      tagName: element.tagName.toLowerCase(),
      text: children.length === 0 ? (element.textContent || "").trim().replace(/\\s+/g, " ") : "",
      outerHtml: element.tagName.toLowerCase() === "svg" ? element.outerHTML : "",
      imageSrc: element.tagName.toLowerCase() === "img" ? element.getAttribute("src") || "" : "",
      attributes: attrs,
      computedStyle: {
        display: style.display, position: style.position, flexDirection: style.flexDirection,
        flexGrow: style.flexGrow, flexShrink: style.flexShrink, flexBasis: style.flexBasis,
        flexWrap: style.flexWrap, alignItems: style.alignItems, alignSelf: style.alignSelf,
        alignContent: style.alignContent, justifyContent: style.justifyContent,
        gap: style.gap, padding: style.padding, paddingTop: style.paddingTop,
        paddingRight: style.paddingRight, paddingBottom: style.paddingBottom, paddingLeft: style.paddingLeft,
        margin: style.margin, marginTop: style.marginTop, marginRight: style.marginRight,
        marginBottom: style.marginBottom, marginLeft: style.marginLeft,
        width: style.width, height: style.height, minWidth: style.minWidth, minHeight: style.minHeight,
        maxWidth: style.maxWidth, maxHeight: style.maxHeight,
        top: style.top, right: style.right, bottom: style.bottom, left: style.left,
        color: style.color, backgroundColor: style.backgroundColor,
        fontFamily: style.fontFamily, fontSize: style.fontSize, fontWeight: style.fontWeight,
        lineHeight: style.lineHeight, whiteSpace: style.whiteSpace, textAlign: style.textAlign,
        letterSpacing: style.letterSpacing, border: style.border, borderRadius: style.borderRadius,
        borderTopWidth: style.borderTopWidth, borderRightWidth: style.borderRightWidth,
        borderBottomWidth: style.borderBottomWidth, borderLeftWidth: style.borderLeftWidth,
        borderTopColor: style.borderTopColor, borderRightColor: style.borderRightColor,
        borderBottomColor: style.borderBottomColor, borderLeftColor: style.borderLeftColor,
        opacity: style.opacity, boxShadow: style.boxShadow, cursor: style.cursor,
        overflowX: style.overflowX, overflowY: style.overflowY
      },
      rect: {
        x: Math.round(rect.x * 1000) / 1000, y: Math.round(rect.y * 1000) / 1000,
        width: Math.round(rect.width * 1000) / 1000, height: Math.round(rect.height * 1000) / 1000
      },
      children
    };
  };
  return {
    route: location.hash.includes("/session/") ? "session" : "other",
    sidebar: { visible: visible(document.querySelector('[data-slot="sidebar"]')) },
    capture: {
      innerWidth,
      innerHeight,
      devicePixelRatio,
      title: document.title,
      hash: location.hash
    },
    observedDom: observed(document.body)
  };
})()`

class Cdp {
	private socket: WebSocket
	private nextId = 1
	private pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>()

	private constructor(socket: WebSocket) {
		this.socket = socket
		socket.addEventListener("message", (message) => {
			const encoded = typeof message.data === "string"
				? message.data
				: Buffer.from(message.data as ArrayBuffer).toString("utf8")
			const payload = JSON.parse(encoded)
			if (!payload.id) return
			const waiter = this.pending.get(payload.id)
			if (!waiter) return
			this.pending.delete(payload.id)
			if (payload.error) waiter.reject(new Error(JSON.stringify(payload.error)))
			else waiter.resolve(payload.result)
		})
	}

	static async connect(url: string): Promise<Cdp> {
		const socket = new WebSocket(url)
		await new Promise<void>((resolveOpen, rejectOpen) => {
			socket.addEventListener("open", () => resolveOpen(), { once: true })
			socket.addEventListener("error", () => rejectOpen(new Error("CDP WebSocket failed")), { once: true })
		})
		return new Cdp(socket)
	}

	command(method: string, params: Json = {}): Promise<any> {
		const id = this.nextId++
		return new Promise((resolveCommand, rejectCommand) => {
			const timeout = setTimeout(() => {
				this.pending.delete(id)
				rejectCommand(new Error(`CDP command timed out: ${method}`))
			}, 5000)
			this.pending.set(id, {
				resolve: (value) => { clearTimeout(timeout); resolveCommand(value) },
				reject: (error) => { clearTimeout(timeout); rejectCommand(error) }
			})
			this.socket.send(JSON.stringify({ id, method, params }))
		})
	}

	close(): void {
		this.socket.close()
	}
}

async function main() {
	const args = new Map<string, string>()
	for (let index = 2; index < process.argv.length; index += 2) args.set(process.argv[index], process.argv[index + 1])
	const manifestPath = resolve(args.get("--manifest") ?? "evidence/visual-parity/scenarios.v1.json")
	const scenarioId = args.get("--scenario") ?? "01-shell"
	const output = resolve(args.get("--output") ?? `evidence/visual-parity/baselines/${scenarioId}`)
	const manifest = JSON.parse(await readFile(manifestPath, "utf8"))
	const scenario = manifest.scenarios.find((item: any) => item.id === scenarioId)
	if (!scenario) throw new Error(`unknown scenario ${scenarioId}`)
	const capture = { ...manifest.captureDefaults, ...(scenario.capture ?? {}) }
	if (capture.boundary !== "content") throw new Error("CDP helper captures content boundary only")

	const pages = await fetch("http://127.0.0.1:9222/json/list").then((response) => response.json())
	const page = pages.find((item: any) => item.type === "page")
	if (!page?.webSocketDebuggerUrl) throw new Error("no Electron renderer page on CDP port 9222")
	const cdp = await Cdp.connect(page.webSocketDebuggerUrl)
	try {
		await cdp.command("Page.enable")
		await cdp.command("Runtime.enable")
		await cdp.command("Emulation.setDeviceMetricsOverride", {
			width: capture.logicalWidth,
			height: capture.logicalHeight,
			deviceScaleFactor: capture.deviceScaleFactor,
			mobile: false,
			screenWidth: capture.logicalWidth,
			screenHeight: capture.logicalHeight
		})
		await cdp.command("Page.addScriptToEvaluateOnNewDocument", {
			source: bootstrapSource(manifest.clock, manifest.sourceBootstrap.localStorage)
		})
		const navigation = new URL(page.url)
		navigation.hash = manifest.route.slice(1)
		await cdp.command("Page.navigate", { url: navigation.toString() })
		await Bun.sleep(1200)
		await cdp.command("Runtime.evaluate", {
			expression: `Promise.race([
document.fonts.ready.then(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))),
new Promise(resolve => setTimeout(resolve, 2500))
])`,
			awaitPromise: true,
			returnByValue: true
		})
		const semanticResult = await cdp.command("Runtime.evaluate", {
			expression: semanticExpression,
			returnByValue: true
		})
		const screenshot = await cdp.command("Page.captureScreenshot", {
			format: "png",
			fromSurface: true,
			captureBeyondViewport: false
		})

		await mkdir(output, { recursive: true })
		const imagePath = `${output}/source.png`
		const semanticPath = `${output}/source-semantics.json`
		const metadataPath = `${output}/source-meta.json`
		await writeFile(imagePath, Buffer.from(screenshot.data, "base64"))
		await writeFile(semanticPath, JSON.stringify(semanticResult.result.value, null, 2) + "\n")
		const osBuild = Bun.spawnSync(["sw_vers", "-buildVersion"]).stdout.toString().trim()
		const metadata = {
			lane: "source",
			revision: manifest.source.revision,
			osBuild,
			captureMethod: "CDP.Page.captureScreenshot",
			clock: manifest.clock,
			route: manifest.route,
			logicalWidth: capture.logicalWidth,
			logicalHeight: capture.logicalHeight,
			pixelWidth: capture.pixelWidth,
			pixelHeight: capture.pixelHeight,
			deviceScaleFactor: capture.deviceScaleFactor,
			boundary: capture.boundary,
			cdpBrowser: (await fetch("http://127.0.0.1:9222/json/version").then((response) => response.json())).Browser
		}
		await writeFile(metadataPath, JSON.stringify(metadata, null, 2) + "\n")
		console.log(JSON.stringify({ imagePath, semanticPath, metadataPath }))
	} finally {
		cdp.close()
	}
}

if (import.meta.main) await main()
