#!/usr/bin/env bun
import { access, readFile } from "node:fs/promises"
import { resolve } from "node:path"

const manifestIndex = process.argv.indexOf("--manifest")
if (manifestIndex < 0 || !process.argv[manifestIndex + 1])
	throw new Error("usage: verify-application-state-evidence.ts --manifest manifest.json")

const manifest = JSON.parse(await readFile(resolve(process.argv[manifestIndex + 1]), "utf8"))
const evidence = JSON.parse(await readFile(resolve(manifest.output, "interactions.json"), "utf8"))
if (evidence.policy?.sourceRevision !== manifest.sourceRevision)
	throw new Error("interaction evidence source revision does not match manifest")
if (!evidence.policy?.viewport || ["width", "height", "deviceScaleFactor"]
	.some((key) => evidence.policy.viewport[key] !== manifest.viewport[key]))
	throw new Error("interaction evidence viewport does not match manifest")

const assertCapture = async (capture: any) => {
	if (!capture) return
	for (const name of ["source.json", "source.png", "meta.json"])
		await access(resolve(capture.output, name))
	const source = JSON.parse(await readFile(resolve(capture.output, "source.json"), "utf8"))
	const interactionCohort = evidence.policy?.cohortSha256
	const sourceCohort = source.policy?.cohortSha256
	if ((evidence.policy?.runtimeState !== undefined && !interactionCohort) ||
		(source.policy?.runtimeState !== undefined && !sourceCohort))
		throw new Error(`${capture.state}: runtime state evidence has no capture cohort hash`)
	if ((interactionCohort !== undefined || sourceCohort !== undefined) && interactionCohort !== sourceCohort)
		throw new Error(`${capture.state}: structural state capture crosses interaction capture cohort`)
}
await assertCapture(manifest.initialStateCapture)

for (let index = 0; index < manifest.scenarios.length; ++index) {
	const expected = manifest.scenarios[index]
	const actual = evidence.scenarios[index]
	if (!actual || actual.id !== expected.id) throw new Error(`${expected.id}: scenario evidence is missing`)
	if (expected.action.target && ["pointer", "hover"].includes(expected.action.type)) {
		const target = actual.target
		if (!target || target.width <= 0 || target.height <= 0)
			throw new Error(`${expected.id}: target has no positive coordinate hit rectangle`)
		if (target.x + target.width <= 0 || target.y + target.height <= 0 ||
			target.x >= manifest.viewport.width || target.y >= manifest.viewport.height)
			throw new Error(`${expected.id}: target is outside the captured viewport`)
	}
	const eventTypes = (actual.events ?? []).map((event: any) => event.type)
	if (expected.action.type === "focus" && !eventTypes.includes("focusin"))
		throw new Error(`${expected.id}: programmatic focus did not produce focusin`)
	if (expected.action.type === "pointer") {
		const down = eventTypes.indexOf("pointerdown")
		const up = eventTypes.indexOf("pointerup")
		const click = eventTypes.indexOf("click")
		if (down < 0 || up <= down || click <= up)
			throw new Error(`${expected.id}: coordinate pointer sequence did not dispatch down, up, click in order`)
		if (!(actual.events ?? []).filter((event: any) => ["pointerdown", "pointerup", "click"].includes(event.type))
			.every((event: any) => event.isTrusted === true))
			throw new Error(`${expected.id}: coordinate pointer sequence is not browser-trusted`)
	}
	if (expected.action.type === "hover" && !eventTypes.some((type: string) => type === "pointerover" || type === "pointerenter"))
		throw new Error(`${expected.id}: coordinate hover did not enter the target`)
	await assertCapture(expected.stateCapture)
}

console.log(`${manifest.scenarios.length} coordinate/state scenario(s) verified from ${manifest.output}`)
