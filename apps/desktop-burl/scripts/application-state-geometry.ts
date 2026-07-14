export interface ApplicationStateRect {
	x: number
	y: number
	width: number
	height: number
}

export interface CollapsedLeadingPaneGeometry {
	viewportWidth: number
	leadingInset: number
	trailingInset: number
	width: number
	right: number
}

const epsilon = 0.001

function requireFinite(label: string, value: number): void {
	if (!Number.isFinite(value)) throw new Error(`${label} must be finite`)
}

export function normalizeCollapsedLeadingPaneGeometry(
	viewportWidth: number,
	leadingPane: ApplicationStateRect,
	survivingPane: ApplicationStateRect,
): CollapsedLeadingPaneGeometry {
	requireFinite("viewport width", viewportWidth)
	for (const [label, value] of [
		["leading pane x", leadingPane.x],
		["leading pane width", leadingPane.width],
		["surviving pane x", survivingPane.x],
		["surviving pane width", survivingPane.width],
	] as const)
		requireFinite(label, value)
	if (viewportWidth <= 0) throw new Error("viewport width must be positive")
	if (Math.abs(leadingPane.width) > epsilon)
		throw new Error("collapsed leading pane still occupies layout width")
	if (survivingPane.x < -epsilon || survivingPane.width <= 0)
		throw new Error("collapsed surviving pane has invalid measured geometry")
	const right = survivingPane.x + survivingPane.width
	if (right > viewportWidth + epsilon)
		throw new Error("collapsed surviving pane extends beyond the viewport")
	const trailingInset = viewportWidth - right
	if (trailingInset < -epsilon)
		throw new Error("collapsed surviving pane has a negative trailing inset")
	return {
		viewportWidth,
		leadingInset: survivingPane.x,
		trailingInset: Math.abs(trailingInset) <= epsilon ? 0 : trailingInset,
		width: survivingPane.width,
		right,
	}
}
