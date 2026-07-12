# macOS production interaction census

Generated from the production `NSWindow`/`PulpView` event path at root widths
599, 768, and 1200 px. The test enumerates runtime-visible bound actions,
focusable controls, editable controls, and scroll targets; intersects every
target with the live viewport; verifies root hit testing; and sends AppKit
mouse-down/up or wheel events.

Command:

```sh
cmake --build build-semantic --target palot-mac-production-interaction-test -j4
ctest --test-dir build-semantic -R '^palot-mac-production-interaction$' --output-on-failure
```

Current result: **FAIL — 51 observations across 85 enumerated controls**.
The repeated observations are intentional: a control must remain valid at
every width where it is effectively visible.

The first scalable harness correction removed false positives from descendants
outside the viewport. Controls are now evaluated in root coordinates and
partially visible controls use the center of their visible intersection. This
also exposes real responsive overflow: at 599/768 px, several right-side
controls are represented only by a clipped sliver whose hit resolves to the
sidebar wrapper.

Highest-priority actionable groups:

- Sidebar/session/project navigation cluster now passes production dispatch:
  both New Session surfaces, all six captured session rows, Automations,
  Search projects, Command palette, Add Project, the project template,
  This Mac, Settings, and sidebar toggle are bound. Manual sidebar close also
  persists through narrow-to-wide resize and clearing returns to the responsive
  baseline.
- App bar: title rename, diff-count button, Open and its adjacent menu controls
  are focusable but unbound.
- Composer toolbar: attachment, Build, model, and variant controls are focusable
  but unbound. The textarea is handled as an editable/focus target; its
  `prompt.send` contract is keyboard-submit semantics and is not incorrectly
  treated as a click action.
- Responsive geometry: composer and secondary-panel controls can intersect the
  root while lying outside their intended container, demonstrating source
  geometry that has not been lowered to a responsive native layout.
- Selectable Markdown descendants participate in mouse input but currently do
  not have a stable leaf hit target, so selection semantics require a separate
  text-selection assertion rather than a synthetic application action.

The machine-readable full diagnostics are emitted by the test itself, including
width, stable source anchor, accessible label, actual hit anchor, and test point.
No product action is fabricated to make this gate pass.
