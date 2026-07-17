# Live React A/B evidence

Control checkpoint: `45cfc80cd925529b1a780995bd0a2860307ec842`

Control tag: `checkpoint/palot-native-2026-07-15-pre-live-react-ab`

The experiment starts from that exact consumer state. It does not replace the
observed-DOM DesignIR, visual tokens, promoted interaction-state captures, or
the native macOS window-material implementation.

## Initial control results

- Consumer script tests: 17 passed, 0 failed under Bun 1.3.8.
- Release native build: passed.
- Strict native gates: red.
  - application binding manifest is incomplete;
  - `external.open.preferred` and `navigation.back-to-app` are unattached;
  - the minimum-height layout clips the composer;
  - the view-interaction and production-interaction gates fail;
  - the layout-transition census terminates with a bus error.

These failures remain part of the comparison. The live lane does not receive
credit for compiling or drawing a non-empty image.

## Existing live React runtime probe

The existing `test/fixtures/v0-dev/settings-strip.tsx` source, which uses React
state, buttons, sliders, dynamic labels, inline styles, radius, and flex layout,
bundled through the existing ReactDOM-to-`@pulp/react` shim. It materialized 21
native nodes and produced a Skia screenshot at:

`/tmp/pulp-live-react-settings-strip.png`

The legacy roundtrip executable then failed because its assertion is hard-coded
to search for `Chainer` text regardless of the supplied fixture. That is
classified as harness debt, not a live React runtime failure.

## Real Palot source probe

The source-contract audit parsed the read-only Palot
`general-settings.tsx` with no parse errors, 28 JSX elements, and four event
contracts:

- default-open-destination `Select.onValueChange`;
- theme `button.onClick`;
- opaque-window `Switch.onCheckedChange`;
- display-mode `Select.onValueChange`.

The static audit did not meet its native-materiality threshold because visual
shape is expressed through imported Palot composite components and Tailwind
classes. The live bundler's first failure was its default-export-only entry
assumption; Palot exports `GeneralSettings` by name. Generic `--export` and
`--tsconfig` support are therefore the first isolated bundler experiment.

## Required comparison

The Electron source, current baked control, live React source lane, and adopted
hybrid lane must consume the same scripted interaction matrix. Each step must
record target resolution, pointer/key delivery, callback execution, state and
focus deltas, overlay lifecycle, and a Skia screenshot digest.
