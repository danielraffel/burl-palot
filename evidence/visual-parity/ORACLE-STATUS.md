# Palot generic visual-oracle status

This directory applies Burl's `pulp-visual-parity-manifest-v1` contract to all
eleven Palot scenarios without declaring the current application visually
complete.

The gate order is deliberate:

1. Every computed property/value and behavior class used by the independently
   captured source must have an exact supported, lowered, platform, or
   unsupported decision.
2. A positive decision must resolve exact evidence IDs through Burl's ownership
   registry, with matching route, repository, endpoint, artifact, and command.
3. The scenario must have a state-correct source/native capture pair.
4. The generic visual manifest gate then checks hashes, geometry, DPR, backend,
   fonts, freshness, calibration, policy lock, and every critical region.

Current result: **GAP**. The capability prerequisite stops at the first observed
value, `alignContent=normal`, because no resolving route/evidence decision has
yet been published. This is intentional; screenshot similarity cannot establish
property semantics.

An isolated run of the `01-shell` image gate also fails honestly:

- source and candidate font identities differ (`Inter Variable` versus the
  current native `.AppleSystemUIFont / SFNS` identity);
- the full critical region scores `0.91068593`, below the locked `0.95` minimum.

There are state-correct resting-screen pairs for scenarios 01 and 03–07. The
following remain explicit pre-image gaps:

- 02: no matched Electron/native window-layer capture;
- 08: no matched native focus, typed text, selection, and IME capture;
- 09: no matched stable-scroll-anchor capture;
- 10: no matched 760 px and 600 px source/native captures;
- 11: a real native OpenCode screenshot exists, but no state-matched Electron
  streamed transcript capture exists.

No masks are present. No aggregate score can waive a critical region. The two
fresh native calibration captures are byte-identical; the two existing source
captures measure `0.9560427543049747` repeat similarity, which bounds the locked
minimum rather than weakening it after seeing native output.

Run locally against the reviewed Burl worktree:

```sh
BURL_SOURCE_DIR=/absolute/path/to/burl bun run gate:visual-oracle
```
