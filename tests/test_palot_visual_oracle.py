import hashlib
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
INDEX = ROOT / "evidence/visual-parity/oracle-index.v1.json"
SCRIPT = ROOT / "scripts/run-palot-visual-oracle.py"
SPEC = importlib.util.spec_from_file_location("palot_visual_oracle", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(MODULE)


def sha256(path: Path) -> str:
	return hashlib.sha256(path.read_bytes()).hexdigest()


def canonical_hash(value: object) -> str:
	encoded = json.dumps(value, sort_keys=True, separators=(",", ":")).encode()
	return hashlib.sha256(encoded).hexdigest()


class PalotVisualOracleTests(unittest.TestCase):
	def test_index_has_ordered_eleven_manifests_and_honest_state_gaps(self):
		index = json.loads(INDEX.read_text())
		self.assertEqual(index["schema"], "palot-visual-oracle-index-v1")
		self.assertEqual(len(index["scenarios"]), 11)
		self.assertEqual([entry["id"][:2] for entry in index["scenarios"]],
			[f"{number:02d}" for number in range(1, 12)])
		gaps = {entry["id"] for entry in index["scenarios"] if entry["stateEvidence"] == "gap"}
		self.assertEqual(gaps, {
			"02-window-chrome", "08-composer-editing", "09-scroll-anchor",
			"10-responsive-contract", "11-live-stream",
		})

	def test_every_manifest_pins_artifacts_fonts_and_locked_regions(self):
		index = json.loads(INDEX.read_text())
		for entry in index["scenarios"]:
			path = ROOT / entry["manifest"]
			manifest = json.loads(path.read_text())
			self.assertEqual(manifest["schema"], "pulp-visual-parity-manifest-v1")
			self.assertEqual(manifest["source"]["dpr"], 2)
			self.assertEqual(manifest["candidate"]["dpr"], 2)
			self.assertEqual(manifest["candidate"]["backend"], "skia-dawn-metal")
			self.assertEqual(manifest["masks"], [])
			for artifact in [manifest["source"], manifest["candidate"],
				*manifest["calibration"]["source_repeats"],
				*manifest["calibration"]["candidate_repeats"]]:
				artifact_path = path.parent / artifact["path"]
				self.assertTrue(artifact_path.is_file())
				self.assertEqual(sha256(artifact_path), artifact["sha256"])
				for font in artifact["fonts"]:
					font_path = path.parent / font["path"]
					self.assertEqual(sha256(font_path), font["sha256"])
			policy = {"thresholds": manifest["thresholds"],
				"critical_regions": manifest["critical_regions"], "masks": manifest["masks"]}
			self.assertEqual(canonical_hash(policy), manifest["threshold_approval"]["policy_sha256"])
			self.assertTrue(all(region["minimum_pixel_similarity"] >= 0.95
				for region in manifest["critical_regions"]))

	def test_capability_coverage_is_complete_and_currently_fails_before_images(self):
		index = json.loads(INDEX.read_text())
		coverage_path = ROOT / index["capabilityCoverage"]
		coverage = json.loads(coverage_path.read_text())
		semantics = ROOT / coverage["sourceSemantics"]
		self.assertEqual(sha256(semantics), coverage["sourceSemanticsSha256"])
		self.assertEqual(
			set(MODULE.computed_property_values(semantics)),
			{record["name"] for record in coverage["computedProperties"]},
		)
		with tempfile.TemporaryDirectory() as directory:
			burl = Path(directory)
			registry = burl / "tools/import-design/catalogs/compat-evidence-index.json"
			registry.parent.mkdir(parents=True)
			registry.write_text(json.dumps({"schema": "pulp-compat-evidence-index-v1", "entries": {}}))
			failure = MODULE.coverage_failure(ROOT, coverage_path, burl)
		self.assertEqual(
			failure,
			"capability prerequisite failed: alignContent=normal [display=block]: "
			"unknown evidence ID semantic:observed-dom-align-content-normal-context",
		)

	def test_arbitrary_evidence_id_does_not_resolve(self):
		failure = MODULE.resolve_evidence(
			ROOT,
			"visual:invented", "invented route", {},
		)
		self.assertEqual(failure, "unknown evidence ID visual:invented")

	def test_first_critical_region_is_reported_in_manifest_order(self):
		manifest = {"critical_regions": [{"name": "first"}, {"name": "second"}]}
		result = {"regions": {
			"first": {"passed": False}, "second": {"passed": False},
		}}
		self.assertEqual(MODULE.first_region_failure(manifest, result), "first")

	def test_checked_in_results_do_not_promote_any_current_gap(self):
		results = json.loads((ROOT / "evidence/visual-parity/oracle-current-results.v1.json").read_text())
		self.assertFalse(results["capabilityPrerequisite"]["passed"])
		self.assertEqual(len(results["scenarios"]), 11)
		self.assertFalse(any(scenario["oraclePassed"] for scenario in results["scenarios"]))

	def test_responsive_contract_uses_current_viewports_without_cropping(self):
		contract = json.loads((
			ROOT / "evidence/oracle-inputs/responsive/responsive-contract.v1.json"
		).read_text())
		self.assertEqual(contract["capturePolicy"]["crop"], "forbidden")
		self.assertEqual(contract["capturePolicy"]["resizeOrNormalization"], "forbidden")
		self.assertEqual([capture["width"] for capture in contract["captures"]], [280, 740, 1200])
		self.assertEqual(contract["native"]["declaredMinimumWidth"], 760)
		self.assertEqual(contract["native"]["status"], "gap")
		for capture in contract["captures"]:
			geometry = json.loads((
				ROOT / "evidence/oracle-inputs/responsive" / capture["geometry"]
			).read_text())
			self.assertEqual(geometry["innerWidth"], capture["width"])
			self.assertEqual(geometry["rootScrollWidth"], capture["width"])
			self.assertEqual(geometry["bodyScrollWidth"], capture["width"])

	def test_source_font_receipt_uses_runtime_glyph_evidence(self):
		receipt = json.loads((ROOT / "evidence/oracle-inputs/source-font-receipt.json").read_text())
		self.assertEqual(receipt["schema"], "palot-runtime-used-font-receipt-v1")
		self.assertRegex(receipt["captureSha256"], r"^[0-9a-f]{64}$")
		self.assertRegex(receipt["captureMetaSha256"], r"^[0-9a-f]{64}$")
		faces = receipt["usedFaces"]
		self.assertTrue(faces)
		self.assertEqual({face["family"] for face in faces}, {".SF NS", "Menlo"})
		self.assertTrue(all(face["glyphCount"] > 0 and face["nodeCount"] > 0 for face in faces))
		self.assertTrue(all(face["evidence"]["sourceId"].startswith("dom/") for face in faces))
		self.assertEqual(receipt["negativeEvidence"], {
			"family": "Inter Variable", "runtimeGlyphCount": 0,
			"reason": "Installed package assets are not runtime-use evidence.",
		})
		for manifest_path in ROOT.glob("evidence/visual-parity-oracle-*.manifest.json"):
			manifest = json.loads(manifest_path.read_text())
			for artifact in [manifest["source"], *manifest["calibration"]["source_repeats"]]:
				self.assertNotIn("Inter Variable", {font["family"] for font in artifact["fonts"]})


if __name__ == "__main__":
	unittest.main()
