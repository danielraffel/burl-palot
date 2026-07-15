# v18 native navigation and action-contract audit

This directory is candidate evidence only. It does not promote v18 to the bundled
DesignIR and does not modify any Electron baseline. The exact candidate is
`/private/tmp/palot-intrinsic-v18-strict-font-layout.design-ir.json`, SHA-256
`6f0711ed4aadced725a1d2fd6f9effafd64d9134cd3aa8c09b55fab03d784173`.

## Source-derived action/state inventory

| Action | Source evidence | v18 contract | Gate |
| --- | --- | --- | --- |
| `sidebar.toggle` | `generated-v3/sidebar/{expanded,collapsed}` and `sidebar-toggle-source.v1.json` | `sidebar.open`, `cycle:open,closed` | GREEN: two real AppKit clicks collapse and restore the source-derived layout |
| `navigation.settings` | `source-interaction-states/settings-route.png` | `navigation.route`, `set:/settings/general` | GREEN: real AppKit click replaces chat state with Settings state |
| `review.panel.toggle` | `generated-v3/review` and `generated-v3/review-diff` | `review.panel.open`, `toggle` | Contract present; outside this focused proof |
| `session.metrics.toggle` | `generated-v4/usage/{closed,open-focused}` | `session.metrics.open`, `toggle` | Contract present; outside this focused proof |
| `session.metrics.dismiss` | `generated-v4/usage/{open-focused,closed-after-dismiss}` | action only; no state contract | RED: encountered and fail-closed because no endpoint is attached |
| `settings.theme.select` | `generated-v3/settings-controls/dark/source.json` carries source payload `light` | action only; payload, state key, and transition are absent | RED: conversion dropped source semantics; no consumer mapping was invented |

The source capture for the Settings control is especially important: its
`outerHTML` contains `data-pulp-action="settings.theme.select"` and
`data-pulp-payload-contract="light"`. v18 contains the action but not that payload.
This is an importer/composition defect, not a reason to hard-code a Palot theme
handler.

## Generic runtime correction

`ImportedRootHost` now inventories every action encountered while binding the
imported tree, including actions absent from the consumer manifest. When no
endpoint exists, the imported view is disabled and removed from hit testing.
The runtime therefore cannot silently leave a dead control looking clickable.
The focused invariant also checks that every unresolved imported view is both
disabled and non-hit-testable.

## AppKit visual proof

The production test uses `MacWindowHarness`, the Metal/Dawn surface, Skia
Graphite, actual pointer dispatch, and settled back-buffer captures:

1. `01-chat-sidebar-open.png`
2. `02-chat-sidebar-collapsed.png`
3. `03-chat-sidebar-restored.png`
4. `04-settings-general.png`

`navigation-state-audit.v1.json` records two sidebar dispatches, one Settings
navigation dispatch, removal of chat metrics after navigation, and visibility of
the imported theme control. The proof registers no-op endpoints for the two
known unresolved actions only so the Settings state can be rendered; it does not
click them or claim their contracts are complete.

The Settings screenshot is an explicit visual RED: sidebar labels and Settings
rows overlap. Navigation/state replacement works, but Settings layout parity
does not. This must be fixed in source conversion/layout lowering and validated
against the Electron Settings capture; it must not be repaired with
consumer-only coordinates.

## Reproduction

Build:

```sh
cmake --build build-phase-b --target \
  palot-imported-root-host-test \
  palot-native-interaction-execution-test \
  palot-mac-production-interaction-test -j 8
```

Focused generic fail-closed invariant (GREEN, exit 0):

```sh
PALOT_EXPECT_UNATTACHED_ACTIONS='session.metrics.dismiss,settings.theme.select' \
  ./build-phase-b/palot-imported-root-host-test \
  /private/tmp/palot-intrinsic-v18-strict-font-layout.design-ir.json \
  apps/desktop-burl/contracts/main-chat.application-bindings.v1.json
```

Normal interaction completeness gate (intentionally RED, exit 3 and prints both
unattached action IDs):

```sh
./build-phase-b/palot-native-interaction-execution-test \
  /private/tmp/palot-intrinsic-v18-strict-font-layout.design-ir.json \
  apps/desktop-burl/contracts/main-chat.application-bindings.v1.json
```

Production AppKit navigation proof (GREEN):

```sh
PALOT_NAVIGATION_PROOF_ONLY=1 \
  ./build-phase-b/palot-mac-production-interaction-test \
  /private/tmp/palot-intrinsic-v18-strict-font-layout.design-ir.json \
  apps/desktop-burl/contracts/main-chat.application-bindings.v1.json \
  evidence/phase-b/interaction-candidates.generated.v1.json \
  apps/desktop-burl/contracts/main-chat.source-binding-policy.v1.json \
  evidence/phase-b/native-navigation-state-v18-appkit
```

No canonical promotion is permitted while the normal action-completeness gate
or Settings visual parity gate remains RED.
