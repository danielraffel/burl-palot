import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "compare-screenshots.py"


def run_compare(tmp_path: Path, reference: Path, candidate: Path, *extra: str):
    output = tmp_path / "output"
    result = subprocess.run(
        [sys.executable, str(SCRIPT), str(reference), str(candidate), "--output", str(output), *extra],
        check=False,
        capture_output=True,
        text=True,
    )
    return result, output


class CompareScreenshotTests(unittest.TestCase):
    def test_identical_images_have_zero_delta(self):
        with tempfile.TemporaryDirectory() as directory:
            tmp_path = Path(directory)
            image = Image.new("RGB", (12, 8), (20, 40, 60))
            reference = tmp_path / "reference.png"
            candidate = tmp_path / "candidate.png"
            image.save(reference)
            image.save(candidate)

            result, output = run_compare(tmp_path, reference, candidate)

            self.assertEqual(result.returncode, 0, result.stderr)
            metrics = json.loads((output / "metrics.json").read_text())
            self.assertEqual(metrics["metrics"]["differentPixels"], 0)
            self.assertEqual(metrics["metrics"]["meanAbsoluteError"], 0)
            self.assertEqual(metrics["metrics"]["globalSsim"], 1)
            with Image.open(output / "montage.png") as montage:
                self.assertEqual(montage.size, (24, 8))

    def test_threshold_gate_and_dimension_normalization(self):
        with tempfile.TemporaryDirectory() as directory:
            tmp_path = Path(directory)
            reference = tmp_path / "reference.png"
            candidate = tmp_path / "candidate.png"
            Image.new("RGB", (10, 10), (0, 0, 0)).save(reference)
            Image.new("RGB", (5, 5), (255, 255, 255)).save(candidate)

            result, output = run_compare(
                tmp_path,
                reference,
                candidate,
                "--width",
                "20",
                "--height",
                "12",
                "--max-different-percent",
                "99",
            )

            self.assertEqual(result.returncode, 2)
            metrics = json.loads((output / "metrics.json").read_text())
            self.assertEqual(metrics["comparison"]["width"], 20)
            self.assertEqual(metrics["comparison"]["height"], 12)
            self.assertEqual(metrics["metrics"]["differentPixelPercent"], 100)
            with Image.open(output / "diff-heatmap.png") as heatmap:
                self.assertEqual(heatmap.size, (20, 12))


if __name__ == "__main__":
    unittest.main()
