# RED: top bar, sidebar, composer, and control-state parity

Date: 2026-07-13
Verdict: `needs_work: foundation/state projection and responsive geometry remain incorrect`

This audit compares the current native capture at 1200x800 and 280x800 with the Electron oracle. It is deliberately limited to reusable region, measurement, and state contracts. It does not propose Palot-specific paint coordinates.

## Priority findings

### P0 — Routed actions do not produce imported visual state

The native interaction census proves that many semantic controls are hit-tested and routed, but it does not prove that the imported tree changes. The sidebar action currently flips a consumer boolean and requests repaint; the imported root receives no corresponding `sidebar.open` state update. The model-menu action follows the same pattern. This is why a control can be technically clickable while appearing inert.

The import/runtime gate must require all five links: semantic hit target, action dispatch, state transition, imported-tree mutation, and a fresh post-action screenshot/layout receipt. Action dispatch alone cannot count as feature parity.

### P0 — The desktop imported root is 12 points short on two edges

At 1200x800, Electron's main region is `(280, 0, 920, 800)` and reaches `(1200, 800)`. Native is `(280, 0, 908, 788)` and reaches `(1188, 788)`. This single root-sizing failure shifts the composer, status button, footer, and bottom panel edge approximately 12 points up and left, producing the visible empty right/bottom gap.

This belongs in the generic viewport-to-root sizing contract: the imported root must consume the full logical content size on every resize, and percent/flex descendants must be recomputed from the new containing block.

### P0 — Collapsed-sidebar parity is unproven

The fixed expanded toggle slot is correct in both renderers: `(93, 8, 28, 28)`. However, no native post-click collapsed screenshot/layout receipt exists. Worse, the stored Electron collapsed screenshot visually removes the sidebar while its paired JSON still reports the expanded main rectangle `(280, 0, 920, 800)`. That capture pair is internally inconsistent and cannot freeze an exact collapsed title bound.

The collapsed gate remains RED until a fresh, mutually consistent source pair and a native post-click pair prove:

- the toggle remains at `(93, 8, 28, 28)`;
- the reserved toolbar slot is never reused by breadcrumbs or title;
- visible title/breadcrumb rectangles have zero intersection with the toggle;
- the main region reflows from the actual collapsed state rather than repainting the expanded tree.

### P1 — Composer/footer anchors and text metrics are wrong

| Region | Electron | Native current | Result |
|---|---:|---:|---|
| Composer outer | `(296, 647.5, 887, 112)` | `(296, 636, 875, 112)` | 12pt short/right; 11.5pt high |
| Composer footer | `(296, 759.5, 887, 24.5)` | `(296, 748, 875, 24)` | bottom 12pt high |
| Status button | `(1091.234, 722.5, 80.766, 24)` | `(1079, 711, 81, 24)` | size matches; anchor fails |
| Model allocation | 18pt text row | 18pt node, 36pt measured text | measurement/paint contradiction |

At 280px, native measures the model label as 54pt/three lines, while the Electron screenshot uses two lines. This must be solved through generic intrinsic sizing, wrapping, and responsive flex rules. It must not be solved with a Palot-only coordinate override.

### P1 — `esc` is not materialized with the source inline-box model

Electron's footer ink bottoms are `782`, `781.75`, and `782` for Local, `esc`, and interrupt: a 0.25pt spread. Native reports `773`, `766`, and `773`: a 7pt spread even before accounting for the overall 12pt root shift.

Electron's `esc` is a KBD inline box `(359.8125, 767.75, 28.0625, 16)` with text inset by 5pt horizontally and 2pt vertically. Native materializes it as a label whose text starts at the node origin. The reusable fix is typed inline-box materialization with border, padding, line-height, and baseline participation—not a footer-specific y-offset.

### P1 — Responsive content-grid parity still fails

The 280px native root correctly preserves the 12pt outer gutter, but the raster still shows response content obscured by the composer and the controls wrap differently from the Electron source. Conversation content, tool cards, composer, footer, and scrollbar clearance need one shared responsive content-grid contract with explicit intrinsic minimums and non-overlap assertions.

### P2 — Top-bar text metrics remain visibly off

Electron's breadcrumb/title ink is `y=15`, `h=15`, bottom `30`; native measures `y=16`, `h=13`, bottom `29`. The expanded horizontal positions are close, so this is a font metrics/baseline issue rather than a hard-coded placement issue. Validate the bundled font face, weight, shaping metrics, and shared baseline alignment with adjacent icons.

## Exact reusable gates

The machine-readable contract is [contracts/topbar-sidebar-composer-regions.v1.json](contracts/topbar-sidebar-composer-regions.v1.json). A future capture is green only when:

1. the desktop root reaches the viewport right and bottom edges;
2. the sidebar toggle keeps its fixed slot in expanded, collapsed, and responsive states;
3. a click receipt is paired with the expected imported-tree and screenshot mutation;
4. composer/right/bottom anchors match the source at the same viewport;
5. measured text fits allocated nodes and matches source line counts;
6. Local/KBD/interrupt share the source visual baseline;
7. status-button size, radius, state skin, and anchor all match;
8. narrow layouts preserve a shared non-overlapping content grid.

## Evidence integrity note

Temporary `/tmp` paths in the contract identify the exact current audit inputs but are not durable release evidence. Before claiming the gate green, copy fresh source/native captures into a timestamped repository evidence bundle with provenance and freshness manifests. The inconsistent stored collapsed-source pair must be replaced, not reused.
