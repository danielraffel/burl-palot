# Burl Palot continuation checkpoint

This checkpoint preserves the reusable native-import implementation and the
current consumer integration without claiming that Palot is complete. The
standalone app builds and launches through C++/Yoga/Skia/Dawn, but its canonical
interaction state, responsive layout, Settings route, transcript, and visual
parity gates remain red.

## Repositories and immutable checkpoint

- Burl worktree: `/Users/danielraffel/Code/burl-wt-native-migration-feasibility`
- Burl branch: `feature/native-migration-feasibility`
- Burl checkpoint: `a29d9166af03c5b59efdc5c7358f440d2eecc64e`
- Consumer worktree: `/Users/danielraffel/Code/burl-palot-wt-semantic-restart`
- Consumer branch: `feature/semantic-native-palot-restart`
- Consumer checkpoint: the commit containing this document
- Clean Electron reference: `/Users/danielraffel/Code/palot` (do not modify)
- Electron capture worktree: `/Users/danielraffel/Code/palot-wt-burl-capture`

The consumer manifest still records Burl
`3f150539cfe72c83791d9ae0d2d9af4fa5d6eeb3`; local development uses
`BURL_SOURCE_DIR` to build against the worktree above. Before publication, make
the consumer depend on an immutable published Burl revision containing the
checkpoint and remove reliance on the local override.

## Build and launch

```bash
cd /Users/danielraffel/Code/burl-palot-wt-semantic-restart
cmake --build build-semantic -j4
open -n build-semantic/Palot.app
```

Current app:
`/Users/danielraffel/Code/burl-palot-wt-semantic-restart/build-semantic/Palot.app`

The last build was Release and launched successfully. At the checkpoint the
Electron reference was quit before the native app was launched, so the visible
Palot window was the Burl build.

## Verified green foundation

- `@pulp/import-ir`: 85 test files and 459 tests pass, including deterministic
  application-state composition, responsive unioning, source identity,
  overlay/disclosure contracts, and trusted interaction-payload receipts.
- Full framework design-import gate: 2,519 assertions across 360 cases pass.
- The real generated collection-action payload proof returns `0`.
- Thought, Read, and Edit disclosure open/close transitions now pass; static
  application-state-bound descendants survive collection-template pruning.
- Native macOS capture can classify deterministic Dawn/Skia backbuffer captures
  separately from environment-dependent WindowServer glass captures.
- A standalone unsigned macOS app is built through the native Burl rendering
  path; no WebView or Chromium was added to the consumer.
- Source cohorts exist for sidebar and Changes transitions, usage popover,
  tooltips, context menus, Settings navigation, responsive widths, fonts,
  motion, and select-option values. These are inputs to promotion, not evidence
  that the canonical app already passes.

## Current mechanical red gates

The focused consumer sweep currently passes four of six selected tests:

```text
PASS palot-application-binding-manifest
PASS palot-opencode-process
PASS palot-project-config
PASS palot-transcript-turn-projection
FAIL palot-imported-root-host
FAIL palot-view-interaction-state
```

`palot-imported-root-host` attaches 22 of 28 required actions. Missing typed
payload contracts are:

- `external.open.preferred`
- `project.select`
- `session.create`
- `session.open`
- `settings.theme.select`
- `terminal.attach`

`palot-view-interaction-state` now advances past all three disclosure checks and
stops at result code 28, the separate `settings.theme.select` payload gap.

The latest strict responsive state candidate is
`/private/tmp/palot-v31-responsive-state-integrated.design-ir.json`. Its report
is `/private/tmp/palot-v31-responsive-state-verification.report.json` and is red
for 29 empty bindings: six duplicated select options and 23 command-palette
items. Exact select receipts are in
`/private/tmp/palot-select-option-receipts/evidence/interactions.json`. Do not
promote the candidate until the strict report reaches zero and AppKit coordinate
execution proves every visible action.

The full consumer Bun sweep at checkpoint is intentionally red: 315 pass,
3 skip, and 3 fail across 321 tests. Two source-component-reference failures
reject the replaced shell PNG/semantics because their immutable manifest hashes
were not updated by an attested capture lane. The font receipt test also rejects
the current canonical IR because it no longer contains the expected `.SF NS`
runtime face. Do not bless either change by updating expected values; reconstruct
the source provenance and regenerate the canonical IR through the reviewed
capture path.

## Visible regressions in the launched app

These observations are acceptance failures, not polish notes:

1. `Default variant / Adaptive / Standard` is visible over the upper-left
   sidebar at startup. It is not intentional. The imported IR currently carries
   the select portal under `composer.variant-menu.open` with inverted default
   visibility (`closed: true`, `open: false`). The option actions also lack the
   promoted typed payload bindings, explaining why the visible rows do not work.
   Fix default-state isolation in generic state composition; do not hide it with
   Palot coordinates or consumer paint code.
2. Settings navigation reaches a partial General route, but the left navigation
   labels overlap, appearance controls collapse onto each other, and `Back to
   app` is missing. Treat the route, back action, navigation list, segmented
   theme control, opaque-background toggle, select controls, persistence,
   keyboard behavior, and accessibility as one source-observed route gate.
3. Transcript turns, thought metadata, Markdown, and tool rows overlap or render
   at incorrect vertical positions. Composer placement is improved but the
   transcript viewport/collection measurement is not canonical.
4. Message sending reaches the live projection path but streamed content is not
   laid out cleanly. The real OpenCode gate is not closed.
5. Several sidebar and top-bar controls remain static in the canonical tree even
   though isolated generic action routing tests pass.
6. Settings/sidebar truncation, missing icons, baseline differences, motion,
   tool-card colors, contextual overlays, narrow/tall resize, input/IME,
   accessibility, persistence, cancellation, retry, and tool approval remain
   open as itemized in `GAP-ANALYSIS.md`.

## Ordered continuation path

1. Rebase the six select-option nodes with the exact trusted receipts and prove
   that the strict report falls from 29 to exactly 23.
2. Capture/review exact command-palette item actions and payloads, then require a
   strict zero-empty binding report. Disabled or unsafe items must fail closed.
3. Generate one closed-overlay canonical IR. No menu, tooltip, popover, command
   palette, or context menu may be visible in the resting state.
4. Promote that reviewed IR and rerun the real AppKit interaction and layout
   censuses at 280 x 420, 599 x 420, 768 x 800, 1200 x 800, and 1200 x 1000.
5. Fix the six required consumer payload contracts from source receipts. Do not
   infer IDs or payloads from labels.
6. Rebuild and visually compare the canonical app region-by-region against the
   Electron reference: top bar, sidebar, transcript, Markdown/tool cards,
   composer, Settings, Changes, and every overlay.
7. Finish input, selection, clipboard, IME, scroll, accessibility, real streamed
   OpenCode, cancellation, retry, persistence, tool approval, traces,
   benchmarks, adversarial reviews, publication, and the Burl-to-Pulp ledger.

## Reproduction commands

```bash
cd /Users/danielraffel/Code/burl-wt-native-migration-feasibility/packages/pulp-import-ir
bun run build
bun run test

cd /Users/danielraffel/Code/burl-palot-wt-semantic-restart
cmake --build build-semantic -j4
PALOT_ACTION_PAYLOAD_PROOF=1 \
  ./build-semantic/palot-imported-root-host-test \
  /private/tmp/palot-action-payload-contract.design-ir.json \
  apps/desktop-burl/contracts/main-chat.application-bindings.v1.json
ctest --test-dir build-semantic --output-on-failure \
  -R 'palot-(transcript-turn-projection|application-binding-manifest|imported-root-host|view-interaction-state|opencode-process|project-config)'
```

Large generated capture directories and build trees remain local and are not
part of the checkpoint commit. The durable status ledger is
`evidence/visual-parity/GAP-ANALYSIS.md`; source captures can be regenerated from
the clean Electron reference and the committed capture tools.
