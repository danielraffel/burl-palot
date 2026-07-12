# Palot source-to-native visual parity

Reference: the unmodified Palot source at `fd63a75dad3d0e8555ba22a47e720d285889fbf0`, built with Bun/Electron and opened on its deterministic `?mock=1` dark-mode session fixture. Both reference and native captures use a 1200 x 800 logical viewport and 2400 x 1600 Retina pixels.

## Substantially closed structural gaps

1. The native shell now uses the source's 280 px sidebar and 46 px app bar.
2. Window controls, wordmark, breadcrumb, session title, and right-side status metrics occupy the same header bands.
3. Sidebar information architecture matches New Session, Automations, Active Now, Recent, Projects, machine, and Settings sections.
4. The transcript is centered in the same 896 px maximum-width column.
5. Assistant messages are unboxed; only user messages use the right-aligned 95% secondary bubble.
6. Turn spacing and the captured viewport align the reasoning, response, metadata, follow-up, and streaming rows.
7. The composer matches the source's position, dimensions, 12 px radius, border, placeholder, toolbar, and status pill.
8. Burl's neutral Markdown API now permits the source-equivalent 13 px, weight-300 Inter body treatment while preserving inline emphasis and code semantics.
9. Sidebar and surface colors use the measured opaque dark-source palette instead of the prior navy application mock.
10. The native capture remains C++/Yoga/Skia Graphite/Dawn/Metal; no WebView or Chromium code was introduced.
11. A deterministic screenshot harness now emits normalized inputs, montage, heatmap, overlay, hashes, MAE, RMSE, PSNR, SSIM, and changed-pixel counts for every pass.

## Current measured pass

Pass 09 uses a fresh source capture from the detached reference worktree and the native GPU back buffer at identical 1200 x 800 logical / 2400 x 1600 physical dimensions. Its durable artifacts are in `pass-09-provenance-auto/`. The result is SSIM `0.258545926`, MAE `14.048430`, and `7.344844%` pixels above the 16-channel threshold. Compared with pass 08 (`0.197067161` SSIM and `10.958333%` changed pixels), structural similarity improved by 31.2% and the changed-pixel area fell by 33.0%.

This pass also proves that exhaustive, selector-scoped authored-style receipts can distinguish CSS initial `width:auto` from omitted provenance. The native app-bar title now paints in full, while unqueried nodes retain observed geometry. Twelve of twelve consumer tests pass, including responsive geometry, the production interaction census, accessibility, and exact app-bar paint text.

## Pass 09 eleven-gap queue

1. Transcript vertical origin is too high; the source leaves a larger gap below the app bar before the first user bubble.
2. Native transcript body glyphs are visibly larger/heavier than the captured 13 px source treatment, changing density and wrap points.
3. Tool rows are taller than the source and have excessive vertical padding.
4. Tool subjects and durations use incorrect muted opacity/weight, and duration alignment differs from the source.
5. The assistant Markdown response consumes too much vertical space because line boxes and paragraph margins are too large.
6. Inline-code pills are taller and wider than the source, with different baseline and horizontal padding.
7. The second user bubble and subsequent reasoning/tool rows occur lower than the source because cumulative transcript spacing is too large.
8. The composer is too tall and begins too low; its toolbar/status row is consequently displaced.
9. Sidebar labels use heavier/wider glyph metrics and truncate sooner than the source, especially New Session, Automations, and footer labels.
10. Several Lucide glyphs still differ in stroke geometry or optical centering, including the sidebar toggle, tool icons, and footer controls.
11. Scrollbar styling, hover/pressed/focus animation captures, and deterministic transparent-window compositing still need state-matched screenshot gates.

Pixel identity is not yet claimed. The queue remains open until each region passes its geometry, interaction, and visual oracle rather than merely improving the global score. Functional controls remain native widgets; static painting is limited to non-interactive chrome and fixture content.

The real native OpenCode path was separately exercised after the visual fixture and returned exactly `REAL VISUAL PARITY OK`.
