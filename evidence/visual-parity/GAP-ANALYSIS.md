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

## Quantitative result and residual gaps

The initial structural mock scored SSIM `0.088831116` with MAE `13.229267`. At exact consumer head `f659028`, after the shell, functional-control, fixture, composer, and typography passes, the matched native fixture scores SSIM `0.197067161`, MAE `13.298452`, and `10.958333%` pixels above the 16-channel threshold. SSIM more than doubled while MAE remained effectively flat; this is substantial structural convergence, not pixel identity.

Residual differences remain in renderer-specific glyph antialiasing, exact Lucide icon shapes, selected-session copy, muted metadata color, rich inline-code backgrounds, scrollbar styling, and some transcript wrapping. Chromium/CoreText and Skia will not produce byte-identical glyph pixels, so the raw metrics are retained as an honest regression signal rather than described as equality. The functional native controls remain real widgets: New Session, project chooser, session ID/Open, provider, model, Send, and Cancel are visible and operable; static painting is limited to non-interactive chrome and fixture content.

The real native OpenCode path was separately exercised after the visual fixture and returned exactly `NATIVE VISUAL PALOT OK`.
