export interface InteractionReceiptResult {
	pointer: boolean
	keyboard: boolean
}

interface CapturedInteractionEvidence {
	scenarios?: any[]
	records?: any[]
	[key: string]: unknown
}

// State-transition captures retain their event stream beside the structural
// snapshot that the action produced. Normalize that losslessly into the same
// scenario contract used by the framework interaction capture. The action ID
// must be explicit capture metadata: labels and selectors are not identities.
export const normalizeCapturedApplicationStateInteractionEvidence =
	(evidence: CapturedInteractionEvidence): CapturedInteractionEvidence & { scenarios: any[] } => {
		if (Array.isArray(evidence.scenarios)) return { ...evidence, scenarios: evidence.scenarios }
		const scenarios = (evidence.records ?? [])
			.filter((record) => record?.action)
			.map((record, index) => ({
				id: record.id ?? `captured-interaction-${index}`,
				action: record.action,
				...(record.binding ? { binding: record.binding } : {}),
				events: (record.targetObservation?.events ?? []).filter((event: any) =>
					event?.intendedTargetInComposedPath !== false),
				target: record.targetObservation,
			}))
		return { ...evidence, scenarios }
	}

export const verifyTrustedInteractionReceipt = (scenario: any): InteractionReceiptResult => {
	const events = (scenario.events ?? []).filter((event: any) => event.isTrusted === true)
	const sequence = events.map((event: any) => event.type)
	if (scenario.action?.type === "pointer") {
		const down = sequence.indexOf("pointerdown")
		const up = sequence.indexOf("pointerup")
		const click = sequence.indexOf("click")
		if (!(down >= 0 && up > down && click > up))
			throw new Error(`pointer scenario lacks trusted activation receipt: ${scenario.id}`)
		return { pointer: true, keyboard: false }
	}
	if (scenario.action?.type === "hover") {
		const over = sequence.indexOf("pointerover")
		const enter = sequence.indexOf("pointerenter")
		if (!(over >= 0 && enter > over))
			throw new Error(`hover scenario lacks trusted pointer-entry receipt: ${scenario.id}`)
		return { pointer: true, keyboard: false }
	}
	if (scenario.action?.type === "key") {
		const down = sequence.indexOf("keydown")
		const up = sequence.indexOf("keyup")
		if (!(down >= 0 && up > down))
			throw new Error(`keyboard scenario lacks trusted activation receipt: ${scenario.id}`)
		return { pointer: false, keyboard: true }
	}
	return { pointer: false, keyboard: false }
}
