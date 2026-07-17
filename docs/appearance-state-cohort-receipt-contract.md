# Appearance state-cohort receipt contract

This contract defines the first application-level decision gate for adopting an
untouched React component into source-observed native paint. It is deliberately
limited to evidence definition: it does not implement a Palot click map, change
the source application, or promote any canonical DesignIR or visual artifact.

The machine-readable authority is
`apps/desktop-burl/contracts/appearance-state-cohort.receipt-manifest.v1.json`.
Its state names, receipt fields, failure taxonomy, and screenshot-region rules
are reusable by another application with theme, opacity, and display-density
preferences. Palot storage keys and source paths appear only as provenance and
source-binding adapters.

## Why these controls are one cohort

Theme selection, resolved theme, native theme source, window opacity, native
window material, and display mode are not independent screenshots. One user
action can update React state, persistent state, document classes, platform
appearance, window construction, and imported native paint. A callback-only
test therefore proves too little.

The cohort starts with a deliberately adversarial seed: the operating system is
light while the application explicitly selects Dark. The whole application,
including the sidebar, must remain dark. A screenshot with Dark selected and a
light sidebar fails as `cohort-theme-split`; a successful button callback cannot
override that result.

Opacity is a cross-process transition. The source closure updates React and
local storage, persists the main-process preference, and requests a relaunch.
The receipt spans the pre-relaunch state and exactly the next process generation
so an opaque switch that paints correctly before relaunch but constructs the
wrong window afterward cannot pass.

## Source grounding

The contract pins the untouched Palot revision and SHA-256 digest of
`GeneralSettings`, its persisted atoms, its theme effect, and its chrome-tier
effect. Source code defines the deterministic seed:

- selected color scheme: `dark`;
- opaque-window preference: `false`;
- display mode: `default`;
- theme definition: `default`.

Existing Electron and native settings PNGs remain useful references, but they
are not silently promoted into the new cohort. The strongest Electron capture
contains persisted Verbose mode, while the earlier native capture visibly
overlaps settings rows. The manifest labels both limitations. Implementation
must recapture every visual transition from an isolated, explicitly seeded
profile at the pinned viewport and scale.

## Receipt model

The manifest extends `burl-live-react-interaction-receipt-v2`. It retains native
event delivery, exact semantic resolution, callback deltas, state changes,
focus, overlay lifecycle, PNG hashes, and fail-closed results. Application-level
steps add:

- React and imported-tree state snapshots;
- local and durable storage snapshots;
- selected and resolved theme snapshots;
- native theme-source and window-material snapshots;
- process-generation receipts for relaunches;
- trusted native event traces and full before/after continuity;
- hash-verified settled layout geometry artifacts;
- hash-verified Electron/native capture artifacts and matched region hashes.

`key-sequence` is manifest shorthand, not permission to collapse evidence. The
runner must expand it into one ordered v2 receipt per native key so every Tab,
Space, arrow, Enter, and Escape has independently auditable focus and callback
deltas.

Display-menu opening, dismissal, and highlight navigation are component
behavior, not Palot application closures. Their expected application callback
delta is therefore zero. Only committing a display-mode selection invokes the
original `setDisplayMode` closure and increments the application callback count.

No step may activate a closure directly, inject focus, or use fixed screen
coordinates. Pointer targets resolve from stable imported/native identity,
keyboard focus is reached through native Tab delivery, and every visual step
requires a newly settled frame.

## Executable guard

`apps/desktop-burl/scripts/verify-appearance-state-cohort.ts` verifies a receipt
bundle without writing any canonical artifact:

```sh
bun apps/desktop-burl/scripts/verify-appearance-state-cohort.ts \
  --manifest apps/desktop-burl/contracts/appearance-state-cohort.receipt-manifest.v1.json \
  --bundle /path/to/appearance-cohort/receipts.json \
  --review /path/to/appearance-cohort/review.json \
  --trusted-manifest-sha256 "$TRUSTED_MANIFEST_SHA256" \
  --report /path/to/appearance-cohort/verification.json
```

The trusted manifest pins comparator limits. The verifier decodes every
source/native PNG and independently derives crop hashes, RGBA MAE, region-diff,
and content-floor results for each declared semantic region. Producer-authored
comparison fields are redundant receipts, not authority. The bundle maintains
continuous source and native frame chains across every action. Each
scenario also carries a fresh initial source/native comparison so the seeded
dark theme cannot pass with a light sidebar before the first interaction.
The verifier derives every crop from hash-verified semantic-node geometry plus
the manifest's padding, inset, exclusion, overlay, and device-scale rules; a
producer cannot substitute a visually convenient patch elsewhere in the frame.

The evidence also binds both the staged canonical candidate and the exact native
executable that produced the captures. Every native receipt repeats the candidate
artifact-set hash. An accepted report cannot authorize different candidate bytes,
even if the state sequence and screenshots are otherwise replayable.

Independent acceptance is a separately supplied JSON artifact with schema
`burl-native-state-cohort-independent-review-v1`. An Ed25519 key allowlisted by
the trusted manifest signs reviewer identity, exact raw bundle hash, manifest
hash, verified artifact-set hash, timestamp, and verdict. The exported
`requireAcceptedAppearanceStateCohortReport` guard reruns full verification at
promotion, including external artifact bytes, rather than trusting an
accepted-looking report.

## Required scenario coverage

The theme scenario covers hover enter/leave, pointer activation, Tab traversal,
Space activation, System selection under a light OS, and a subsequent system
appearance change to dark. Selection and resolution are recorded separately:
System remains selected while its resolved palette changes.

The opacity scenario covers pointer activation to opaque and keyboard activation
back to transparent. Both directions require coherent React, local-storage,
durable-settings, relaunch, document-class, and post-relaunch native-material
receipts.

The display-mode scenario covers pointer opening, option hover, outside-click
dismissal, Escape dismissal, Tab order, Space opening, ArrowDown/ArrowUp active
option changes, and Enter commits in both directions. Dismissal cannot mutate the
stored selection.

Three user-observed Settings regressions are explicit hard gates rather than
consumer patches. The opacity switch must change canonical state, track paint,
and thumb geometry in the correct horizontal direction; a color-only change
fails. The display-mode control must prove overlay placement, hover, focus,
arrows, Enter, Escape, and outside-click dismissal without awkward detached
layout. Every Settings sidebar destination must resolve a semantic target,
change the canonical route, mount the expected content root, move focus, and
change the content-region pixels. These receipts exercise general imported
control, overlay, routing, and layout contracts.

## Screenshot and promotion gate

Each visual step captures the full window and the smallest meaningful regions:
sidebar, content, appearance group, theme segment, opacity switch, and display
select/overlay. Source and native captures must share revision, state seed,
viewport, scale, and system appearance while retaining distinct OS process
identities. Native comparisons use the Skia backend and the existing
tolerance-MAE plus region-diff protocol; exact RGBA tolerance, MAE,
different-pixel percentage, and content-floor limits are pinned directly in the
manifest. Native relaunches advance only the native generation and process
identity.

Canonical artifacts remain untouched until all scenarios pass, freshness and
layout checks pass, and a separate review receipt accepts the exact manifest and
evidence hashes. `verify-appearance-state-cohort.ts` writes the only promotable
verification report; producer-authored `passed: true` fields are insufficient.
Failure of one real control is the architecture decision gate: reassess identity
or native-node adoption before expanding application coverage.
