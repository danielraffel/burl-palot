# Palot source-to-native visual parity

Reference: the unmodified Palot source at `fd63a75dad3d0e8555ba22a47e720d285889fbf0`, built with Bun/Electron and opened on its deterministic `?mock=1` dark-mode session fixture. Both reference and native captures use a 1200 x 800 logical viewport and 2400 x 1600 Retina pixels.

## Substantially closed structural gaps

1. The native shell now uses the source's 280 px sidebar and 46 px app bar.
2. Window controls, wordmark, breadcrumb, session title, and right-side status metrics occupy the same header bands.
3. Sidebar information architecture matches New Session, Automations, Active Now, Recent, Projects, machine, and Settings sections.
4. The transcript is centered in the same 896 px maximum-width column.
5. Assistant messages are unboxed; only user messages use the right-aligned 95% secondary bubble.
6. Dynamic rows now retain authored percentage width, max-width, and auto-margin semantics through resize; cumulative turn spacing remains open below.
7. The composer matches the source's position, dimensions, 12 px radius, border, placeholder, toolbar, and status pill.
8. Burl's neutral Markdown API now permits the source-equivalent 13 px, weight-300 Inter body treatment while preserving inline emphasis and code semantics.
9. Sidebar and surface colors use the measured opaque dark-source palette instead of the prior navy application mock.
10. The native capture remains C++/Yoga/Skia Graphite/Dawn/Metal; no WebView or Chromium code was introduced.
11. A deterministic screenshot harness now emits normalized inputs, montage, heatmap, overlay, hashes, MAE, RMSE, PSNR, SSIM, and changed-pixel counts for every pass.

## Current measured pass

Pass 28 uses the immutable source capture from the detached reference worktree and the native GPU back buffer at identical 1200 x 800 logical / 2400 x 1600 physical dimensions. The comparison artifacts are `/tmp/palot-compare-28-2x/` pending promotion into the durable evidence set. The result is SSIM `0.288865472`, MAE `12.205034`, and `6.778750%` pixels above the 16-channel threshold. This improves on pass 09's SSIM `0.258545926`, MAE `14.048430`, and `7.344844%` changed pixels.

The temporary deterministic axis-fluid candidate was also rendered through the
live Metal/Dawn/Skia app path at the same 1200 x 800 logical / 2400 x 1600
physical dimensions and compared to the newly isolated source cohort. It reaches
SSIM `0.308158079`, MAE `9.995300`, and `6.197057%` pixels above threshold. The
candidate visibly fixes the outer status control's pill shape and the 12 px
parent right/bottom displacement, but it is not promotable: its application-state
reflow gate is still RED and typography/tool-card/content styling remains visibly
different. Temporary artifacts are
`/tmp/palot-axis-fluid-native-1200x800.png` and
`/tmp/palot-axis-fluid-compare/`.

The same build was also captured at the formerly inferred 280 x 248 minimum and at a new 1200 x 1000 tall viewport. Integrator review rejected 280 x 248 because composer descendants and the footer were clipped even though the outer composer rectangle stayed inside the host. Fresh Electron evidence establishes a 280 x 420 source content minimum; the native window contract uses 280 x 421 to absorb AppKit rounding. The tall transcript and composer must expand to the new window edges rather than retaining a fixed frame or cropping. Authored `width:100%`, percentage max-width, and `margin-left:auto` now outrank inferred pixel rectangles in Burl's generic responsive runtime. Full-template Markdown materialization preserves parent-owned chrome while excluding nested collection-template samples.

The hardened real-AppKit interaction census distinguishes routing from source-state coverage. All bound controls route coordinate pointer down/up and invoke their native action. The protected source-state candidate now includes exact closed/open evidence for `Thought`, `Read`, `Edit`, `View in diff panel`, the four composer selectors, inline title editing, and the external-open menu. The current canonical/native census remains intentionally unchanged until the root integrator promotes the reviewed candidate and proves those transitions through native coordinate execution.

The durable combined generated-v3/v4 source inventory now covers 219 target records across 60 captured states: 25 carry captured action bindings, 20 are native-editable, 23 are native-local/static, 116 remain observable actions without capture, and 35 remain stateful targets without a complete capture/action contract. The protected normalized composition at `/private/tmp/palot-composed-application-state-candidate.json` is deliberately unpromoted; its verifier preserves 544 motion receipts, 360 responsive records, 21 trusted pointer receipts, 2 trusted keyboard receipts, and 19 exact action-to-state contracts across 16 source-state dimensions. A separate public-contract gate reconciles 17 stateful contracts to the existing application binding names and rejects duplicate Palot-only action vocabularies. Fresh source geometry proves that the expanded desktop main pane is `(x=280,width=920)` and the collapsed main pane must consume the remaining width with the source-authored leading gutter; canonical promotion and native action-driven geometry remain separate gates.

## Pass 28 eleven-gap queue

1. Cumulative transcript advance remains roughly 80 px short by the second user turn, which lets its bubble peek above the composer while the source keeps it below the clipped viewport.
2. Markdown block rhythm is improved by captured 16 px block spacing, but ordered-list/paragraph role geometry and line boxes still do not fully match source flow.
3. Tool-row left borders lack the source's continuous rounded caps; the current indicator paints as a short straight segment.
4. Tool-row chevrons/icons and inline gaps change the subject text start and truncation budget by several pixels.
5. Thought/reasoning chrome retains a horizontal offset mismatch because static icon and container spacing are not yet treated as one atomic composite.
6. Sidebar header/footer labels still truncate despite available width, while session-row truncation is correctly budgeted around its timestamp.
7. App-bar wordmark, separators, and metric icons retain small baseline/intrinsic-width differences even though their containing band now matches.
8. The active-session spinner needs a motion-trace and frame-sequence gate; a static screenshot cannot prove rotation.
9. Collapsible Thought/Read/Edit source states and exact transitions are now in the protected candidate; canonical promotion plus native coordinate screenshots remain required before this gap closes.
10. Composer selector openings, inline title editing, the external-open menu, Settings route, stable review loaded/close, usage popover open/focus/Escape-dismiss, and project-search tooltip now have source captures. Build-menu focus/Escape-dismiss is also source-verified; item selection/commit, Automations, and native overlay execution remain open.
11. Hover/pressed/focus variants, scrollbar styling, and deterministic transparent/liquid-glass compositing still need state-matched screenshot gates.

Pixel identity is not yet claimed. The queue remains open until each region passes its geometry, interaction, and visual oracle rather than merely improving the global score. Functional controls remain native widgets; static painting is limited to non-interactive chrome and fixture content.

The real native OpenCode path was separately exercised after the visual fixture and returned exactly `REAL VISUAL PARITY OK`.

## 2026-07-12 user-reported parity ledger

Every row below is a framework/import requirement. Consumer-only constants, manual source-ID switches, static painted controls, and canonical-IR hand edits do not close a row.

| ID | Observed failure | Foundation/import capability and required gate | Status |
|---|---|---|---|
| UX-01 | Duplicate traffic-light controls/title chrome | BrowserWindow-to-native window chrome contract; one real AppKit control set; screenshot gate | open |
| UX-02 | Sidebar/glass/background aesthetic differs | Platform window-effect service plus captured backgrounds, gradients, radii, borders, and poison-theme gate | in progress |
| UX-03 | Most labels, sidebar rows, top-bar icons/metrics, composer controls, and status action do not click | Captured semantic actions, manifest-driven bindings, hit regions, coordinate interaction census, and visible post-action state | AppKit down/up, actionable-ancestor routing, callback delivery, and the sidebar's visible open/closed postcondition now pass without coordinates. The context-menu trigger shell cohort now passes generic right-button native materializer execution, but its item actions remain RED because the source exposes no portable action IDs. Protected candidate promotion and remaining native overlay/action postconditions remain open |
| UX-04 | Window initially too large; vertical resize still crops the composer or leaves a bottom gap | Source window contract, evidence-derived minimum size, axis-correct responsive constraints, and live grow/shrink root-bounds test | Generic root-authority and axis-inference subgates pass. A fresh source-derived candidate now matches the compact 280 x 420 composer at `(12,210,267,186)` and footer at `(12,396,267,24)`, while preserving the 599 x 420 composer `(12,284,586,112)`. Canonical promotion, minimum-window enforcement, and live grow/shrink interaction proof remain open |
| UX-05 | Sidebar toggle overlaps the breadcrumb/title, removes the main left gutter, and collapsed state leaves a large unused strip at right | Persistent toolbar slot, captured expanded/collapsed application states, parent layout invalidation, full-width remaining-pane stretch, and shortcut/click/edge-geometry gates | fresh atomic source captures at 1200 x 800 prove expanded sidebar `(x=0,width=280)` with main `(x=280,width=920)` and collapsed sidebar `(x=0,width=0)` with main `(x=12,width=1188,right=1200)`. AppKit click now proves endpoint delivery plus descendant hide/restore through the generic imported-state runtime. Geometry still remains P0 until regenerated canonical native screenshots prove the exact source gutters and full-width reflow |
| UX-06 | Missing/misaligned icons and wrong font metrics; top-bar glyphs and the composer model/escape labels remain misaligned or wrap incorrectly | Inline-SVG normalization, exact platform-font receipt, substitution-as-failure, baseline/intrinsic-size screenshot gates | The generic native projection no longer rewrites authored `white-space: normal` to `nowrap` merely because one wide capture happened to occupy one line. The v31 280 x 420 proof wraps `Claude Opus 4.6` into the same two-line slot as Electron without icon overlap. Top-bar/escape baselines, canonical font promotion, and the full composer gate remain open |
| UX-07 | Sidebar header/footer text truncates despite available width | Intrinsic flex sizing, min-width/ellipsis budget, and section-specific geometry assertions | open |
| UX-08 | Active-session spinner is static | Imported motion semantics, frame ticking, motion trace, and multi-frame screenshot proof | live source receipt and isolated capture-to-native lowering verified; canonical promotion/app frame proof open |
| UX-09 | Chat panel bottom corners/border and outer gutters differ; collapsed layout loses its left gutter | Captured per-corner radius/border/overflow plus shared content-grid constraints | P0 in progress |
| UX-10 | Tall resize still leaves empty space below sidebar/chat, while short resize can crop the composer | Liquid-glass hosted-view synchronous resize propagation through AppKit, Metal, Burl root, and Yoga; axis-correct responsive constraints | Generic vertical inference, externally sized Yoga-root authority, and GPU/layout proofs pass. The latest candidate keeps the compact footer flush with the 420 px host bottom and retains medium/wide source geometry. Canonical app resize execution and promotion remain P0 open |
| UX-11 | Narrow layout loses gutters/scrollbar clearance and composer overlaps transcript; wide composer controls still wrap or misalign without pressure | Ancestor responsive-variant projection, compact toolbar breakpoints, reserved transcript viewport, and source-width cohort screenshots; native 280 x 800 layout proof is in `responsive-native-current/native-280x800.{png,layout.json}` | The import now preserves CSS-visible zero-height layout participants and derives their height from width-qualified vertical variants: the separator is `0 px` below 600 px and `12 px` from 600 px upward. At 280 x 420 this removes the prior 12 px overcount and exactly restores the source composer height/position. Model-row icon/text overlap and canonical responsive-state composition are still RED |
| UX-12 | Session metadata detaches and floats in canvas | Dynamic sample-height invalidation after nested template removal plus child-within-row/clipping regression | fixed; screenshot regression pending |
| UX-13 | Status action paints an unrounded rectangular outer shell around a rounded child; its action/icon parity is also unproved | One semantic interactive surface, per-state VisualSkin radius precedence, uniform/per-corner/percent-radius preservation, and pressed/click screenshots | The duplicate chrome is removed and the v31 compact screenshot paints one rounded pill, not a rectangular shell around a rounded child. Geometry is 81 x 24 versus the source's 80.766 x 24. Canonical resource promotion plus click and pressed-state proof remain P0 open |
| UX-14 | Message, tool cards, and composer do not share horizontal bounds | One responsive content-grid contract propagated through flattened collection templates; the generic Release regression exercises shared bounds across 280 x 420, 600 x 420, 1200 x 800, 1440 x 800, and 1440 x 900 | layout subgate passed; content-style parity open |
| UX-15 | Tool cards collapse distinct surfaces/text/accent colors into gray | Per-layer, per-state captured paint preservation for background, border, accent, icons, primary/secondary/path/timestamp/body text | in progress |
| UX-16 | Thought/Read/Edit disclosures are dead | Captured application-state variants, local transition table, disclosure semantics, and coordinate click screenshots | v31 real-coordinate AppKit census proves Read and Edit change GPU pixels at 599, 768, and 1200 px. Thought dispatches and transitions but remains visibly invariant because its repeated template binds only `reasoning.label`; source-owned `reasoning.text` capture/binding and a changed-pixel rerun remain RED |
| UX-17 | Changes sidebar is missing | Captured closed/loading/loaded panel states, open/close actions, split-layout reflow, and coordinate screenshots | stable closed/open/closed-again review fixture and trusted pointer receipts pass source verification; native split reflow remains open |
| UX-18 | Usage breakdown and other contextual popovers/menus are missing | Generic overlay ownership, anchoring, stacking, dismissal, focus, and captured state variants | usage open/focused/Escape-dismiss and trusted outside-pointer dismissal are source-verified. Six context menus have trusted right-button open, pointer placement, focus entry, and Escape dismissal; generic materializer and production AppKit routing are GREEN. Exact menu visual parity is GREEN at MAE `0.011717` and edge diff `0.009199`. Context-menu item actions and focus restoration remain RED because the source proves neither; final canonical state promotion and model/variant/external selection remain open |
| UX-19 | Hover tooltips are missing | Tooltip semantics, hover delay, anchor placement, dismissal, accessible naming, and screenshot/interaction gates | terminal and project-search hover cohorts are captured under distinct state keys. The authored source delay is 0 ms, the atomic harness records trusted pointer-entry mount timing, and production AppKit coordinates prove native hover open/place/leave-close with GPU screenshots. The isolated same-pixel source/Skia visual gate is GREEN at MAE `0.078041` and edge diff `0.054245`; accessible naming and canonical Palot execution remain open |
| UX-20 | Settings route and its controls do not open/work | Route-level state capture plus native select, segmented control, toggle, navigation, persistence, and keyboard/accessibility gates | main/general route and dark/light control states have trusted pointer evidence; select/toggle/persistence/keyboard/native gates open |
| UX-21 | Keyboard input, selection, clipboard, IME, scrolling, accessibility require full demo proof | Native text/selection/IME/scroll/accessibility harness and end-to-end demo gate | open |
| UX-22 | Cancellation, retry, persistence, tool approval/basic tool calls require proof | OpenCode session-state integration and real streamed interaction gates | open |
| UX-23 | Broad Electron/Tauri/CSS compatibility must outlive Palot | Standards-seeded capability ledger, executable property reftests, explicit unsupported classifications, and held-out token-less/block-heavy app | open |

Current foundation fixes are not promoted merely because a focused test passes. Each row closes only after the final native app is rebuilt, launched, exercised, and compared with the corresponding Electron state at all relevant viewport sizes.

### Ordered execution roadmap

This is the dependency order for closing the ledger. A later stage may be
developed in parallel, but it may not be called complete while an earlier gate
is red.

1. **Deterministic resting tree:** compose captured source states without an
   unrelated portal, menu, tooltip, duplicate collection sample, or fallback
   theme leaking into the default frame. Preserve captured font receipts and
   exact authored paint in the same generated IR.
2. **Host-bound responsive layout:** prove the source minimum, 599 x 420,
   768 x 800, 1200 x 800, and 1200 x 1000 cohorts through the real AppKit host.
   Root, sidebar, transcript viewport, review rail, and composer must consume
   the host bounds; only the transcript viewport may absorb vertical pressure.
3. **Complete action/state routing:** census every visible action at compact,
   medium, and wide widths with native coordinate down/up, hover, right-click,
   keyboard, and focus delivery. A control closes only when its visible state
   transition or named native action is observed, not when it merely has a hit
   rectangle.
4. **Overlay and route semantics:** execute tooltips, usage details, menus,
   disclosures, Changes, Settings, inline title editing, focus trapping,
   Escape/outside dismissal, and focus restoration from captured contracts.
   Overlay ownership, anchors, stacking, and route identity stay generic in
   Burl/importer code.
5. **Region visual parity:** compare source and native top bar, sidebar,
   transcript/Markdown/tool cards, composer, status action, Settings, Changes,
   and every overlay at matched states and viewports. Typography, icons,
   baselines, radii, paint layers, truncation, and motion each retain a named
   oracle; global similarity cannot hide a failed region.
6. **Native editing and accessibility:** prove text input, selection,
   clipboard, IME, scroll anchoring, keyboard traversal, accessible names,
   roles, values, and actions in the production app.
7. **Real OpenCode product gate:** select a project, start/connect OpenCode,
   create/open a session, stream a real response, execute/approve a basic tool
   call, cancel, retry, persist, relaunch, and recover the transcript. Then run
   required traces/benchmarks/adversarial reviews, update the Burl-to-Pulp
   ledger, rebuild the standalone app, launch it, and recapture the final proof.

The current critical path is stages 1 through 4. The previous candidate is
explicitly rejected: its binding inventory was empty, but real AppKit
coordinates could not resolve `session.metrics.toggle` to an actionable view.
Inventory without coordinate execution is therefore a false green. A successor
composition contains 16 captured state dimensions, 19 reviewed transitions,
and 17 source-observed visual actions; it may advance only after the same
generated artifact passes coordinate action execution and visible-state proof.
The installed/canonical app therefore remains rejected even where an isolated
candidate looks better.

Integrator visual review subsequently rejected the narrow-layout definition of
"pass": `280x248-sidebar-open.png` keeps the main composer rectangle inside the
host but clips its footer/status row below the visible window. The census is
being strengthened to require every composer descendant and footer bound to be
visible and inside the host, and the minimum-window contract must be raised or
the source must prove a complete compact reflow. Until that stricter rerun is
green, the earlier 15/15 receipt is diagnostic evidence rather than an
acceptance result.

The integrator also ran the complete `@pulp/import-ir` package furnace rather
than accepting focused cohorts. It initially exposed five new tests bound to
the wrong runner and seven stale or real projection failures. The suite now
uses its declared Vitest runner, preserves supported linear `calc()` flex
basis and explicit `auto` semantics, keeps viewport-owned minimums out of the
native root, and no longer stretches or strips the authored size of
absolute/fixed children during block-to-column lowering. The full package is
GREEN at 82 test files / 429 tests, followed by a successful TypeScript and
ESM bundle build. The runtime capture front end now localizes remote IMG
resources into bounded, MIME-checked, SHA-256-addressed data evidence rather
than leaving a runtime network dependency. SVG images are sanitized through
the same native-safe canonicalizer used by inline SVG. This closes the generic
capture-format blocker exposed by provider logos in the model and variant
menus; promotion and real AppKit menu execution remain RED until the exact
source states are recaptured through that lane.

### 2026-07-13 production-coordinate layout-transition census

The Release-built native AppKit/Metal census is durable at
`evidence/visual-parity/native-layout-transition-census-current/receipt.json`,
with fifteen settled GPU screenshots beside it. It drives the canonical
imported tree with real AppKit mouse down/up events at 1200 x 800, the tall
1200 x 1000 cohort, and the source-window minimum 280 x 248 cohort. Discovery
uses imported slots, reviewed action identities, and application-state
variants rather than copied Palot coordinates.

The following subgates are **GREEN** in all three cohorts:

- native content, hosted view, and Burl root equal the requested host bounds;
- the main pane consumes the host's right and bottom edges in every recorded
  state, with no residual strip;
- the composer remains contained by the main pane and above the host bottom;
- both sidebar down/up transitions and both changes-panel down/up transitions
  reach the intended actionable ancestor and fire exactly one endpoint;
- the closed review rail remains pinned to the host's right and bottom edges.

The whole census remains **RED** with nine failed state records. At 1200 px,
collapsing the sidebar moves the app bar under the persistent toggle slot:
the app bar becomes `(0,0,1200,46)` while the toggle remains
`(93,8,28,28)`. The same overlap exists across every 280 x 248 state, where
the app bar begins at `x=12`. Also, applying the reviewed
`review.panel.open=open` state succeeds at the imported-state API but the
panel remains the closed 1 px rail at all three sizes, so the required split
layout is not produced. The screenshots additionally show an unrequested
composer-selector overlay already visible in the initial state; overlay
default-state isolation therefore remains RED. These failures are not waived
by the passing pointer receipts or edge geometry.

An unpromoted successor composition now closes those five layout cohorts at
the framework/import boundary. Its receipt is
`/private/tmp/palot-v17-census-rerun/receipt.json`, with fifteen AppKit/Metal
screenshots beside it. All sidebar open/closed/reopened and Changes
closed/open/reclosed records pass at 1200 x 800, 1200 x 1000, and 280 x 248.
The composition preserves authored ancestor-state padding, gives cloned state
portals unique materialization anchors, and strips invariant portal content
that was captured unchanged across unrelated states. The initial screenshot
therefore contains no composer-selector overlay. This does not repin or close
the canonical row: promotion still requires fresh overlay contracts and the
full production interaction gate. The current overlay candidate is stale
against this composition (its tooltip content source identity matches zero
nodes), so the production test exits at the tooltip postcondition before its
599/768/1200 action loop.

### 2026-07-13 atomic source-evidence additions

- **UX-20 Settings navigation:** the real Electron transition is preserved at `evidence/phase-b/source-interaction-states/generated-v5/navigation/settings/evidence.json`, with state artifacts under the adjacent `initial/`, `open-sidebar/`, and `activate-settings/` directories. It proves sidebar widths `0 -> 280`, an exact accessible target of `button`, role `button`, name `Settings`, and the post-click route `/settings/general`. The unpromoted contract is `evidence/phase-b/contract-candidates/settings-navigation.candidate.v1.json`; native coordinate execution and Settings-control behavior remain RED.
- **UX-18 usage popover:** the real Electron closed/open/toggle-dismiss transition is preserved at `evidence/phase-b/source-interaction-states/generated-v5/topbar/usage-popover/evidence.json`, with state artifacts under the adjacent `initial/`, `open-usage-popover/`, and `close-usage-popover/` directories. It proves `aria-expanded: false -> true -> false` and exactly one role-`dialog` popover while open. The contract is `evidence/phase-b/contract-candidates/usage-popover.candidate.v1.json`; generic materialization, production AppKit-coordinate execution, and exact source-versus-Skia visual proof are GREEN, while canonical Palot promotion remains RED.
- **Accessibility finding:** the captured usage trigger is an icon-only button with the exact accessible name `""`; its icon is source-authored as `aria-hidden`. This is a source defect, not an import target. Canonical promotion requires a reviewed non-empty accessible name. Focused mechanical coverage is in `tests/settings_and_usage_source_candidates.test.ts`.

### 2026-07-13 Settings and usage promotion-readiness audit

The machine-readable audit is
`evidence/phase-b/contract-candidates/settings-usage-promotion-readiness.audit.v1.json`.
It inspected the live Burl feasibility worktree at
`9e6afe117622fe74c9114785f5eadd09c1596ae0` and found no independently missing
generic primitive in this bounded lane. Burl already has exact application-action
binding, application-state transitions, anchored and edge-aware callouts, overlay
click routing, outside-click notification, focus trapping/restoration, Escape
dismissal, and explicit imported accessibility names, each with focused framework
tests. Duplicating those mechanisms would not make either candidate promotable.

Promotion remains **RED** for evidence and contract reasons:

1. The Settings target's observed action attribute is null. Its `Settings` label
   proves semantic target selection but is forbidden as an action-ID inference
   source. A reviewed immutable identifier plus native action/state execution is
   still required.
2. The generated-v5 usage candidate proves pointer open/toggle-dismiss only. Its
   focus-entry, focus-trap, focus-return, and Escape receipts must be attached from
   the broader source cohort or recaptured atomically before native keyboard proof.
3. The usage trigger's accessible name is the empty string. Promotion requires an
   explicit reviewed non-empty repair keyed by stable source identity. That repair
   may not become or imply the action identifier.
4. The usage overlay still needs a declared stable overlay host, reviewed state
   transition, and native anchor/stacking/inside-click/outside-dismiss execution.
   No Palot-specific coordinates belong in Burl.

Mechanical coverage is
`tests/settings_usage_promotion_readiness.test.ts`. It pins both null action IDs,
the separation between accessibility repair and action identity, the exact Burl
API/test references, the absence of consumer coordinates, and the RED promotion
decision.

### 2026-07-13 P0 acceptance matrix

These are not new one-off Palot exceptions. They are the current concrete failures that the generic importer/runtime gates must reject:

1. At every supported window height, the imported root, sidebar, and main panel bottom edges equal the host content bottom. The composer remains fully visible and bottom-pinned; only the transcript viewport absorbs vertical growth or shrinkage.
2. Closing the left sidebar invalidates parent layout. The main pane expands to the source-authored right gutter, retains its left gutter, and the reserved toolbar toggle slot cannot overlap the breadcrumb or title.
3. Every visible sidebar row, top-bar control, disclosure, selector, status action, and settings/navigation control has a non-empty hit region and a trusted pointer sequence produces the captured visible state or named native action.

The current 1200 x 800 region comparison is intentionally RED and recorded in `palot-font-receipt-native-5-region-review.md`. Top bar, composer, status action, and sidebar scores are respectively `0.7438`, `0.5877`, `0.5552`, and `0.5745`; all fail their parity gates. The source composer begins at `(296,647.5)` while the native composer begins at `(296,636)`, and the source status action begins at `(1091.234,722.5)` while native begins at `(1079,711)`. This isolates the leading defect as shared parent bottom/right anchoring rather than button-local dimensions and prevents cosmetic child offsets from being accepted as a fix.
4. Composer controls share one baseline and flex row at wide widths. The model label does not wrap while unused inline width exists; compact wrapping occurs only at a source-proven breakpoint. The `esc` label is centered in its captured outline.
5. Rounded controls paint and hit-test as one surface. A square parent behind a rounded child is a failure, even when the inner pixels resemble the source.
6. Every gate records Electron and native screenshots, layout rectangles, hit rectangles, and action/state evidence. Static similarity or callback counters alone cannot close these items.
7. A primitive or isolated-state proof cannot close a user-visible row. The canonical app must execute the real AppKit pointer/keyboard transition at the source-proven viewport, assert the resulting pane and control rectangles against the host bounds, and capture the post-action GPU frame. Sidebar and Changes transitions additionally fail when the main pane retains a stale width or leaves any unowned residual strip.

The latest integrator-run production action census remains RED despite 88
visible-control probes: the first 599 px run failed the real AppKit coordinate
dispatch for `session.title.edit.begin`. Composer focus passed at 599, 768, and
1200 px, and the other probes completed, but one missed action is sufficient to
reject the build. A subsequent census-only run did not reproduce the miss, so
this is classified as an intermittent routing/breakpoint defect rather than a
waiver; the harness now records press target, release target, actionable
ancestor, coordinates, and before/after outcome counters on every failure.

The unpromoted clean v3 composition subsequently passes that same production
census at 599, 768, and 1200 px: 87 visible controls, zero dead/obstructed hit
regions, zero action-dispatch failures, plus composer focus and wheel routing.
This includes `session.title.edit.begin` at 599 px. The result is necessary but
not sufficient for promotion: the project-search tooltip still opens without
its content and the usage trigger still fails the visible active-overlay
postcondition, so canonical UX-03/18/19 remain RED.

The full consumer test sweep is also intentionally RED on source provenance.
The working-tree `01-shell/source.png` and `source-semantics.json` no longer
match the immutable hashes in `source-components.v1.json`; none of the active
import/layout/overlay lanes authored or can attest those replacements. The
manifest remains pinned instead of silently blessing unknown pixels. Its two
component-reference tests therefore fail closed until the capture provenance
is reconstructed or an independently bracketed source recapture is reviewed.

### 2026-07-13 dynamic collection scrollport regression

The fresh responsive candidate exposed a zero-height virtual-list viewport: all
nine fixture rows measured successfully, but the mounted live collection kept
the removed source sample's intrinsic zero basis inside its captured vertical
scrollport. This is a framework-level collection-mount failure, not missing
Palot fixture data. Burl now promotes the live collection host and mounted
virtual list to the scrollport's available main-axis size while preserving the
captured host padding. The focused framework gate passes 7 assertions.

The production Skia/Dawn diagnostic at 1200 x 800 now renders the user,
reasoning, tool, assistant, and metadata rows and keeps the composer at the
bottom. The compact 280 x 420 frame keeps the composer fully contained. Exact
receipts are under `dynamic-scrollport-v32/`. The whole-app oracle remains RED:
SSIM is `0.350015027`, MAE is `9.323977`, and `5.966927%` of pixels exceed the
16-channel threshold. This restores missing content but does not waive the
remaining density, typography, tool-card, interaction, or state-layout gaps.

### 2026-07-13 canonical whole-app recapture regression

An integrator-run Release rebuild and production fixture capture at 1200 x 800
still fails the source oracle. The canonical frame unexpectedly contains an
open composer variant menu, a fourth tool row, aggressive sidebar/header
truncation, and materially different Markdown density. Against the atomic
Electron frame, the capture measures SSIM `0.355670781`, MAE `9.771385`, and
`7.488776%` of pixels over the 16-channel threshold. This result supersedes any
claim that isolated overlay/action coverage closes the visible application.
The canonical gate must begin from a deterministic closed-overlay state, assert
the source fixture row inventory, and then execute/capture each state transition
independently before visual metrics are accepted.

A fresh non-canonical regeneration now exercises the generic responsive
intrinsic-width inference rather than patching Palot labels. Source text whose
unellipsized fragment bounds exactly fit its captured box becomes content-sized;
text whose fragment bounds exceed the box remains constrained and ellipsized,
and explicit authored widths always win. In a temporary Release bundle this
restores full `New Session`, `Automations`, `This Mac`, and `Settings` labels
while retaining intentional session-title truncation. The temporary frame is
`/tmp/palot-intrinsic-v15-1200x800.png`, generated from
`/private/tmp/main-chat.intrinsic-width-v15.runtime-font-receipt.design-ir.v1.json`.
It remains RED at SSIM `0.351131547`, MAE `9.335653`, and `5.980286%` pixels
over threshold, so the descriptor is not promoted. The remaining differences
are whole-app composition, Markdown/tool-card style, header geometry, and
interactive state integration rather than permission to add consumer offsets.

The repository's calibrated region oracle confirms that this is a partial
foundation recovery, not parity: the top bar (`0.9728`) and full sidebar
(`0.9778`) pass their `0.90` gates, while the composer (`0.5979` versus `0.88`)
and status action (`0.7372` versus `0.90`) remain RED. The source and native
inputs are the exact 1200 x 800 files cited above; no resize or consumer crop
was used. Canonical promotion therefore remains blocked on the shared composer
grid/status surface and deterministic state composition.

### 2026-07-13 source-faithful overlay import gate

Tooltips, popovers, menus, and dialogs now have a reusable source-evidence
projection in Burl rather than a Palot coordinate path. The shared extractor
accepts a closed/open ObservedDOM cohort and its captured activation target. It
relates portal content only through explicit ARIA references or a matching
source `data-slot` trigger/content family. It does not use label equality,
screen coordinates, or nearest-neighbor geometry; unrelated and ambiguous
content fails closed. Focused framework coverage is
`packages/pulp-import-ir/test/overlay-contract.test.ts`.

The exact evidence/gate ledger is
`evidence/phase-b/contract-candidates/overlay-import-contract.audit.v1.json`,
mechanically checked by `tests/overlay_import_contract_audit.test.ts`.

**GREEN:**

1. The project-search source cohort proves a stable hover activation target and
   one newly mounted `tooltip-content` with source-observed bottom/center
   placement. The pinned source authors a zero-millisecond provider delay, and
   the atomic capture records trusted pointer entry plus renderer and host
   timing bounds.
2. The usage source cohort proves trusted Tab focus of the trigger, pointer-open
   from that exact stable source identity, a focused role-dialog, trusted Escape
   keydown/keyup, removal after Escape, and a separate trusted outside
   pointerdown/up/click sequence that removes the dialog and returns focus to
   the exact pre-open trigger identity.
3. The importer now applies the reviewed contract to stable trigger/content
   identities, projects it through native DesignIR attributes, and the generic
   native materializer consumes it without consumer coordinates. Focused native
   tests pass 27 assertions across hover-tooltip and click-popover cases,
   proving default-hidden content, hover/click activation, delayed-hover
   scheduling/cancellation, source side/alignment
   placement with root-edge clamping, active-overlay ownership, evidence-gated
   Escape/outside-pointer policy, focus entry, captured focus restoration,
   trigger-toggle dismissal, and hover-leave dismissal. Canonical Palot IR is
   not mutated.
4. The production hidden-NSWindow/CAMetalLayer harness passes 68 assertions in
   three overlay cases. AppKit mouse coordinates prove tooltip open/place/
   leave-close; AppKit Tab, click, and Escape prove popover focus entry,
   dismissal, and focus restoration. A source-authorized outside pointer closes
   the imported popover, restores trigger focus for a non-focusable click-through
   surface, while a contract without that authorization retains the overlay.
   Same-viewport native GPU frames and SHA-256 receipts are under
   `evidence/phase-b/native-overlay-appkit-v1/`.

5. Atomic generated-v9 source states now feed exact-node crops and native IR in
   `evidence/phase-b/native-overlay-visual-parity/generated-v8/`. Real Skia
   captures at identical pixel dimensions are under the adjacent
   `candidates-v11/` directory. The project-search tooltip passes tolerance-MAE
   `0.078041` and edge diff `0.054245`; the usage popover passes MAE `0.022785`
   and edge diff `0.016485`; the first-session context menu passes MAE
   `0.011717` and edge diff `0.009199`. All three have empty blocker and
   visual-gap lists.
   SSIM remains recorded as a diagnostic, but is not used as an uncalibrated
   blocker; the hardened gate uses the repository's established MAE and region
   edge-diff truth.
6. The visual closeout required reusable fixes rather than consumer offsets:
   computed grid-track capture and native projection, a nested custom-grid pass
   after Yoga, border-aware block-to-column geometry proof, observed
   parent-relative placement for absolute descendants, geometry-proven nowrap
   preservation, and exact CoreText system-alias receipt matching.

The source-to-importer-to-materializer overlay lane is GREEN. The canonical app
still needs to consume the protected state composition before UX-18 and UX-19
can close end to end. A Palot-only host, label match, or fixed coordinate remains
forbidden.

### 2026-07-13 consumer-boundary RED audit

The visible application is the imported DesignIR tree. The manually constructed
`PalotComposer`, `PalotChromeButton`, `MessageRow`, project/session/provider/model
editors, and transcript list are hidden siblings. Their custom paint and fixed
geometry are not accepted as UI fixes and must be removed after their remaining
transport/storage responsibilities move behind typed imported bindings.

The following are P0 functional blockers, not cleanup suggestions:

1. `prompt.send` currently receives visible imported composer text as its action
   payload, but the consumer ignores that payload and reads the hidden composer.
   A real request must prove that visible typed text is the transmitted prompt.
2. Hidden editors currently act as the project/session/provider/model domain
   store. Visible selections must update a plain runtime session model and the
   exact `OpenCodeRequest`; no hidden widget may remain authoritative.
3. Hidden and imported transcripts are updated independently. The hidden
   `VirtualList`, custom `MessageRow`, fixed row-height calculation, and duplicate
   projection must be deleted once persistence and transport use typed message
   data directly.
4. Boolean mirror tests do not prove UX. Server/search/command/title/metrics,
   composer menus, display mode, routes, and review/sidebar state close only when
   the imported tree visibly changes and the coordinate/screenshot gate passes.
5. Descriptor state transitions are the sole visual-state authority. Consumer
   callbacks may invoke native services or update domain data, but may not run a
   second UI state machine under mismatched keys such as `ui.presentation` versus
   `review.panel.open`.
6. Attachment, copy, selection, and tool actions close only when their semantic
   outcome is observed. A callback counter, repaint, or stored path with no
   request/clipboard effect remains RED.
7. Tool and persistence projection must preserve typed reasoning/tool/message
   templates across restart; mapping every unknown tool to Edit or storing only
   role/text is lossy and remains RED.

The migration order is: generic active imported text/data binding access; plain
consumer runtime-session data; exact transport wiring; composable captured UI
states; deletion of hidden widgets and fixed geometry; replacement of mirror
tests with visible geometry/state/transport evidence.

### 2026-07-13 599 x 420 transcript-card clipping audit

The deterministic source/native pair is
`/tmp/palot-canonical-height/599x420-deterministic/source.{png,json}` and
`/tmp/palot-axis-fluid-native-599x420.{png,layout.json}`. The Read/Edit cards
are **present but clipped**, not omitted, scrolled away, or misread from the
screenshot:

- Source user text is `(57.3047,66,524.6953,66)`. Its Read, first Edit, and
  second Edit row boxes begin at `y=206.75`, `259.5`, and `311.5`; their glyph
  boxes begin at `y=208.75`, `261.5`, and `313.5`. The source textarea begins
  at `y=284.5`, so Read is fully visible, the first Edit reaches the composer
  boundary, and the second Edit is below that boundary.
- Native user text is laid out as `(57,66,525,132)` even though its own
  measured-text receipt is exactly `66` px high. Read/Edit/Edit are present and
  visible at `y=286`, `339.5`, and `391.5`, but each has a clipping rectangle
  with height `0`. Their displacement from source is `+79.25`, `+80`, and
  `+80` px respectively. No scroll offset or missing-node evidence explains
  this; the upstream wrapped-text box consumes the transcript budget twice.
- The imported descriptor confirms the cause: at 599 px it selected a bounded
  `154` px vertical variant inferred from a narrower capture even though the
  599 px source text height is `66` px. Yoga shrank the imposed value to
  `132` px while Burl text measurement remained correct at `66` px.

The unmodified pair's screenshot oracle is RED: SSIM `0.337970717`, MAE
`12.785067`, RMSE `42.616963`, PSNR `15.539154 dB`, and `7.743958%` pixels
above the 16-channel threshold. Metrics and diff artifacts are in
`/tmp/palot-599x420-card-audit-original/`.

A generic importer fix now promotes a text box to intrinsic/hug height only
when a responsive capture cohort has at least three samples, the used height
changes by width but is stable at repeated equal widths, the captured glyph
bounds account for each box height, and no authored fixed height is present.
This avoids treating one screenshot's used pixels as either an authored height
or sufficient proof of intrinsic sizing. The focused height/responsive furnace
passes `32/32` tests. Regenerating the same source cohort in
`/tmp/palot-intrinsic-height-cohort-fixed.design-ir.json` produces
`heightMode:hug` with no vertical constraint. A temporary, non-canonical descriptor run makes
Read/Edit/Edit clips non-empty (`22` px each) at `y=220`, `273.5`, and `325.5`,
leaving a separate `13.25`-`14` px rhythm mismatch. That temporary run also
exposes an independent root/composer vertical-sizing regression and scores only
SSIM `0.098538882`, MAE `17.858782`, RMSE `52.161308`, PSNR `13.783834 dB`,
and `11.611714%` changed pixels. It is diagnostic evidence only and must not be
promoted. Its artifacts are
`/tmp/palot-canonical-intrinsic-fixed-599x420.{png,layout.json}` and
`/tmp/palot-599x420-card-audit-intrinsic/`.

### 2026-07-13 native interaction postcondition audit

The trusted AppKit harness disproves a blanket hit-testing failure. At 599,
768, and 1200 px widths, mapped sidebar, project, session, and composer controls
receive production mouse down/up routing through the same native window bridge
as the app; the actionable ancestor is the source-bound control and callback
counters advance. The original census was nevertheless too weak because a
counter does not prove the imported tree changed.

The first added postcondition exposed a framework-level state-domain defect.
The source sidebar state values are `open` and `closed`, while the runtime's
`toggle` implementation only changed `true` and `false`. The action endpoint
therefore fired and the transition function returned, but the
`visibilityByApplicationState` table had no matching value and the visible tree
remained unchanged. Burl now derives an unambiguous two-value toggle domain from
captured state variants and infers its current value from the active responsive
baseline at the live viewport. Inferred values track viewport changes until an
explicit set or user transition makes the state authoritative; conflicting or
multi-valued domains still fail closed.

Evidence after the generic fixes and routed-v8 promotion:

- `pulp-test-application-action-binding` passes 53 assertions, including a
  host-bound `toggle` over a non-boolean `open`/`closed` domain and state
  propagation from an application root into an independently materialized
  descendant runtime.
- The real AppKit harness clicks `sidebar.toggle`, observes its registered host
  endpoint, then proves a static sidebar descendant becomes unavailable; a
  second coordinate click restores it. No Palot coordinate or source-anchor
  switch is used by the gate.
- The Release census now reports 87 controls, zero dead controls, zero action
  dispatch failures, and zero unclassified gaps across 599, 768, and 1200 px.
  The remaining source-local controls are explicitly classified as eight
  native-local behaviors rather than silently omitted.
- Thought, Read, Edit, and View in diff panel retained their captured actions
  but previously lacked native route identity. The generic composer now
  projects a deterministic route ID whenever it promotes an application action
  onto existing native attributes; existing authored routes still win.
- The Palot interaction-state gate loads the dynamic transcript fixture and
  proves the disclosure actions visibly change and restore repeated-row content.
  It also proves the review/diff action opens the imported review state.

This audit closes the canonical action-census gap and the nested repeated-row
state-propagation defect. It does not by itself claim pixel identity or complete
all overlay, accessibility, keyboard, and per-state screenshot gates.

### 2026-07-13 composer status/action pill visual-skin audit

The rectangular status/action control is not a missing consumer-specific shape.
The source receipt proves one `80.765625 x 24` semantic button with a white face,
transparent one-pixel border, four `7.5` px corners, `6` px horizontal insets,
and a `14 x 14` current-color square icon. The focused importer output preserves
`visualSkin.states.rest.cornerRadius: 7.5`, and the focused native crop paints the
same single rounded pill.

The full canonical artifact is stale at this property boundary. Its
`prompt.cancel` node retains all four `7.5` px style longhands but omits the
promoted VisualSkin radius. Current Burl already contains the generic fixes: a
uniform computed-longhand radius projects into each captured control state;
materialization clears the base View background, gradient, and border so the
TextButton owns one chrome surface; and TextButton resolves the imported radius
per state, paints one rounded face, and suppresses a transparent imported
border. Focused importer and recording-canvas furnaces pass, so this audit adds
no Palot drawing or coordinates.

Whole-app parity remains **RED**. Regenerate the canonical full-tree IR, capture
durable hover/pressed/disabled source states, rebuild the app from the immutable
Burl revision, and prove source/native state crops plus recording-canvas output
have exactly one `7.5` px rounded face with no rectangular shell. A coordinate
click must also prove the `prompt.cancel` postcondition. The durable audit is
`evidence/phase-b/contract-candidates/composer-status-pill-visual-skin.audit.v1.json`.

### 2026-07-13 vertical root and composer containment audit

This audit found two independent foundation defects rather than a Palot
coordinate problem.

First, Burl created the Yoga root with the host bounds and then reapplied the
imported root style. An imported `height:100%` plus `min-height:800px` could
therefore override a 248 or 420 px native host and leave every descendant at the
captured 800 px height. The native host boundary is now authoritative: after the
imported subtree is built, the Yoga root receives equal width/min-width/max-width
and height/min-height/max-height values from the live host bounds. The generic
framework regression changes the host through 420, 800, and 900 px heights and
proves a fixed 112 px composer stays at the bottom while only the flexible
transcript absorbs the delta.

Second, the old responsive descriptor inferred vertical variants from a cohort
whose viewport heights were mostly constant while widths changed. It could not
distinguish a captured used height from a fixed authored height, so the terminal
wide segment froze the main pane at 788 px. Vertical equations now require a
same-width, multi-height slice. Width breakpoints can still select genuinely
authored fixed-height components, but a viewport-filling pane is not frozen from
width-only evidence. The focused importer furnace includes a 1440 x 900
regression and passes all 29 responsive-constraint tests.

Fresh deterministic source captures prove the intended postcondition directly:
the main pane is `248`, `420`, `800`, and `900` px high at matching viewport
heights, with no bottom inset. A temporary descriptor regenerated from those
captures has one vertical fill equation and no `verticalVariants` on the main
pane. It is intentionally not promoted to the canonical IR.

The disposable native app proof is under `/tmp/palot-vertical-proof/`:

- `native-1200x420.{png,layout.json}`: main `(280,0,920,420)`, composer
  `(296,268,887,112)`, textarea `(297,269,885,64)`.
- `native-1200x800.{png,layout.json}`: main `(280,0,920,800)`, composer
  `(296,648,887,112)`, textarea `(297,649,885,64)`.
- `native-1200x900.{png,layout.json}`: main `(280,0,920,900)`, composer
  `(296,748,887,112)`, textarea `(297,749,885,64)`.

The composer therefore moves by exactly the viewport-height delta, retains its
height, remains inside the main pane, and preserves the source's 40 px status
strip below it. The direct imported-root test also passes minimum containment at
280 x 248 and main-pane growth from 1440 x 800 to 1440 x 900. The production
AppKit harness reaches the same imported tree and still exits `14` on its honest,
unrelated interaction census: 12 visible controls in this temporary regenerated
descriptor have routing but no captured state/action/native-local contract.
That RED result is not a vertical-layout failure and is not waived here.

#### Compact-width intrinsic-height follow-up

The 280 px cohort exposed a third generic defect: the source separator is a
CSS-visible zero-height box with 8 px top and bottom margins. Treating every
zero-size observed box as hidden removed those margins; keeping it visible but
freezing its 600 px captured height added 12 px at compact widths. The importer
now distinguishes CSS visibility from geometry and can select vertical sizing
constraints at measured width boundaries. For this source the separator is
`fixed(0)` through 599 px and `fixed(12)` from 600 px upward while remaining
structurally visible in both bands.

The durable v30 source/native captures are under
`evidence/visual-parity/responsive-intrinsic-height-current/`:

- `palot-intrinsic-height-v30-native-280x420.{png,layout.json}`:
  composer `(12,210,267,186)`, textarea `(13,211,265,64)`, toolbar
  `(13,275,265,120)`, footer `(12,396,267,24)`.
- `palot-intrinsic-height-v30-native-599x420.{png,layout.json}`:
  composer `(12,284,586,112)`, footer `(12,396,586,24)`.
- `palot-intrinsic-height-v30-native-1200x420.{png,layout.json}`:
  composer `(296,268,887,112)`, footer `(296,380,887,24)`.

The responsive importer furnace passes 33 tests / 94 expectations, including
the new zero-size participant and width-qualified vertical-variant cases. The
Release native cascade furnace passes 14 assertions / 3 cases. This closes the
intrinsic-height subgate only. The compact screenshot still shows model-row
icon/text overlap and a missing dynamic transcript turn, so whole-app and
compact visual parity remain RED.

#### Responsive text-layout follow-up

The compact model selector was not a local icon offset. Native DesignIR had a
projection heuristic that converted `white-space: normal` into `nowrap` when a
single wide capture happened to fit on one line. That discarded the authored
CSS behavior needed when the same label became width-constrained. The
projection now preserves the captured CSS keyword. Responsive reconciliation
also carries changing `white-space`, `text-overflow`, `overflow-wrap`, and its
`word-wrap` alias as width/height-qualified style literals, and the native
runtime applies those literals reversibly to `Label`.

`responsive-intrinsic-height-current/palot-responsive-text-v31-native-280x420.png`
proves `Claude Opus 4.6` wraps into two centered lines without overlapping its
leading icon, while the composer remains `(12,210,267,186)` and bottom-pinned.
The TypeScript furnaces pass 43 tests / 124 expectations across responsive
reconciliation and NativeDesignIR projection. The C++ responsive text gate
passes 8 assertions and the existing cascade gate passes 14 assertions. This
does not waive the missing dynamic transcript turn in that diagnostic fixture,
the remaining `esc` baseline issue, or canonical font/resource promotion.

### 2026-07-13 source interaction completeness census

The interaction inventory is now grounded in a fresh atomic CDP screenshot and
ObservedDOM snapshot at
`evidence/visual-parity/source-interaction-completeness-current/`. The source
capture is bracketed by identical semantic hashes. Its visible main-chat cohort
contains exactly 49 controls: 2 shell, 22 sidebar, 9 top-bar, 8 conversation,
and 8 composer controls. Offscreen `1 x 1` form mirrors and controls outside the
captured viewport are excluded mechanically.

The old census was incomplete by construction: it admitted only semantic HTML
tags and ARIA control roles. The source actually attaches local React event
props to non-semantic controls. The generic capture and importer now admit those
listener-backed surfaces, record whether discovery came from semantic control,
direct listener, or React event prop, and preserve activate/hover/focus/input
modalities. Delegated listeners on body/root containers do not become false
controls without local affordance evidence. Focused framework and CDP tests are
GREEN.

Every one of the 49 source candidates has exactly one disposition in
`audit.v1.json` (enforced by
`tests/main_chat_interaction_completeness_audit.test.ts`):

- 7 imported transitions: sidebar toggle, project search, command palette,
  title editing, changes-panel toggle, the first Thought disclosure, and display
  mode. Thought is classified from an exact reversible source cohort, not its
  label or geometry; canonical Palot promotion remains RED.
- 23 native-local actions: shell/sidebar navigation, session/project primary
  actions, Settings, close/Open/terminal, Copy response, and composer
  submit/focus/cancel/attachment/text entry.
- 14 overlay contracts: six session-row context-menu trigger shells, This Mac,
  usage, time, cost, Open destination, and the agent/model/variant menus. This
  classification does not waive final canonical state promotion or the RED
  menu-item action and focus-restoration gates in the overlay audit.
- 5 missing current-state controls: Show 3 steps, the uncaptured second Thought
  disclosure, Scroll to top, Fork from here, and Undo from here.

The six context-menu triggers are newly visible evidence; the former tag-only
census silently omitted them even though the source has local activation props.
They now have a general six-trigger capture cohort at
`evidence/phase-b/source-interaction-states/context-menu-contract/generated-v2/`
and a typed audit at
`evidence/phase-b/contract-candidates/context-menu-import-contract.audit.v1.json`.
All six open from trusted right-button presses, anchor from the live pointer,
move focus into a role-`menu`, and close from trusted Escape. Burl's typed
overlay projection and native materializer execute that generic shell without
label or stored-coordinate switches. Production AppKit right-click and Escape
execution is GREEN with GPU receipts, and exact source-versus-Skia menu visual
parity is GREEN. The canonical consumer manifest now generates eight overlay
contracts with zero diagnostics, including all six menu shells. This is not
item-action completion: the 18 observed menu items expose zero portable action
IDs, focus restoration is not proven by the source capture, and final canonical
state promotion remains RED.

The source's tool-card cohort now has exact reversible contracts for Read and
Edit. Show 3 steps also has a trusted collapsed/expanded/collapsed-again cohort,
but it remains RED: the source remounts the trigger and exposes neither an
application action nor an explicit relationship from that trigger to the three
mounted tool cards. Stable source-path identity makes the evidence comparable;
it does not authorize guessing a portable state contract. The routed-v8
canonical descriptor now promotes the reviewed action contracts and explicitly
classifies source-local-only controls. Across 599, 768, and 1200 px, the Release
native harness reports zero missing observations, zero dead controls, and zero
action dispatch failures. The disclosure and review actions also have visible
native postconditions. This result comes from generic composer route projection
and subtree runtime propagation, without coordinate or label dispatch switches.

### 2026-07-13 reversible disclosure import contract

Thought, Read, Edit, and Show 3 steps now have standalone source cohorts under
`evidence/phase-b/source-interaction-states/disclosure-reversibility/`. Each
cohort records the same stable logical trigger path through closed, open, and
closed-again states; one trusted `pointerdown -> pointerup -> click` sequence
per transition; atomic pre/post frames; and a final PNG identical to the initial
PNG. Thought, Read, and Edit additionally carry exact
`aria-expanded: false -> true -> false` plus a visible nonzero content node
related by `aria-controls`. Show 3 steps proves composed-path delivery when the
event target is a child span, survives a React trigger remount, and mounts exactly
three tool-card triggers only while expanded. The 134-assertion consumer gate is
`tests/disclosure_reversibility_evidence.test.ts`.

Burl extracts a product-neutral disclosure contract only from source-local state
change with an explicit trigger/content relationship. Navigation and IPC effects
are rejected. Native promotion requires captured reversal and emits the stable
state key plus `cycle:closed,open`; no label, coordinate, or Palot command is used.
The TypeScript contract/projection gate passes 9 focused tests. The C++
materializer/runtime gate passes 43 assertions and proves two coordinate clicks
hide, show, then hide the controlled content. That proof also corrected a generic
responsive-state defect: state-only visibility now owns its branch, while real
viewport breakpoints remain hard outer visibility gates.

The source-evidence disposition remains recorded in
`source-interaction-completeness-current/audit.v1.json`; the promoted canonical
runtime census is separately recorded in
`native-interaction-census-current/settled-v8-release.log`. Context-menu shells
are contract-complete but their menu-item actions remain RED because the source
exposes no portable action IDs. Show steps is evidence-complete but
contract-incomplete:
without an authored action or explicit source relationship to its mounted
content, the importer refuses to invent one. Accessibility/keyboard disclosure
proof and source-versus-native open-state screenshots remain required.

### 2026-07-13 source-faithful dynamic Markdown roles

Dynamic transcript Markdown no longer derives its strong and inline-code skin
from Burl defaults or from a Palot constant. The runtime capture now probes a
real representative descendant for each semantic role and reproduces that
descendant's authored ancestor/class context in an offscreen clone before
reading computed style. This is necessary for token-less Tailwind/Electron
sources: a synthetic empty `strong` or `code` element does not participate in
the source's class-driven cascade. The capture remains generic and records a
loud conflict instead of averaging when multiple representatives disagree.

The fresh atomic Electron receipt and its reference frame are durable at
`markdown-role-import-current/source-role-receipt.json` and
`markdown-role-import-current/source-role-reference.png`. The exact receipt is:

- paragraph: source system stack, `15px`, weight `400`, white;
- strong: source system stack, `16px`, weight `700`, white;
- inline code: source monospace stack, `15px`, weight `600`, white,
  `rgb(40,40,40)` background, `4px` radius, and `6px 2px` horizontal/vertical
  padding;
- metadata: source system stack, `12.8px`, weight `400`, white.

Those values enter DesignIR as role attributes and flow through the same static
and dynamic Markdown materializers. The native runtime consumes role
typography, foreground/background, per-edge border evidence, radius, and
padding using the normal imported-skin precedence; no source value is compiled
into the framework. The representative-role CDP furnace passes 23 tests / 104
expectations, the focused attributed-text and receipt furnaces pass 13 tests,
and the Release C++ Markdown/materializer filters remain GREEN.

The 1200 x 800 Release Skia/Dawn proof is
`markdown-role-import-current/native-1200x800.png`, with exact geometry in
`native-1200x800.layout.json`. Strong spans and inline-code pills now preserve
the source hierarchy rather than rendering as one default gray style. Tool-card
outer bounds are also source-faithful: source `(296,192,887,39.5)`,
`(296,245.5,887,38)`, `(296,297.5,887,38)` versus native
`(296,194,887,40)`, `(296,248,887,38)`, `(296,302,887,38)`.

The same proof exposed and closed a generic nested-collection ownership defect.
An enclosing assistant template removed the tagged Read/Edit exemplars but
retained an untagged captured peer with the same repeated-source signature when
that peer contained an action. That produced a false fourth tool row. Template
extraction now removes all captured peers belonging to a nested repeated sample,
while retaining unrelated static action chrome; the focused Release regression
passes 4 assertions. The native layout now has exactly Read + Edit + Edit before
the response, matching the source.

Whole-app parity remains RED. The current shared application-state composition
also paints a `Default variant / Adaptive / Standard` state branch over the
upper-left frame and leaves an extra application-state Thought label; those are
not Markdown-role defects and remain assigned to atomic-state composition.

The separate Read-label defect is now closed generically at the text-metrics
boundary. Layout and paint can use compatible shapers whose advances land on
opposite sides of the same pixel-grid boundary; the source-like Read label had
a `36px` intrinsic box while the paint backend reported `36.587px`. Burl now
preserves the complete string for backend disagreement up to `0.75` logical
pixels, while true pressure of `1px` or more still takes the ordinary ellipsis
path. Paint and text-edit metrics share the rule, so caret/selection geometry
cannot diverge from the displayed string. The focused text-overflow furnace is
GREEN at 100 assertions / 16 cases, and the imported intrinsic-boundary
regression is GREEN at 6 assertions.

The refreshed native proof above paints `Read` in full and still contains
exactly Read + Edit + Edit. A fresh source/native tool-card crop is durable at
`markdown-role-import-current/tool-cards-read-label-v2/`; its comparator reports
MAE `2.689864`, `2.683824%` differing pixels, RMSE `14.68374`, and PSNR
`24.79407dB`. Whole-frame parity remains RED only for the separately owned
application-state branch/Thought overlay before a new whole-frame oracle result
is meaningful.

### 2026-07-13 complete chat-frame minimum-size correction

The earlier `280 x 248` layout-census result was a false green. It asserted the
form rectangle but omitted the form's sibling footer/status branch, so the
composer could pass while `Local / esc / interrupt / Default` was visibly cut
off below the AppKit host. The tracked source capture at that size exhibits the
same crop and is no longer accepted as a complete-chat-frame minimum.

The source window contract now uses `280 x 421`: the smallest canonical source
capture in the pinned responsive cohort that contains the full structural chat
frame is `280 x 420`, including its `24.5px` footer, and the projected contract
retains a one-logical-pixel boundary guard. Burl now preserves fractional Yoga
layout geometry rather than independently rounding a parent down and a child
up; a framework regression proves a `186px + 24.5px` source column ends exactly
at its `210.5px` parent boundary. The production Mac resize harness clamps
requested content dimensions to the NSWindow `contentMinSize`, matching a user
resize instead of bypassing the production minimum with an unconstrained
programmatic `setContentSize`.

The strengthened census discovers the frame and its accessory/footer branch
from DesignIR structure and captured positive geometry; it does not use Palot
labels or coordinates. It requires the complete frame and every positive,
visible footer descendant to remain inside the host. The strict-font v18
candidate passes all 15 AppKit state records. Its receipt is
`/private/tmp/palot-v18-strict-font-layout-census-v7/receipt.json`; `280 x 248`
is now a separate negative boundary probe that proves AppKit rejects the
request and hosts `280 x 421`, while the 15 production states exercise only
valid `1200 x 800`, `1200 x 1000`, and minimum `280 x 421` viewports.
The screenshot
`/private/tmp/palot-v18-strict-font-layout-census-v7/280x421-sidebar-open.png`
visibly contains the full footer.

The checked-in pre-v18 import still fails the collapsed-header non-overlap check
at 1200 x 800 and 1200 x 1000. That known candidate gap remains RED and must not
be hidden by the minimum-size correction or called whole-app green.

### 2026-07-13 imported action inventory and Settings navigation

The v18 production AppKit proof now dispatches the source-derived sidebar
toggle twice and Settings navigation once, with four settled Skia/Dawn
screenshots. The generic binding runtime also inventories actions encountered
outside the consumer manifest and fails their views closed instead of leaving
apparently clickable dead controls.

The durable contract matrix, reproduction commands, screenshots, and exact
GREEN/RED gates are in `../phase-b/native-navigation-state-v18-appkit/README.md`.
Two semantic conversion gaps remain RED: `session.metrics.dismiss` has no
attached endpoint/state transition, and `settings.theme.select` lost its
captured source payload (`light`) plus its state mapping. The Settings route
renders, but the Settings screenshot has severe overlapping layout. None of
these gaps may be hidden with consumer-only callbacks or coordinates, and the
candidate must not be promoted while either action completeness or Settings
visual parity remains RED.

### 2026-07-13 strict-v19 adversarial rejection

The strict-v19 candidate correctly proves AppKit minimum-size enforcement and
basic root containment, but an independent screenshot audit rejected its
zero-failure census as a parity gate. The census uses a sparse geometry fixture
instead of the immutable Electron transcript, permits the wide sidebar-open
composer to wrap into an extra row (`137.25px` native versus approximately
`111.25px` in the matched source state), and accepts a narrow Changes state
that leaves only `16px` of usable chat width. Its collapsed resting frame also
contains a leaked malformed tooltip while the hidden sidebar retains a
`280px` layout rectangle. Global and transcript-region comparisons are
therefore diagnostic failures, not acceptance evidence.

The census must additionally prove the 599px and 768px breakpoints, identical
source fixture content, source-derived rectangle tolerances, zero geometry and
hit testing for hidden panels, minimum usable chat/composer width, exact
composer/footer bottom pinning, clean rest after hover dismissal, and
overlap/offscreen/unexpected-wrap rejection. Every visible action remains
subject to a separate coordinate and visible-postcondition census.

The regenerated Settings route has removed the catastrophic row overlap using
generic block-to-column lowering and state-owned route composition. The v23
candidate also merges state-generated SVG assets through a collision-checked
manifest operation, restoring the navigation and theme icons without
synthetic consumer icons. Its current 1200 x 800 Settings comparison remains
RED at SSIM `0.522850524`, MAE `2.724533`, and `2.076667%` changed pixels;
geometry, typography, action payload/state, and full interaction proof remain
open.

The first hardened-census run is intentionally RED. Burl now recursively
zeros the bounds of invisible Yoga subtrees and restores them on relayout;
sidebar-closed records at all five viewports report zero geometry and cannot
hit-test. The strengthened receipt at
`/private/tmp/palot-census-hardening-v1/receipt.json` exposes fourteen failures
that the containment-only census missed: closed-header overlap, compact
composer containment failures, and unusable chat/composer width when Changes
opens. Those failures remain acceptance blockers; their assertions must not be
weakened to make the candidate green.

Coherent regeneration of all sixteen application-state candidates through the
current lowerer initially appeared to expose orthogonal ownership by
`review.panel.open` and `display.mode` over one transcript frontier. Adversarial
receipt inspection disproved that premise: the repeated descendant occurs in
both review states but only the verbose display state. Review capture owns a
broader ancestor and composition incorrectly attributes its invariant repeated
descendant to the review dimension. Composition remains fail-closed while
contextual repeated-instance identity and invariant-descendant ownership are
fixed generically. Last-writer ownership, Cartesian state expansion, and
Palot-specific combined keys are explicitly rejected.

### 2026-07-13 visible-action and property-furnace gate

The production action census no longer accepts a callback as proof that a
control works. Every imported stateful action must settle after real AppKit
coordinate down/up events and produce a different GPU screenshot or a named,
observable native postcondition. The machine ledger is
`evidence/phase-b/visible-action-coverage-audit.v1.json`. Its current 34-action
union is intentionally RED: 10 actions are green, 6 are missing, 3 are dead,
and 15 remain ambiguous. Nine executions currently fire callbacks without the
required visible transition: model-menu open at three widths, variant-menu
open at three widths, and Changes-panel open at three widths. Those nine are
foundation/state-composition failures, not consumer callback work.

The framework property furnace now runs both with the actual Skia backend and
without a raster backend. The Skia/Dawn materializer is green at 3,563
assertions in 124 test cases. The backend-less build is green for its portable
geometry, parsing, binding, and diagnostic assertions at 1,323 assertions,
with 27 raster-only cases explicitly skipped instead of comparing empty pixel
buffers. The importer package is green at 82 files / 435 tests followed by a
successful TypeScript and ESM build. The Skia filter suite is 59 of 60
assertions with one pre-existing expected-failure drop-shadow oracle; contrast
and invert include a real red-to-cyan pixel discriminator so a numerically
wrong color-matrix bias cannot pass on black-to-white alone.

These framework results are necessary but do not make the application green.
The application remains rejected until the action ledger has no missing,
dead, or ambiguous visible control; the exact responsive state cohorts are
composed without duplicate ownership; and matched Electron/native screenshot
regions pass at every supported viewport and interactive state.

### 2026-07-13 v29 action/runtime and responsive-state truth

The consumer host no longer treats programmatic invocation and pointer
invocation as equivalent without proof. Burl's materializer already installs
the source-observed state transition on a materialized control. The consumer
binding layer now preserves that callback and invokes the endpoint before it,
so an AppKit coordinate click applies the state transition exactly once;
programmatic invocation continues to apply the same transition explicitly.
The focused host test rejects both a missing transition and a double-applied
cycle. A real coordinate sidebar click now changes the visible sidebar state.

The exact 91-control, three-width v29 census remains RED with eighteen visible
postcondition failures. They are classified rather than pooled as consumer
callbacks:

- nine transcript disclosure cells are a generic repeated-template state
  propagation defect: cloned collection rows do not yet retain the captured
  state-owned descendant frontier;
- six project-search, command-palette, and server-menu cells have no captured
  application-state dimension in the composed IR;
- three review-diff cells have an incomplete captured structural frontier.

All eighteen receive coordinate down/up events and dispatch their endpoint;
none may be called working until the settled GPU image changes. The v29 proof
PNGs are in `/private/tmp/palot-v29-action-census`, with the execution log at
`/private/tmp/palot-v29-action-census.log`.

Whole-tree state composition now refreshes source layout for matched branch
nodes while preserving native paint, assets, and actions. This fixes the
Settings `display:block` regression that restored stale row layout after the
block-to-column lowerer had correctly produced three vertical Appearance
rows. Dark Settings is structurally improved but still fails visual parity.
Light Settings is separately RED because the imported light-theme state does
not yet synchronize the native macOS window/backdrop material, leaving the
platform surface dark while imported foreground paint becomes light.

The five-viewport layout-transition census dispatches all twenty sidebar and
Changes pointer transitions, but reports twelve state/layout failures. Wide
sidebar-closed geometry retains stale main-panel width at 1200 and 768,
Changes lacks a complete open-state geometry frontier, and the minimum-width
composer is below its usable-width gate. A scalar state patch cannot represent
the different full responsive unions; the generic composer must emit the
smallest visibility-gated state branch whose responsive payload diverges.
No fixed Palot coordinate or action-name branch is accepted as a solution.

The v31 runtime rerun validates the first generic collection-state repair.
Nested imported state predicates inherit their containing route/theme values,
and an `ImportedRepeatedList` invalidates and remeasures a row after a local
state transition. The framework regression proves row-height growth, scroll
extent, clipping, a changed Skia PNG, and an identical second settled PNG.
The full census now discovers 97 controls and reports twelve failures instead
of eighteen: Read and Edit expand visibly at 599, 768, and 1200. Thought remains
pixel-invariant because its captured repeated template binds only
`reasoning.label`, not the reasoning text. The other nine failures remain the
missing search/menu state dimensions and incomplete review-diff frontier
described above. The machine ledger now points to
`/private/tmp/palot-v31-action-census.log` and
`/private/tmp/palot-v31-action-census`.

### 2026-07-13 source-owned action payload hardening

Dynamic collection actions now resolve either a declared collection item
field or the collection's stable item key. If the required runtime identity is
absent, Burl removes the action, route, and event and stamps a diagnostic
disabled reason; it does not attach a payload-less action or guess that a
visible label is the control's value. Focused framework coverage passes three
cases and eight assertions, including stable-key delivery and a missing-field
zero-endpoint gate. The consumer action-policy suite passes four tests and 113
expectations, and a real importer regeneration proves the contracts are
stamped into the generated IR.

Source inspection establishes the required identities: scroll targets the
current turn ID, undo targets the current user-message ID, and fork targets the
next turn's user-message ID. The current native transcript projection is still
entry-based and supplies none of those three identities, so the corresponding
controls remain deliberately disabled until a turn-based projection provides
real OpenCode IDs. Agent selection also remains unpromoted: the capture exposes
the visible `Debug` label but not the source `agent.name` value, and label/value
equivalence is not a safe generic import rule.

The current responsive-import framework binary is green at 276 assertions in
27 test cases. This is a property-furnace result only; the application remains
RED on the twelve v31 visible-action failures, the five-viewport responsive
state failures, native light-appearance synchronization, and the full matched
Electron/native screenshot gate.

### 2026-07-13 runtime native appearance synchronization

The portable `WindowHost` contract now supports a runtime appearance request,
with a no-op default on platforms that do not provide native window materials.
Both macOS CPU and GPU hosts apply dark, light, or system `NSAppearance`,
recursively invalidate the hosted content/backdrop layers, and invalidate the
GPU surface without recreating either the `NSWindow` or its visual-effect view.
The Release `-j4` Mac platform proof is green at 16 assertions in one case and
logs a presentable Metal/Dawn surface with Skia Graphite.

The consumer maps the source-owned Settings theme payload through a typed
callback to that portable host API. The immutable v29 action proof establishes
the `light` payload and exactly one native appearance callback; generic scoped
state recomposition also has regression coverage proving it preserves the host
action, payload, and transition. This closes the runtime ownership gap, not
Settings parity: production dark/light/system AppKit screenshots and their
matched Electron region comparisons remain RED until captured and reviewed.

A crash-log census on 2026-07-13 found no Palot DiagnosticReport newer than
`Palot-2026-07-12-142254.ips`. This is a useful regression signal but not a
launch-responsiveness gate; the final promoted app must still be launched,
exercised, and checked for a new crash report in the same run.

### 2026-07-13 missing control-state capture closure

The previously uncaptured `project.search.toggle`, `command.palette.open`, and
`server.menu.toggle` state dimensions now have atomic Electron evidence under
`evidence/phase-b/source-interaction-states/generated-v11/control-overlays/`.
Each open transition records a trusted pointerdown/pointerup/click sequence,
produces a distinct source screenshot, and is followed by a trusted Escape
dismissal capture. This closes the source-evidence absence that accounted for
six v31 visible-action failures; it does not close native execution until the
three states are composed into the same fresh IR and pass the AppKit
changed-pixel census.

The immutable v29 action-state proof no longer attempts to validate the
unpromoted transcript scroll/fork/undo payload actions. Those actions have a
separate explicit `PALOT_ACTION_PAYLOAD_PROOF` gate and remain unpromoted until
a generated IR carrying real turn identities passes it. This prevents both a
false failure against an older IR and a false green based only on endpoint
registration.
