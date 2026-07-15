# Palot import approach decision checkpoint

Updated: `2026-07-15T12:55:00-07:00`

This is a paused decision checkpoint, not a declaration that the Palot goal is
complete and not a transfer of ownership. Implementation stopped on the user's
request. The active autonomous goal remains paused.

## Objective and completion gate

The long-term objective is a source-faithful, standalone native macOS Palot app
whose UI is rendered by Burl's C++/Yoga/Skia/Dawn path, with no Chromium or
WebView, and whose real interactions match the Electron reference. The importer
must generalize to other React/Electron applications rather than hard-code
Palot.

Completion still requires visual A/B parity, complete click/keyboard behavior,
responsive layout, real OpenCode streaming, persistence, cancellation/retry,
accessibility, and the execution-plan test/evidence gates. None of the commits
below satisfies that completion gate by itself.

## The two approaches now preserved

### A. Source-observed DesignIR import (the original lane)

This lane captures computed DOM/style/geometry and lowers it into native
DesignIR, VisualSkin, application-state variants, and native host capabilities.
It contains the strongest work on visual fidelity, property coverage,
responsive state captures, fonts/icons, macOS 26 glass, and screenshot evidence.

Its current weakness is behavioral: observed DOM serializes the rendered result
but not React closures, hooks, context, effects, router behavior, or component
library semantics. The consumer consequently reattaches too much behavior by
hand, and many controls remain inert or inconsistent.

- Framework worktree: `/Users/danielraffel/Code/burl-wt-native-migration-feasibility`
- Branch: `feature/native-migration-feasibility`
- Checkpoint: `833290d7` (`Checkpoint source-observed native import work`)
- Consumer worktree: `/Users/danielraffel/Code/burl-palot-wt-semantic-restart`
- Branch: `feature/semantic-native-palot-restart`
- Checkpoint: `45cfc80cd925529b1a780995bd0a2860307ec842`
- Tag: `checkpoint/palot-native-2026-07-15-pre-live-react-ab`
- Runnable control app: `/Users/danielraffel/Code/burl-palot-wt-semantic-restart/build-semantic/Palot.app`

The consumer source is committed. Its untracked build directories and generated
capture cohorts are intentionally left in place as ephemeral local evidence and
must not be mistaken for source changes.

### B. Live React/Fiber import (the exploratory lane)

Pulp/Burl already has a real `react-reconciler` host that preserves React
component state and event callbacks while producing native Yoga/Skia views. A
stateful native fixture rendered successfully through this path. More
importantly, the real Palot `GeneralSettings` component and its dependency graph
now bundle without a Palot-specific alias.

This lane has not yet rendered a real Palot screen. Its current proof image is a
generic settings fixture and must not be presented as Palot visual progress.
Runtime compatibility, portals/focus, History API, observers, measurement,
Electron service bridges, and adoption of existing DesignIR visuals remain open.

- Consumer A/B worktree: `/Users/danielraffel/Code/burl-palot-wt-live-react-ab`
- Branch: `experiment/live-react-ab`
- Pre-guide checkpoint: `bf500210f776d1c027d5d0b68208ef8ec6d648d4`
- Experiment plan: `docs/live-react-ab-experiment.md`
- Generic bundler worktree: `/Users/danielraffel/Code/burl-wt-live-react-bundling`
- Branch: `feature/live-react-bundling`
- Commit: `70ca51bf3d60980a9389a323d830e15973a0c7bc`
- Generic action-runtime worktree: `/Users/danielraffel/Code/burl-wt-imported-action-runtime`
- Branch: `experiment/imported-action-runtime`
- Commit: `2ba34097fbb80f94357b322ac183be7623e1dee8`

The bundler accepts named exports and an explicit tsconfig. The exact real-source
probe was:

```sh
cd /Users/danielraffel/Code/burl-wt-live-react-bundling/tools/import-design/jsx-runtime
node jsx-transform.mjs \
  --in /Users/danielraffel/Code/palot/apps/desktop/src/renderer/components/settings/general-settings.tsx \
  --out /tmp/palot-general-settings-bundle-2.js \
  --export GeneralSettings \
  --tsconfig /Users/danielraffel/Code/palot/apps/desktop/tsconfig.json
```

Result: 1,748,438 bytes, SHA-256
`d2ebe5d1c9ef438a7d8f506a1c9b854a01dbd9417fb9ff56a81e3bdda67d9d2a`.

## Recommendation when work resumes

Do not discard either lane and do not merge the experiments merely because they
compile. The highest-leverage direction is an evidence-gated hybrid:

1. Keep DesignIR, VisualSkin, computed-style capture, property audits, native
   window policy, and macOS 26 glass as the visual and platform foundation.
2. Use the existing live React reconciler to preserve authored state, hooks, and
   callbacks.
3. Adopt materialized native nodes by stable source identity instead of letting
   React replace the visually validated tree. Initial adoption must be
   render-neutral.
4. Use the generic `ImportedActionRuntime` only as the typed bridge between an
   imported action endpoint and the live JS dispatcher. Keep Electron/Tauri
   services behind explicit portable host interfaces.
5. Prove one real Palot screen with identical screenshot, click, keyboard,
   dismissal, focus, and state receipts before selecting this as the main lane.

This recommendation combines the original lane's visual/property work with the
exploratory lane's preserved React behavior. It is not yet proven; the next A/B
gate exists specifically to falsify it cheaply.

## Verified evidence and current red gates

- Consumer Bun tests: 17/17 passed after updating the stale canonical-promotion
  fixture.
- Consumer Release build: passed.
- Strict consumer native gate: 0/6 passed. Known failures include incomplete
  binding manifest, unattached `external.open.preferred` and
  `navigation.back-to-app`, a 599x248 minimum size that clips the composer,
  interaction-state failures, and a layout-transition-census bus error.
- Live React bundler tests: 8/8 passed.
- Real Palot `GeneralSettings` module graph: bundled successfully.
- ImportedActionRuntime: 63 assertions across 4 cases passed; focused ctest 1/1
  passed. It composes with an existing DesignIR `on_click` transition.
- Native live-React fixture screenshot:
  `/tmp/pulp-live-react-settings-strip.png` (ephemeral and not a Palot parity
  image).
- The latest control app launches, but its clickability and visual parity remain
  red. User-reported screenshot regressions remain authoritative open gates.

## How to resume either path

### Resume the original lane

```sh
cd /Users/danielraffel/Code/burl-wt-native-migration-feasibility
git status --short
git rev-parse HEAD

cd /Users/danielraffel/Code/burl-palot-wt-semantic-restart
git status --short
open -n build-semantic/Palot.app
```

Expected heads are `833290d7` and `45cfc80c`. Continue only with generic
property/import/runtime fixes and rerun the strict six-test consumer gate.

### Resume the exploratory A/B

```sh
cd /Users/danielraffel/Code/burl-wt-live-react-bundling
git status --short
npm test --prefix tools/import-design/jsx-runtime

cd /Users/danielraffel/Code/burl-wt-imported-action-runtime
git status --short
cmake --build build-action-runtime --target pulp-test-application-action-binding -j4
./build-action-runtime/test/pulp-test-application-action-binding
```

Expected heads are `70ca51bf` and `2ba34097`. The first implementation task is
to materialize the real Palot `GeneralSettings` bundle in Release and record the
first runtime incompatibility or a real Skia screenshot. Do not use the generic
fixture as a visual acceptance result.

### Resume the recommended hybrid decision test

Start from the exploratory A/B worktree, integrate the two generic framework
commits into a fresh framework test branch, and run the same scripted interaction
matrix against:

1. the Electron reference;
2. the current baked DesignIR control;
3. the real live-React screen; and
4. the adopted hybrid screen.

Pass signal: the adopted hybrid is render-neutral relative to the validated
DesignIR visual and matches the Electron state transition receipts without
Palot-specific framework IDs or callbacks.

## Repository boundaries

- `/Users/danielraffel/Code/palot` is the clean reference checkout and must not
  be modified.
- Burl framework code stays in the Burl repository.
- Palot product code stays in the separate `burl-palot` repository.
- Pulp primary remains remote-bearing/reference-only; any Pulp audit or
  development uses a fresh worktree.
- No WebView or Chromium fallback is acceptable for the primary UI.

## First safe continuation step

Read this file and `docs/live-react-ab-experiment.md`, inspect the exact heads,
then ask the user whether to resume the original lane, continue the exploratory
A/B, or run the recommended hybrid decision test. Do not infer that decision
from the existence of the experimental branches.
