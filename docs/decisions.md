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
`v0.1.0-alpha.2` (`2cbc47f3a687caa04a8910269f09d02756e5ba08`). CMake may use an explicit absolute `BURL_SOURCE_DIR` only for
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
