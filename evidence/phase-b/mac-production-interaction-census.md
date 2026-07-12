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

Current result: **PASS — zero failures across 82 enumerated controls**, including
eight native-local controls (selectable Markdown and keyboard-focusable virtual
lists). The repeated observations are intentional: a control must remain valid
at every width where it is effectively visible.

The scalable harness correction removes false positives from descendants
outside the viewport and from descendants clipped by any overflow-clipping
ancestor. Controls are evaluated in root coordinates and partially visible
controls use the center of their effective visible intersection.

Covered interaction groups:

- Sidebar/session/project navigation cluster now passes production dispatch:
  both New Session surfaces, all six captured session rows, Automations,
  Search projects, Command palette, Add Project, the project template,
  This Mac, Settings, and sidebar toggle are bound. Manual sidebar close also
  persists through narrow-to-wide resize and clearing returns to the responsive
  baseline.
- App-bar title editing, changes panel, metrics, Open/menu, terminal attach,
  and close-session controls now dispatch through typed consumer actions.
  Terminal attach writes the real OpenCode attach command through Burl's
  portable clipboard.
- Composer attachment, Build, model, variant, and display-mode controls now
  dispatch through typed actions. Attachment invokes Burl's real file dialog.
  The textarea remains an editable/focus target; its `prompt.send` contract is
  keyboard-submit semantics and is not incorrectly treated as a click action.
- Source-hidden form proxies (`aria-hidden`, non-focusable, negative tabindex)
  are pointer-inert after native promotion; widget defaults cannot turn these
  DOM implementation details into duplicate hit targets.
- Selectable Markdown and virtual-list keyboard/scroll behavior are classified
  as native-local interaction. They must hit correctly, but deliberately do not
  receive fabricated application actions.

The machine-readable full diagnostics are emitted by the test itself, including
width, stable source anchor, accessible label, actual hit anchor, and test point.
No product action is fabricated to make this gate pass.
