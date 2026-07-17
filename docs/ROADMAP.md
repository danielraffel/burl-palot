# Burl source-faithful application import roadmap

Updated: 2026-07-16

This is the single current execution plan for the Burl/Palot import pilot. Older
handoffs, experiments, decision records, gap analyses, and evidence manifests
remain supporting evidence; they do not define a competing sequence of work.

## Goal authority

The active Codex goal still displays the two July 11 adversarial-review
attachments as its stored objective. Those attachments remain architectural
input: they require generic capture provenance and determinism, a sealed
token-less/block-heavy held-out application, dynamic token support, explicit
renderer-versus-window-effect ownership, deterministic transparent-window
comparison, commit-pinned claims, and explicit capability decisions for the
named CSS and embedded-content surfaces.

Their historical instruction to pause implementation for another proposal
review has been superseded by the user's later approval to continue, the
hybrid decision work, and the explicit goal resume on July 16. Resuming the
goal therefore means executing this roadmap through the standalone Palot gate;
it does not mean returning to proposal-only work or reverting to either older
implementation lane.

## Outcome

Import a React/Electron application into a standalone native Burl application
without Chromium or a WebView. Preserve the source application's visual design,
React behavior, accessibility, input semantics, responsive layout, and portable
service boundaries. Palot is the proving application, not a source of
framework-specific special cases.

The terminal gate remains a launched macOS `.app`, rendered through
C++/Yoga/Skia/Dawn, that completes a real streamed OpenCode conversation and
passes the required interaction, visual, performance, accessibility, and
architecture evidence.

## Rendering authorities

The roadmap intentionally supports two rendering authorities. They solve
different problems and must not be conflated.

### Custom Burl paint: source-faithful and cross-platform

The source-observed importer captures computed DOM, styles, geometry, fonts,
icons, responsive states, and interaction states. DesignIR and VisualSkin then
materialize a native Burl view tree painted by Skia/Dawn.

This buys us:

- faithful reproduction of custom Electron designs;
- identical product styling across platforms;
- arbitrary Burl/Skia animation, transforms, clipping, and GPU effects;
- macOS window material beneath a portable Burl surface;
- screenshot-testable paint with no browser shipped in the application.

This is the default authority for imported application UI and for Palot.

### Platform-native paint: deliberate semantic controls

Burl already has a Yoga-owned `NativeViewHost` seam that can position, resize,
scroll, and clip a supplied native child view on supported hosts. A future
semantic adapter can deliberately map controls such as a text editor, menu, or
standard settings field to AppKit/UIKit and later equivalent platform controls.

This buys us:

- genuine platform text editing, IME, selection, and context-menu behavior;
- platform accessibility and conventions for deliberately standard controls;
- automatic adoption of some future operating-system behavior and appearance.

It does **not** buy arbitrary Electron parity. Native children composite above
the Skia layer, cannot be covered by Burl paint in the same host, and cannot
faithfully express every CSS transform, clip, glass treatment, or custom
control. Today the generic child-view host is real on Apple hosts, but Burl does
not yet provide cross-platform `Button -> NSButton/WinUI/GTK` factories.

Platform-native paint is therefore an optional semantic lane, never an
automatic fallback and never a shortcut around the custom importer. A future
API may expose an explicit `backend="native" | "custom" | "automatic"`, but
`automatic` must fail closed when the native result would change the design.

## Current execution sequence

### Phase 0 — Preserve both proven inputs — COMPLETE

**Lane:** shared foundation for custom paint and React behavior.

**Buys us:** no restart and no loss of either the visually stronger DesignIR
lane or the behaviorally stronger live-React lane.

- Source-observed framework checkpoint: `833290d7`
- Source-observed consumer checkpoint: `45cfc80c`
- Hybrid integration worktree:
  `/Users/danielraffel/Code/burl-wt-hybrid-react-adoption`
- Hybrid integration head after adoption and receipt hardening: `9fde386b`

### Phase 1 — Failure-capable native interaction harness — COMPLETE

**Lane:** shared behavior/input validation; this uses native AppKit events but
does **not** replace Burl-painted controls with AppKit-painted controls.

**Buys us:** proof that a control was reached through real AppKit input, invoked
the intended callback, changed named state/focus/overlay state, and produced a
fresh frame. It prevents a resolved hit target or non-empty PNG from being
misreported as working UI.

The generic React control cohort proves 15 stateful steps plus an unlinked-control
negative case. Targetless pointer steps now fail closed instead of
dereferencing an absent semantic identity.

### Phase 2 — Deterministic capture/runtime identity — IN PROGRESS

**Lane:** shared join between custom Burl paint and live React behavior.

**Buys us:** the exact captured DOM instance and the exact live React host
instance can identify the same native node without Palot IDs, coordinates, or
guesses. This is required for repeated components, conditionals, keyed lists,
and safe callback attachment.

Required contract:

1. instrument authored host JSX with a deterministic source-site marker without
   modifying authored source;
2. add a deterministic instance discriminator derived from explicit React key
   lineage;
3. preserve the composite identity through browser capture and DesignIR;
4. emit a source-span/identity manifest;
5. fail closed for ambiguous keyless repeated instances;
6. resolve the same identity in the native React host.

Gate: multi-module, conditional, keyed-list, keyless-ambiguity, source-revision,
and render-neutrality tests.

Completed identity slice: framework commit `d6a5de6f` instruments intrinsic
host JSX with deterministic, revision-bound source sites and explicit keyed
instance evidence; emits a source-span sidecar; leaves custom components and
authored files untouched; and fails closed for known ambiguous forms. Its 18
Node tests, 29 source-contract self-tests, DOM-byte neutrality check, and macOS
pixel-byte neutrality check pass. Remaining: make capture prefer this identity
and make the live native host resolve the same final stable anchor.

### Phase 3 — Pixel-neutral native-node adoption — ENDPOINT COMPLETE

**Lane:** custom Burl paint plus live React behavior. “Native node” here means a
native Burl/Yoga/Skia view-tree node, not a platform-painted `NSControl`.

**Buys us:** live React can attach its original callbacks/state to a node that
the source-observed importer already laid out and painted, without replacing
the node or replaying visual/layout props.

The generic endpoint is integrated at `9fde386b`. It fails closed for missing,
duplicate, conflicting, and wrong-parent anchors; preserves existing native
callbacks; and verifies exact paint-command neutrality. It is not end-to-end
until Phase 2 supplies untouched React with the correct identity.

### Phase 4 — One real Palot settings cohort — NEXT DECISION GATE

**Lane:** custom Burl paint plus live React behavior, proven on real Palot.

**Buys us:** falsifiable proof that the hybrid architecture solves the actual
problem rather than only fixtures.

Use untouched Palot `GeneralSettings`. For each theme, opacity, and display-mode
transition, require:

- the Electron-matched DesignIR pixels before interaction;
- real AppKit pointer/keyboard delivery;
- invocation of the original React closure;
- coherent React and imported-tree state mutation;
- a fresh post-state screenshot and layout receipt;
- Escape, arrows, Enter, hover, outside-click, and focus behavior where relevant.

Theme, opaque-background, and display mode form one state cohort. A screenshot
where Dark remains selected while the sidebar becomes light is a hard failure,
even if the switch callback fired.

Decision rule: if one real control cannot preserve imported pixels while using
the original React behavior, stop and reassess the hybrid contract before
expanding coverage.

### Phase 5 — General interaction and overlay coverage — PENDING

**Lane:** custom Burl paint plus reusable React/input/overlay behavior.

**Buys us:** formerly inert application surfaces work through reusable runtime
contracts rather than consumer click maps.

Expand the proven mechanism to settings navigation, sidebar/project/session
rows, title editing, menus, tooltips, popovers, Changes panel, model/variant
selection, transcript tools, composer, cancellation, retry, and persistence.

### Phase 6 — Source-faithful visual and responsive parity — PENDING

**Lane:** custom Burl paint.

**Buys us:** the working app also looks and resizes like the Electron source.

Run the fixed Electron/native screenshot cohorts at wide, reference,
minimum-supported, compact, and state-transition sizes. Gate fonts, icons,
baselines, rounded clipping, gutters, composer pinning, minimum size, scrollbar
clearance, glass/material, window border, animation, and panel geometry by
region diffs and adversarial visual review.

### Phase 7 — Optional semantic native-control package — DEFERRED

**Lane:** platform-native paint, explicitly selected for suitable semantic
controls; separate from the Palot custom-paint critical path.

**Buys us:** an explicit reusable route to genuine OS controls where native
behavior is more valuable than custom-paint parity.

Deliver separately from the Palot critical path:

1. define semantic control intent independent of platform classes;
2. implement lifecycle/state/focus/accessibility contracts;
3. add AppKit/UIKit factories first, then Windows/Linux only when their host
   embedding is real;
4. define z-order, transform, clipping, snapshot, and fallback diagnostics;
5. prove a mixed custom/native sample and held-out application;
6. never silently choose native paint when it changes captured appearance.

### Phase 8 — Standalone Palot completion — PENDING

**Lane:** integrated product gate, primarily custom Burl paint with no WebView;
any future platform-native control must be explicit and evidence-backed.

**Buys us:** the original autonomous goal, not merely importer infrastructure.

Build, launch, and visually inspect the standalone `.app`; select a real
project; start/connect OpenCode; create/open a session; stream a real response;
exercise cancellation/retry/persistence/clipboard/IME/accessibility/scrolling;
run tests, traces, benchmarks, screenshots, and adversarial reviews; update the
Burl-to-Pulp ledger; and pin the consumer to an immutable Burl version.

## Supporting documents

- `docs/handoffs/2026-07-15-palot-import-approach-decision.md` — preserved
  checkpoint and exact historical resume points.
- `docs/live-react-ab-experiment.md` — A/B hypothesis and receipt matrix.
- `docs/decisions.md` — durable architectural decisions.
- `evidence/visual-parity/GAP-ANALYSIS.md` — visual red gates.
- `evidence/visual-parity/CONTINUATION-2026-07-13.md` — earlier control-app
  evidence and known regressions.

When status changes, update this roadmap first and keep the supporting evidence
linked to the corresponding phase.
