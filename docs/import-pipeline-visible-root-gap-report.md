# Visible-root capture to native gap report

Evidence revision: `fd63a75dad3d0e8555ba22a47e720d285889fbf0` at 1200x800 logical pixels.
Candidate: consumer commit `5b18c84`, Burl commit `e95f3f79`.

This report describes the source-observed pipeline, not hand-tuned Palot code.
The current candidate is useful diagnostic output and is not a parity candidate.

## Mechanical inventory

| Surface | Source capture | Native DesignIR | Result |
|---|---:|---:|---|
| Semantic DOM nodes | 955 | 284 | 671 nodes consolidated or dropped |
| Non-whitespace ordered text items | 105 | 48 text nodes with content | Text is now visible, but accounting is not one-to-one |
| SVG roots | 54 | 52 faithful SVG documents + 2 named exclusions | Resolved with strict accounting |
| Image roots | 2 | 2 image nodes | Structurally preserved |
| Required application actions | 7 | 7 attached endpoints | Contract gate passes |
| Source viewport observations | 1 | 1 | Responsive constraints cannot be inferred |

The seven empty native text nodes are source spans with no captured direct text:
one online-status dot, one grouped counter span, one Build toolbar grouping, one
metadata grouping, and three diff-stat grouping spans. They are not counted as
lost text. Their visible descendants were consolidated into parent labels where
available.

## Property routing audit

| Source property family | Import route | Current result |
|---|---|---|
| display, flex direction/grow/shrink/basis/wrap, alignment, gap | observed DOM -> typed layout -> native layout | Routed; only one viewport is observed |
| width/height | observed geometry -> fixed native size | Routed; full-viewport shell chain is now lowered to fill |
| min/max sizes and absolute offsets | typed layout -> native style | Routed for numeric pixels; percentage/calc constraints are not reconstructed |
| padding/margin | typed layout -> native layout | Routed for numeric pixels |
| color/background/border/radius/opacity/shadow | typed paint -> native style/VisualSkin | Routed; screenshot still shows default-looking outlined empty controls, requiring per-node paint provenance comparison |
| gradients | typed paint background gradient | Routed when parser accepts the CSS gradient |
| transform/filter/backdrop-filter | observed diagnostics | Not rendered by this candidate; glass/filter ownership remains unresolved |
| font family/weight/style/size/line height/spacing/alignment | font inventory + native text style | Routed; four exact CoreText platform-face contracts, zero font errors |
| direct DOM text | ordered content -> Label content | Fixed by Burl `9fb0353d`, `a17aeb57`, `e34ffd24`, `d5a0a95a` |
| inline SVG and icon paths | captured `outerHtml` -> inline SVG projection -> SkSVGDOM | 52 resolved; two malformed source SVGs explicitly excluded because sibling text carries the same chevron |
| pseudo-elements | capture ordered paint content | Not proven in the full-screen generated IR |
| hover/active/focus/selected/disabled | state styles -> VisualSkin states | Component fixtures exist; full-screen capture currently contains only resting-state semantics |
| accessible name/role | semantic attributes -> native accessibility | Roles route; accessible names are incomplete because many icon buttons rely on source tooltip semantics not captured as ARIA |
| viewport/media/container queries | multi-viewport observations + constraint reconciliation | **Missing: only 1200x800 captured** |

## Focused blocking fixtures

1. `New Session` direct block text: formerly generated a geometry-only node.
   Covered by the framework `observed-dom.test.ts` direct-text fixture and now passes.
2. Stop timer composite SVG plus text: covered by framework attributed-text and
   inline-SVG tests. The full generator now requires every captured SVG to
   resolve or carry a named source-owned exclusion.
3. Responsive shell: consumer host test proves fill at 760x520, 980x680, and
   1200x800. Live `/tmp/palot-resize-760.png` proves descendant reflow still
   clips horizontally, so root fill alone is insufficient.
4. Full-screen visual fixture: `/tmp/palot-imported-fresh.png` proves text and
   hierarchy render, while missing icons and empty outlined controls remain obvious.

## Required next gates

- Capture at minimum 760x520, 980x680, and 1200x800 from the source application;
  reconcile stable flex/min/max/breakpoint constraints and reject contradictions.
- Join every source node/property/state to its IR field, materializer route, and
  screenshot-region evidence. No source property may disappear without a named diagnostic.
- Capture tooltip-derived accessible names for icon-only controls or fail their
  accessibility gate.
- Re-run the 11 visual scenarios only after these mechanical blockers close.
