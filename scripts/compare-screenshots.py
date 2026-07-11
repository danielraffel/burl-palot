#!/usr/bin/env python3
"""Create deterministic visual-parity evidence from two screenshots."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path

import numpy as np
from PIL import Image, ImageChops, ImageOps


def parse_box(value: str) -> tuple[int, int, int, int]:
    fields = tuple(int(field) for field in value.split(","))
    if len(fields) != 4 or fields[2] <= fields[0] or fields[3] <= fields[1]:
        raise argparse.ArgumentTypeError("crop must be left,top,right,bottom")
    return fields


def load(path: Path, crop: tuple[int, int, int, int] | None) -> Image.Image:
    with Image.open(path) as source:
        image = ImageOps.exif_transpose(source).convert("RGB")
    if crop:
        image = image.crop(crop)
    return image


def normalize(image: Image.Image, size: tuple[int, int], fit: str) -> Image.Image:
    if fit == "stretch":
        return image.resize(size, Image.Resampling.LANCZOS)
    if fit == "cover":
        return ImageOps.fit(image, size, Image.Resampling.LANCZOS, centering=(0.5, 0.5))
    return ImageOps.pad(
        image, size, Image.Resampling.LANCZOS, color=(0, 0, 0), centering=(0.5, 0.5)
    )


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def save(image: Image.Image, path: Path) -> None:
    # Fixed encoder inputs keep identical pixels byte-identical across repeated runs.
    image.save(path, format="PNG", optimize=False, compress_level=9)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("reference", type=Path)
    parser.add_argument("candidate", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--width", type=int, help="comparison width; defaults to reference")
    parser.add_argument("--height", type=int, help="comparison height; defaults to reference")
    parser.add_argument("--fit", choices=("contain", "cover", "stretch"), default="cover")
    parser.add_argument("--reference-crop", type=parse_box)
    parser.add_argument("--candidate-crop", type=parse_box)
    parser.add_argument("--threshold", type=int, default=16, help="different-pixel RGB threshold")
    parser.add_argument("--max-different-percent", type=float)
    args = parser.parse_args()

    if args.threshold < 0 or args.threshold > 255:
        parser.error("--threshold must be in [0, 255]")
    if (args.width is None) != (args.height is None):
        parser.error("--width and --height must be supplied together")

    reference_source = load(args.reference, args.reference_crop)
    candidate_source = load(args.candidate, args.candidate_crop)
    size = (args.width, args.height) if args.width else reference_source.size
    if size[0] <= 0 or size[1] <= 0:
        parser.error("comparison dimensions must be positive")

    output = args.output
    output.mkdir(parents=True, exist_ok=True)
    reference = normalize(reference_source, size, args.fit)
    candidate = normalize(candidate_source, size, args.fit)

    reference_path = output / "reference-normalized.png"
    candidate_path = output / "candidate-normalized.png"
    montage_path = output / "montage.png"
    heatmap_path = output / "diff-heatmap.png"
    overlay_path = output / "diff-overlay.png"
    metrics_path = output / "metrics.json"
    save(reference, reference_path)
    save(candidate, candidate_path)

    montage = Image.new("RGB", (size[0] * 2, size[1]))
    montage.paste(reference, (0, 0))
    montage.paste(candidate, (size[0], 0))
    save(montage, montage_path)

    ref = np.asarray(reference, dtype=np.float32)
    cand = np.asarray(candidate, dtype=np.float32)
    delta = np.abs(ref - cand)
    magnitude = delta.max(axis=2)
    different = magnitude > args.threshold
    mae = float(delta.mean())
    mse = float(np.square(ref - cand).mean())
    rmse = math.sqrt(mse)
    psnr = math.inf if mse == 0 else 20.0 * math.log10(255.0 / rmse)

    # A compact global SSIM is stable and dependency-free. Values range from -1 to 1.
    ref_luma = 0.2126 * ref[:, :, 0] + 0.7152 * ref[:, :, 1] + 0.0722 * ref[:, :, 2]
    cand_luma = 0.2126 * cand[:, :, 0] + 0.7152 * cand[:, :, 1] + 0.0722 * cand[:, :, 2]
    mean_ref, mean_cand = float(ref_luma.mean()), float(cand_luma.mean())
    var_ref, var_cand = float(ref_luma.var()), float(cand_luma.var())
    covariance = float(((ref_luma - mean_ref) * (cand_luma - mean_cand)).mean())
    c1, c2 = (0.01 * 255) ** 2, (0.03 * 255) ** 2
    ssim = ((2 * mean_ref * mean_cand + c1) * (2 * covariance + c2)) / (
        (mean_ref**2 + mean_cand**2 + c1) * (var_ref + var_cand + c2)
    )

    strength = np.clip(magnitude / 255.0, 0.0, 1.0)
    heat = np.zeros((*strength.shape, 3), dtype=np.uint8)
    heat[:, :, 0] = np.round(255 * np.minimum(1.0, strength * 3)).astype(np.uint8)
    heat[:, :, 1] = np.round(255 * np.clip(strength * 3 - 1, 0, 1)).astype(np.uint8)
    heat[:, :, 2] = np.round(255 * np.clip(strength * 3 - 2, 0, 1)).astype(np.uint8)
    save(Image.fromarray(heat), heatmap_path)

    tint = Image.new("RGB", size, (255, 0, 255))
    mask = Image.fromarray(np.round(strength * 180).astype(np.uint8))
    save(Image.composite(tint, reference, mask), overlay_path)

    different_pixels = int(different.sum())
    total_pixels = size[0] * size[1]
    different_percent = 100.0 * different_pixels / total_pixels
    metrics = {
        "schemaVersion": 1,
        "comparison": {
            "width": size[0],
            "height": size[1],
            "fit": args.fit,
            "threshold": args.threshold,
            "referenceCrop": args.reference_crop,
            "candidateCrop": args.candidate_crop,
        },
        "metrics": {
            "meanAbsoluteError": round(mae, 6),
            "rootMeanSquareError": round(rmse, 6),
            "peakSignalToNoiseRatioDb": "infinity" if math.isinf(psnr) else round(psnr, 6),
            "globalSsim": round(ssim, 9),
            "differentPixels": different_pixels,
            "differentPixelPercent": round(different_percent, 6),
            "maximumChannelDelta": int(delta.max()),
        },
        "inputs": {
            "reference": str(args.reference.resolve()),
            "candidate": str(args.candidate.resolve()),
            "referenceSha256": sha256(args.reference),
            "candidateSha256": sha256(args.candidate),
        },
        "artifacts": {
            path.name: sha256(path)
            for path in (reference_path, candidate_path, montage_path, heatmap_path, overlay_path)
        },
    }
    metrics_path.write_text(json.dumps(metrics, indent=2, sort_keys=True) + "\n")
    print(metrics_path)

    if args.max_different_percent is not None and different_percent > args.max_different_percent:
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
