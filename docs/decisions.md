# Burl Palot decision log

This log records consequential implementation choices made while executing the
standalone Burl Palot demo. Dates use the local project timezone.

## 2026-07-11 — Keep framework and product repositories separate

Palot-specific presentation, OpenCode integration, persistence, and product
assets live only in `burl-palot`. Burl contains reusable native application and
UI infrastructure. This preserves the public framework boundary and makes the
consumer relationship independently reproducible.

## 2026-07-11 — Use a neutral Burl build profile

The native application build defaults to `BURL_BUILD_AUDIO=OFF`. Audio, MIDI,
plugin adapters, plugin hosting, and related install surfaces are excluded from
the application SDK. SDL video remains enabled with SDL audio disabled. This is
the smallest reversible split that proves Burl is an application framework
rather than a relabeled plugin build.

## 2026-07-11 — Pin an immutable framework commit

`apps/desktop-burl/burl.lock.json` records the full commit behind Burl tag
`v0.1.0-alpha.4` (`3f150539cfe72c83791d9ae0d2d9af4fa5d6eeb3`). CMake may use an explicit absolute `BURL_SOURCE_DIR` only for
local development. Normal consumer resolution always uses the immutable Git
revision, preventing branch drift while retaining a fast framework iteration
loop.

## 2026-07-11 — Use Burl's native rendering path directly

The application target is created by `burl_add_app` and its primary window is a
Burl/Pulp `WindowHost` containing native C++ views painted by Skia on the shared
Dawn/Metal surface. Chromium, Electron, WebKit, and WebView are not part of the
shipping target. The existing Electron app remains reference behavior only.

## 2026-07-11 — Keep OpenCode credentials out of transport messages

The OpenCode boundary passes opaque credential references rather than token
material. Command results are correlated to their command types, and streamed
events carry project/session identity plus ordered cursors. This fails closed on
gaps or reordering and lets cancellation and retry remain explicit.

## 2026-07-11 — Bundle a headless OpenCode sidecar

The native application bundles a self-contained, ARM64 OpenCode protocol
sidecar under `Contents/Resources/bin`. It provides process and SDK isolation
only; it renders no UI. The C++ client discovers it relative to the application
bundle and exchanges bounded, versioned newline-JSON frames. This replaces the
prototype's machine-dependent CLI lookup and brittle parsing while keeping the
entire visible interface on Burl's C++/Skia/Dawn path.

## 2026-07-11 — Resolve repository-wide advisories at the lock boundary

The legacy Electron reference workspaces remain installable, so their tooling
dependencies are part of the repository supply-chain gate even though they are
not shipped in the Burl application. Root overrides pin audited versions for
vulnerable transitive packages; direct workspace ranges remain unchanged when
the override is API-compatible. Electron stays on the supported 40.x line and
Vite stays on 7.x (`40.10.6` and `7.3.6`) instead of taking unnecessary major
upgrades. Type declarations for Node and CSS side-effect imports are explicit
so frozen installs do not depend on accidental hoisting from vulnerable tools.

## 2026-07-11 — Import source fidelity before inferring design tokens

Token-less source applications are first captured as target-neutral observed
structure, exact computed layout, literal paint, typography, interaction
semantics, and hashed assets. Burl must reproduce that evidence without using a
product-specific theme or painter. Deterministic exact-value clustering may then
suggest token candidates; only reviewed candidates are promoted, and replacing
literals with token references must produce a pixel-identical render. Tokens
organize an already faithful import—they are not permitted to approximate or
invent the source appearance.

## 2026-07-11 — Gate full-screen Palot on reusable component fidelity

Full-screen Palot assembly is paused until Burl passes the hardened Phase B
component gate: a uniform VisualSkin channel, zero poison-theme leakage, exact
CSS Color 4 and inline-SVG handling, supported block-flow lowering, render-neutral
token promotion, and stateful visual/semantic tests for the eight representative
components. If a source capability cannot be represented, the importer emits a
named divergence rather than silently substituting Burl defaults. This is the
safest reversible path because any fix remains framework-generic and testable on
held-out content.

## 2026-07-12 — Keep one OpenCode transport lifecycle per application connection

The native client will keep one bundled sidecar, one owned OpenCode server, and
one global event subscription alive across project selection, session open or
create, prompt, cancellation, and retry. Project-scoped clients remain logical
views of that connection. This matches the reference application's
`connection-manager.ts`, which owns a single base connection and persistent SSE
loop while caching project clients; prompt cancellation calls `session.abort`
without tearing the connection down.

The rejected alternative was to spawn a sidecar and server for every prompt and
bound every SDK call independently. Per-call deadlines remain required as a
failure-containment layer, but they do not make repeated process startup the
correct lifecycle. Live evidence showed successive startup paths independently
stalling in health and project selection even after cancellation settlement.
Persistent ownership removes those avoidable transitions, preserves ordered
event continuity, and makes reconnect an explicit bounded recovery operation
rather than an incidental part of every user action.

Contract tests must prove: one server start for multiple prompts; cancel waits
for its acknowledgement without closing transport; retry uses the same session
and subscription; project switching does not spawn another server; explicit
disconnect and bounded transport failure are the only normal teardown paths.

## 2026-07-12 — Authored fluid CSS outranks observed pixel geometry

Responsive rectangle inference is fallback evidence, not a replacement for
authored layout semantics. When capture preserves a percentage or `auto` width,
percentage maximum, or authored edge dimension such as `margin-left: auto`, the
runtime keeps that value live in Yoga and resolves it against the current
containing block. Sampled responsive pixels may only supply an axis or edge
whose authored semantic value is absent.

This precedence rule fixes alignment and resize behavior at the framework
level. It rejects both consumer-side offsets and viewport-specific pixel
patches. A framework regression combines `width: 100%`, `max-width: 95%`, and
`margin-left: auto` with conflicting observed pixels and requires the authored
fluid result after resize; the Palot consumer separately exercises the same
contract through a real virtualized imported row.

## 2026-07-12 — Import application states as captured, pre-mounted variants

Interactive source states are captured after a declared action with the same
source revision, URL, clock, viewport, and host-service policy as their closed
state. The capture manifest stamps action ID, payload, event, and requiredness
onto the target before capture, so observed DOM and DesignIR carry the binding
without product-specific source-ID rules. Trusted input and semantic activation
remain distinguishable in the evidence through `Event.isTrusted`.

When a durable source node changes render properties between states, the
importer pre-mounts state-qualified native variants under the nearest stable
host and selects exactly one through Burl's application-state runtime. Source
identity remains available for binding and provenance while native anchor IDs
are state-qualified. A state named `default` is selected on first layout. This
avoids reconstructing view trees during a click and avoids synthetic theme or
setter-based approximations. Full responsive parity still requires a responsive
capture cohort for each state; a single-viewport state is candidate evidence,
not authority to replace the responsive canonical artifact.

Raw character data directly under an SVG element is discarded during safe SVG
canonicalization because SVG renders text only through text-bearing elements.
Executable elements, event attributes, external references, DTDs, and entities
remain rejected. This replaces Palot-specific SVG exclusions with a standards-
based normalization that applies to any captured application.

## 2026-07-13 — Preserve authored motion receipts instead of class-name inference

Source motion is captured from the live Web Animations API before the stable
screenshot policy disables animation. A fresh Palot Electron capture produced
four receipts, including the active-session spinner's authored `spin` timeline
(one-second, linear, infinite rotation). The observed-DOM adapter carries the
receipt as `observed_motion`; NativeDesignIR lowers the supported rotation to
generic motion attributes on the faithful inline-SVG node; and Burl's native
materializer ticks those attributes through its normal animation clock.

The importer must not infer animation from Tailwind class names such as
`animate-spin`: class names are neither computed behavior nor portable source
evidence. Unsupported keyframe properties remain explicit compatibility gaps.
The canonical Palot artifact is not promoted until a rebuilt application shows
different Skia frames for the spinner while the surrounding region remains
stable.

## 2026-07-13 — Derive vertical constraints only from real height slices

A used height observed once at a viewport width is not evidence of a fixed
height at that width. Vertical constraint variants are derived only from widths
that contain multiple captured heights. Sparse width-only samples may still
select horizontal breakpoints, but they cannot freeze an auto-height flex item
at the capture height. A terminal fixed segment that contradicts complete
auto-height plus flex-grow provenance is an import error, not a tolerated
approximation.

The regression matrix requires a fluid panel captured at 800 px high to grow by
exactly 100 px when its containing viewport changes from 1440 x 800 to 1440 x
900. This rule applies to any imported application and replaces consumer-side
resize offsets.

## 2026-07-13 — Resolve volatile capture prefixes through unique authored identity

Document and body shape hashes may change with root theme or platform state.
Binding policy identities first require an exact match; if none exists, import
may resolve the unique path suffix beginning at the first authored id,
data-slot, or data-testid segment. Zero matches and multiple matches both abort
generation. Collection endpoints, semantic-role bindings, SVG exclusions, and
action rules use the same resolver.

This keeps reviewed policies stable across non-semantic document-prefix changes
without weakening identity to labels, indexes, or application-specific aliases.

## 2026-07-13 — Make captured state transitions a framework-owned interaction contract

`pulpStateKey` and `pulpStateTransition` are typed import metadata, not
consumer-specific callback hints. Burl installs the transition on the
materialized native control after the consumer endpoint is bound, so the same
mechanism covers application actions and source-local disclosures. Supported
transitions are deterministic `set`, boolean `toggle`, and finite `cycle`;
incomplete, malformed, or ambiguous contracts fail closed. Programmatic action
invocation uses the same transition contract as pointer activation.

The rejected alternative was to toggle Palot booleans and call
`set_application_state` independently in each endpoint. That duplicates the
source state model, lets pointer and programmatic behavior diverge, and would
have to be repeated for every imported application. The production AppKit
interaction census now fails if a visible control merely receives pointer
down/up without a captured state transition, an application action, or a
verified native-local behavior; logging such controls is no longer a passing
result.

## 2026-07-13 — Validate transitions against captured state domains

Application-state action metadata must use the same key and value domain as the
captured variants it controls. A boolean `toggle` is valid only for the exact
`true`/`false` domain; named states such as `open`/`closed` use an explicit
`cycle:open,closed`, and `set:` values must exist in the captured domain. The
import generator rejects incomplete, conflicting, or out-of-domain policy
metadata before materialization.

This prevents a control from routing a click successfully while its state
transition silently fails. That mismatch was the root cause of the sidebar
toggle appearing clickable but leaving the imported UI unchanged. The rule is
generic and applies to every imported stateful control; no consumer callback is
allowed to compensate for an invalid state domain.

## 2026-07-13 — Treat runtime preferences as capture-cohort inputs

Source captures are comparable only when their explicitly seeded runtime state
matches. Viewport, revision, URL, and frozen clock are insufficient because
local or session storage can alter display mode, theme, density, and feature
state without changing any of those fields. The capture manifest therefore
accepts bounded string-only storage seeds only in a cleared isolated profile,
applies them before reload, and incorporates their canonical redacted digest
into the cohort identity. Credential-like keys, unbounded entries, and ambient
user storage fail closed and are never copied into evidence.

Responsive and interaction-state composition compares the stamped cohort hash
rather than reconstructing a partial list of fields. Two captures with different
preference values cannot be merged even if their pixels happen to look similar.
This replaces the accidental mixing of Palot `default` and `verbose` display
modes with a generic provenance rule for any imported application.

## 2026-07-13 — Measure both sides of structural responsive boundaries

A structural responsive branch is accepted only from captures that bracket its
exact boundary. Palot's source demonstrates why sparse representative widths
are not enough: its main-pane geometry changes at 599 to 600 px, and sidebar
presence changes at 767 to 768 px. The importer records the measured slices and
fails bounded structural branches that cannot be explained by the cohort.

Height-dependent child presence inside a persistent, explicitly scrollable ARIA
collection is classified as viewport windowing rather than a CSS structural
branch. That exception requires the same-width evidence, a stable collection
role, and a stable auto/scroll Y viewport; it does not apply to arbitrary nodes.
This keeps virtualized transcript rows from becoming false breakpoints while
leaving genuine structural changes fail-closed.

## 2026-07-13 — Derive turn actions only from OpenCode message identity

Imported transcript actions use OpenCode's real `message.updated` identities.
The user message id is the turn id; assistant rows inherit the user id from
`parentID`; part rows inherit it through their owning assistant message. The
next user message id is computed from ordered user messages. Synthetic row
indexes, visible labels, and generated fallback ids are not action payloads.

The terminal turn intentionally has no `turn.next-user-message-id`, so its
message-specific fork control is disabled by the generic missing-payload rule.
Scroll and undo keep their exact current-turn ids. The application manifest
does not yet promote these three actions: promotion waits for a freshly
generated source IR and native pointer/keyboard dispatch evidence using the
projected runtime values. This preserves a fail-closed public contract while
the consumer and framework implementation are exercised independently.

## 2026-07-13 — Keep layout provenance property-scoped and capture receipts explicit

Observed layout lowering now records matched-style receipts separately for
width, height, minimum/maximum size, and each margin edge. CSS Typed OM remains
the post-cascade winner; matched rule order is evidence, never a substitute for
the cascade. The real Palot Settings capture proves the distinction: the
`General` label has an observed 54.4375 px rectangle while its winning authored
width is `auto`, so native lowering correctly omits a fixed width. Rewriting
that observed geometry as authored width would freeze one viewport and is
rejected.

The capture is pinned by hashes in
`evidence/phase-b/layout-property-provenance.v1.json`. Canonical IR promotion
remains prohibited until the guarded promotion gates accept this evidence.

Transparent-window screenshots follow the same evidence rule. A deterministic
CI image uses Burl's framework-owned synthetic backdrop and actual Dawn/Skia
backbuffer. A live macOS Liquid Glass image is a distinct, environment-dependent
WindowServer surface. AppKit view-cache or raw-backbuffer fallbacks are useful
diagnostics but cannot be called a system composite or a visual-parity pass.

## 2026-07-15 — Treat exact A/B failures as SDK contract defects

Broad regional pixel similarity cannot certify an imported application. The
acceptance harness now pairs source and native nodes by captured identity,
retains duplicate candidates rather than overwriting them, compares exact
geometry, and verifies that actionable nodes own hit regions intersecting their
effective clip and viewport. Identity duplication, geometry drift, paint drift,
and missing actionability are separate failures. This prevents a correctly
positioned duplicate from hiding corrupted repeated-row identity and prevents a
clipped or offscreen rectangle from counting as a usable target.

The same rule applies to missing CSS mappings. Palot's clean Electron runtime
reports `corner-shape: superellipse(1.5)` on the sidebar inset. Burl therefore
captures `corner-shape` as computed style, lowers the supported circular and
continuous equivalence classes into typed and native IR, and selects the SDK's
Skia border-curve path. Unsupported corner families produce an explicit
diagnostic. No source selector, Palot component name, or screenshot coordinate
participates in that mapping.

## 2026-07-15 — Preserve authored responsive geometry and explicit interaction identity

Observed used pixels are evidence, not a replacement for authored responsive
constraints. Block-flow lowering and application-state composition must retain
winning authored relative values such as `width: 100%`, `margin: auto`, and
single-edge auto margins. Replaying a captured pixel width or resolved auto
margin at another viewport is forbidden because it freezes one observation
into every responsive state. Two-width regressions cover centered and
trailing-auto layouts, and the responsive census must bracket each structural
boundary before a candidate can be promoted.

Trusted interaction evidence follows the same explicit-identity rule. Capture
manifests bind a scenario to its action id; the recorder preserves that binding
and scenario id, and composition joins trusted pointer or keyboard events only
through that declaration. Labels, selectors, and event-target text never infer
an action identity. Events whose composed path does not include the intended
target are excluded rather than used as activation proof.

Stateful visual promotion also preserves authored geometry. When a control's
interaction variants change only paint, its rest skin inherits the imported
per-corner radii, including explicit zero-valued corners. Otherwise first/last
segmented controls can be rounded at rest yet become square when selected.
This rule is implemented and tested in Burl's generic materializer; the Palot
consumer contains no compensating radius or selector override.

## 2026-07-15 — Classify Electron services separately from product IPC

Electron observations are not CSS properties and must not be treated as a
browser-emulation checklist. Reusable window and platform capabilities are
classified against portable Burl services and native backends; Chromium-only
objects are explicit unsupported entries; absent platform services remain
explicit gaps. Literal application IPC channels stay consumer protocol and
cannot be promoted by channel-name heuristics or a generic string dispatcher.

The first validated route is file selection: imported intent reaches the
WidgetBridge dialog API, then Burl's portable `FileDialog`, then the native
macOS panel backend. All four operations (`open_file`, `open_files`,
`save_file`, and `choose_folder`) honor an installed backend and invoke copied
callbacks after releasing the backend mutex. This is reusable SDK behavior,
not a Palot adapter.
