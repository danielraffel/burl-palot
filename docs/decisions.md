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
