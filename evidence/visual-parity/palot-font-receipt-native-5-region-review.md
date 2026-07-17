# Palot 1200x800 region parity review

Verdict: `needs_work`

This pass compares the canonical Electron capture at
`/tmp/palot-canonical-height/1200x800/source.png` with the native Burl capture
at `/tmp/palot-font-receipt-native-5.png`. Both inputs are exactly 2400x1600
physical pixels (1200x800 logical points at 2x); no resizing or registration
was applied. The exact inputs are pinned by SHA-256 in
`palot-font-receipt-native-5-region-diff.json`.

The region contract is `palot-1200x800-regions.json`. Scores come from the
repository's `diff_against_reference_regions.py`: 40% RGB histogram cosine
similarity plus 60% corresponding-pixel similarity. Mean RGB L2 is also
reported in the machine-readable result so a low histogram score cannot hide
otherwise close pixels.

| Rank by score | Region | Score | Histogram | Pixel similarity | Mean RGB L2 | Gate |
|---:|---|---:|---:|---:|---:|---:|
| 1 | status button | 0.5552 | 0.6212 | 0.5112 | 215.94 | 0.90, fail |
| 2 | left sidebar | 0.5745 | 0.0003 | 0.9573 | 18.86 | 0.90, fail |
| 3 | composer | 0.5877 | 0.0255 | 0.9625 | 16.56 | 0.88, fail |
| 4 | top bar | 0.7438 | 0.4413 | 0.9454 | 24.12 | 0.90, fail |

## Ranked remaining mismatches

1. **The imported main-panel bottom/right inset displaces the composer and
   status button.** Electron's composer frame is `(296, 647.5, 887, 112)` in
   logical points; Burl's is `(296, 636, 875, 112)`. Burl is 11.5 points too
   high and 12 points too narrow. The Electron status button is
   `(1091.234, 722.5, 80.766, 24)` while Burl is `(1079, 711, 81, 24)`: the
   size matches to rounding, but the inherited placement is about 12 points
   left and 11.5 points high. This explains the status region's very large
   corresponding-pixel error. Fix the parent responsive/inset constraints;
   do not tune the button dimensions.
2. **Sidebar paint is not source-faithful despite close geometry.** Its pixel
   similarity is 0.9573 but histogram similarity is effectively zero. The
   major visible cause is Burl's flatter near-black surface versus Electron's
   translucent/gradient sidebar treatment, followed by text/icon tone and
   weight differences. Navigation rows and section positions are broadly
   aligned, so this belongs in captured paint/effect materialization rather
   than Palot coordinates.
3. **Composer paint and internal control spacing remain different.** Beyond
   the parent displacement, Electron uses a lighter input surface/border and
   subtler footer tones. Burl's controls have heavier/brighter glyphs and
   separators. The model label is now correctly one line, so remaining work is
   imported paint, baseline, gap, and border treatment rather than another
   font-width exception.
4. **Top-bar color distribution and typography still diverge.** Header text
   anchors are nearly exact (Electron `palot` x=357.234 and title x=403.547;
   Burl x=357 and x=403), but Burl's background, icon/text tones, and some
   glyph widths/weights differ. The low histogram score with 0.9454 pixel
   similarity points to skin/typography receipt fidelity, not a wholesale
   toolbar layout failure.
5. **The compared conversation states are not identical.** Electron has the
   third Edit tool card expanded while this native capture has it collapsed.
   That does not directly enter the four selected regions except through
   surrounding paint, but future full-frame parity gates must replay the same
   interaction state before treating global scores as architectural evidence.

## Reproduction

```sh
python3 tools/import-validation/diff_against_reference_regions.py \
  /tmp/palot-canonical-height/1200x800/source.png \
  /tmp/palot-font-receipt-native-5.png \
  --regions evidence/visual-parity/palot-1200x800-regions.json \
  --json
```

No implementation was changed during this review.
