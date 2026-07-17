import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "evidence/visual-parity/scenarios.v1.json"
SPEC = importlib.util.spec_from_file_location("visual_scenario", ROOT / "scripts/run-visual-scenario.py")
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader
SPEC.loader.exec_module(MODULE)


class VisualScenarioRunnerTests(unittest.TestCase):
    def test_manifest_has_ordered_eleven_passes_and_strict_geometry(self):
        manifest = MODULE.load_manifest(MANIFEST)
        self.assertEqual(len(manifest["scenarios"]), 11)
        self.assertEqual(manifest["captureDefaults"]["resizePolicy"], "reject")
        self.assertEqual(manifest["captureDefaults"]["logicalWidth"], 1200)
        self.assertEqual(manifest["captureDefaults"]["logicalHeight"], 800)
        self.assertEqual(manifest["captureDefaults"]["pixelWidth"], 2400)
        self.assertEqual(manifest["captureDefaults"]["pixelHeight"], 1600)

    def test_source_plan_is_canonical_and_frozen(self):
        manifest = MODULE.load_manifest(MANIFEST)
        first = MODULE.canonical(MODULE.source_bootstrap(manifest))
        second = MODULE.canonical(MODULE.source_bootstrap(manifest))
        self.assertEqual(first, second)
        self.assertIn("2026-07-11T20:00:00.000Z", first)
        self.assertIn("ses-mock-darkmode-001", first)

    def test_metrics_are_deterministic_and_exact_geometry_is_required(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            black = root / "black.png"
            white = root / "white.png"
            Image.new("RGB", (2400, 1600), (0, 0, 0)).save(black)
            Image.new("RGB", (2400, 1600), (255, 255, 255)).save(white)
            expected = {"pixelWidth": 2400, "pixelHeight": 1600}
            a = MODULE.read_image(black, expected)
            b = MODULE.read_image(white, expected)
            self.assertEqual(MODULE.metrics(a, b, 16), MODULE.metrics(a, b, 16))
            self.assertEqual(MODULE.metrics(a, b, 16)["differentPixelPercent"], 100.0)

            wrong = root / "wrong.png"
            Image.new("RGB", (1200, 800), (0, 0, 0)).save(wrong)
            with self.assertRaisesRegex(ValueError, "expected exact pixels"):
                MODULE.read_image(wrong, expected)

    def test_semantic_paths_fail_closed(self):
        self.assertEqual(MODULE.lookup({"composer": {"focused": True}}, "composer.focused"), True)
        with self.assertRaisesRegex(ValueError, "semantic path missing"):
            MODULE.lookup({"composer": {}}, "composer.focused")

    def test_full_result_is_byte_deterministic(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            reference = root / "reference.png"
            candidate = root / "candidate.png"
            Image.new("RGB", (2400, 1600), (20, 20, 20)).save(reference)
            Image.new("RGB", (2400, 1600), (21, 20, 20)).save(candidate)
            common = {
                "logicalWidth": 1200,
                "logicalHeight": 800,
                "pixelWidth": 2400,
                "pixelHeight": 1600,
                "deviceScaleFactor": 2,
                "boundary": "content",
                "clock": "2026-07-11T20:00:00.000Z",
                "route": "#/project/palot-proj-a1b2c3d/session/ses-mock-darkmode-001?mock=1",
                "captureMethod": "backbuffer",
                "osBuild": "test",
            }
            source_meta = root / "source-meta.json"
            native_meta = root / "native-meta.json"
            source_meta.write_text(json.dumps({**common, "lane": "source", "revision": "fd63a75dad3d0e8555ba22a47e720d285889fbf0"}))
            native_meta.write_text(json.dumps({**common, "lane": "native", "revision": "0" * 40}))
            semantics = {"route": "session", "sidebar": {"visible": True}}
            source_semantics = root / "source-semantics.json"
            native_semantics = root / "native-semantics.json"
            source_semantics.write_text(json.dumps(semantics))
            native_semantics.write_text(json.dumps(semantics))
            first, second = root / "first.json", root / "second.json"
            base = [
                sys.executable, str(ROOT / "scripts/run-visual-scenario.py"),
                "--manifest", str(MANIFEST), "--scenario", "01-shell",
                "--reference", str(reference), "--candidate", str(candidate),
                "--reference-meta", str(source_meta), "--candidate-meta", str(native_meta),
                "--reference-semantics", str(source_semantics),
                "--candidate-semantics", str(native_semantics),
            ]
            subprocess.run([*base, "--output", str(first)], check=True, capture_output=True)
            subprocess.run([*base, "--output", str(second)], check=True, capture_output=True)
            self.assertEqual(first.read_bytes(), second.read_bytes())


if __name__ == "__main__":
    unittest.main()
