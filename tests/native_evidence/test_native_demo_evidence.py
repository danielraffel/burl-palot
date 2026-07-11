import importlib.util
import json
import pathlib
import tempfile
import unittest
from unittest import mock
import plistlib

ROOT = pathlib.Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location("evidence", ROOT / "scripts/native_demo_evidence.py")
assert SPEC and SPEC.loader
EVIDENCE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(EVIDENCE)


class NativeEvidenceTest(unittest.TestCase):
    def app_bundle(self, root):
        app = pathlib.Path(root) / "Palot.app"
        executable = app / "Contents/MacOS/Palot"
        executable.parent.mkdir(parents=True)
        executable.write_text("#!/bin/sh\nexit 0\n")
        executable.chmod(0o755)
        (app / "Contents/Info.plist").write_bytes(
            plistlib.dumps({"CFBundleExecutable": "Palot"}))
        return app

    def test_bundle_audit_rejects_browser_runtime(self):
        with tempfile.TemporaryDirectory() as temporary:
            app = self.app_bundle(temporary)
            (app / "Contents/Frameworks/Chromium Framework.framework").mkdir(parents=True)
            with mock.patch.object(EVIDENCE.subprocess, "run") as run:
                run.return_value.stdout = "Palot:\n"
                with self.assertRaisesRegex(ValueError, "browser runtime"):
                    EVIDENCE.audit_bundle(app)

    def test_launch_probe_rejects_early_exit(self):
        with tempfile.TemporaryDirectory() as temporary:
            with self.assertRaisesRegex(ValueError, "exited early"):
                EVIDENCE.launch_probe(self.app_bundle(temporary), 0.3)

    def test_manifest_requires_exact_gate_set_and_real_digests(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = pathlib.Path(temporary)
            artifact = root / "build.json"
            artifact.write_text("{}")
            manifest = {"artifacts": [{"kind": "build", "path": "build.json",
                                       "sha256": EVIDENCE.sha256(artifact), "status": "pass"}]}
            errors = EVIDENCE.validate_manifest(manifest, root)
            self.assertTrue(any("missing=" in error for error in errors))
            artifact.write_text("changed")
            self.assertTrue(any("digest" in error for error in EVIDENCE.validate_manifest(manifest, root)))

    def test_real_chat_must_prove_streamed_response(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = pathlib.Path(temporary) / "chat.json"
            path.write_text(json.dumps({"status": "pass", "project": "/repo",
                                        "session_id": "s", "prompt": "hi",
                                        "stream_chunks": 0, "response": ""}))
            with self.assertRaises(ValueError):
                EVIDENCE.validate_json_evidence(path, "opencode_integration")

    def test_accessibility_requires_semantic_transcript_rows(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = pathlib.Path(temporary) / "a11y.json"
            path.write_text(json.dumps({"nodes": [
                {"label": label, "role": "group"}
                for label in EVIDENCE.REQUIRED_ACCESSIBILITY_LABELS
            ]}))
            with self.assertRaises(ValueError):
                EVIDENCE.validate_accessibility(path)

    def test_persistence_gate_includes_corruption_recovery(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = pathlib.Path(temporary) / "persistence.json"
            path.write_text(json.dumps({"status": "pass", "multiline": True,
                                        "tabs": True, "truncated_recovery": False}))
            with self.assertRaises(ValueError):
                EVIDENCE.validate_json_evidence(path, "persistence")


if __name__ == "__main__":
    unittest.main()
