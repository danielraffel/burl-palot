# Consumer and Electron baseline

## Provenance

- Consumer seed: Palot commit `fd63a75dad3d0e8555ba22a47e720d285889fbf0`.
- Original source remote: `palot-upstream` points to
  `git@github.com:ItsWendell/palot.git`.
- Palot's MIT [`LICENSE`](../LICENSE) and
  [`THIRD-PARTY-NOTICES.md`](../THIRD-PARTY-NOTICES.md) remain intact.
- The existing `apps/desktop` Electron application remains in place and its
  package identity, main process, preload bridge, and renderer behavior are not
  changed by the Burl consumer bootstrap.
- The Burl consumer is parallel code under `apps/desktop-burl` and pins the
  framework by a full Git commit in `burl.lock.json`.

## Reproduce the source baseline

Run from the repository root:

```sh
./scripts/verify-consumer-baseline.sh
./scripts/capture-electron-baseline.sh
```

The first command is dependency-free. The second writes a timestamped JSON
artifact under `benchmarks/electron/`. It always records source and artifact
sizes. When a packaged application exists, it also records bundle bytes and
Chromium Framework bytes.

## Reproduce the Electron behavior reference

The project currently requires Bun 1.3.8. On a machine with Bun installed:

```sh
bun install --frozen-lockfile
bun run lint
bun run check-types
cd apps/desktop
bun run build
CSC_IDENTITY_AUTO_DISCOVERY=false bun run package:mac:arm64
```

Launch the resulting `release/mac-arm64/Palot.app`, then execute the fixture
protocol in [`fixtures/behavior/README.md`](../fixtures/behavior/README.md).
Capture the same protocol for the Burl application; fixture names and expected
outcomes are host-neutral.

## Initial source metrics

The checked-in seed contains the following dependency-free baseline, captured
on 2026-07-11:

| Metric | Value |
|---|---:|
| Palot seed commit | `fd63a75d` |
| tracked `apps/desktop` source bytes | 2,468,985 |
| Electron version | `40.2.1` |
| Renderer | React 19 through Electron/Chromium |
| unsigned ARM64 `.app` bytes | 699,404,288 |
| bundled Electron Framework bytes | 269,185,024 |

The unsigned ARM64 application was built and launched successfully on the
capture host; its process remained alive after five seconds and was then
terminated. Startup timing, resident memory, time-to-interactive, and
interaction latency are intentionally not guessed and remain for the
instrumented benchmark lane.
