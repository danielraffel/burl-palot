# Visual parity screenshot harness

`scripts/compare-screenshots.py` normalizes a reference build screenshot and a
native Burl screenshot to the same viewport, then emits a byte-repeatable
montage, diff heatmap, diff overlay, and JSON metrics.

The harness requires Python 3 with Pillow and NumPy. Both are present in the
Palot development environment; install them with `python3 -m pip install
pillow numpy` in a fresh environment.

Capture both windows at the same logical size and UI state. Prefer window-layer
captures so desktop wallpaper, shadows, and transparency do not become false
differences. Then run:

```sh
python3 scripts/compare-screenshots.py \
  evidence/visual-parity/reference.png \
  evidence/visual-parity/native.png \
  --output evidence/visual-parity/comparison \
  --width 1200 --height 800 --fit cover --threshold 16
```

If title bars or capture padding differ, crop each input before normalization:

```sh
  --reference-crop 0,28,1200,828 --candidate-crop 0,28,1200,828
```

The output directory contains:

- `reference-normalized.png` and `candidate-normalized.png`, the exact pixels
  used by the comparison;
- `montage.png`, reference on the left and native on the right;
- `diff-heatmap.png`, where black is identical and red/yellow/white represent
  progressively larger channel differences;
- `diff-overlay.png`, magenta differences over the reference;
- `metrics.json`, including input and artifact hashes, MAE, RMSE, PSNR, global
  SSIM, maximum channel delta, and thresholded different-pixel percentage.

Use `--max-different-percent N` in automation. The tool still writes all
evidence, then exits 2 when the threshold is exceeded. Keep crop, dimensions,
fit mode, pixel threshold, app state, font scale, display scale, and color
scheme fixed across every iteration so metric movement reflects UI changes.
