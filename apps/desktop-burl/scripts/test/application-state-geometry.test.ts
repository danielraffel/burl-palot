import { describe, expect, test } from "bun:test"
import { normalizeCollapsedLeadingPaneGeometry } from "../application-state-geometry"

const hiddenLeadingPane = { x: 0, y: 0, width: 0, height: 800 }

describe("collapsed leading-pane geometry", () => {
	test("preserves a measured leading inset with zero trailing gutter", () => {
		expect(
			normalizeCollapsedLeadingPaneGeometry(1200, hiddenLeadingPane, {
				x: 12,
				y: 0,
				width: 1188,
				height: 800,
			}),
		).toEqual({
			viewportWidth: 1200,
			leadingInset: 12,
			trailingInset: 0,
			width: 1188,
			right: 1200,
		})
	})

	test("preserves independently measured symmetric gutters", () => {
		expect(
			normalizeCollapsedLeadingPaneGeometry(1200, hiddenLeadingPane, {
				x: 12,
				y: 0,
				width: 1176,
				height: 800,
			}),
		).toEqual({
			viewportWidth: 1200,
			leadingInset: 12,
			trailingInset: 12,
			width: 1176,
			right: 1188,
		})
	})

	test("fails closed for a mislabeled expanded state or impossible right edge", () => {
		expect(() =>
			normalizeCollapsedLeadingPaneGeometry(
				1200,
				{ x: 0, y: 0, width: 280, height: 800 },
				{ x: 280, y: 0, width: 920, height: 800 },
			),
		).toThrow("collapsed leading pane still occupies layout width")
		expect(() =>
			normalizeCollapsedLeadingPaneGeometry(1200, hiddenLeadingPane, {
				x: 12,
				y: 0,
				width: 1200,
				height: 800,
			}),
		).toThrow("extends beyond the viewport")
	})
})
