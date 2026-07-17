#!/usr/bin/env python3

import importlib.util
import unittest
from pathlib import Path


SCRIPT = Path(__file__).with_name("run-rounded-corner-region-gate.py")
SPEC = importlib.util.spec_from_file_location("rounded_corner_gate", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class RoundedCornerRegionGateTest(unittest.TestCase):
	def test_regions_are_derived_from_observed_geometry_and_per_corner_radius(self):
		node = {
			"rect": {"x": 10, "y": 20, "width": 100, "height": 80},
			"computedStyle": {
				"borderBottomLeftRadius": "12px",
				"borderBottomRightRadius": "8px",
			},
		}
		self.assertEqual(MODULE.corner_regions(node, 2, 0.95), [
			{"name": "chat-panel-bottom-left", "minimum_pixel_similarity": 0.95,
			 "rect": {"x": 20, "y": 152, "width": 48, "height": 48}},
			{"name": "chat-panel-bottom-right", "minimum_pixel_similarity": 0.95,
			 "rect": {"x": 188, "y": 168, "width": 32, "height": 32}},
		])

	def test_anchor_resolution_requires_one_rendered_source_node(self):
		semantics = {"children": [
			{"sourceId": "root/main[target]:1"},
			{"sourceId": "root/main[target]:1", "rect": {}, "computedStyle": {}},
		]}
		self.assertEqual(MODULE.find_node(semantics, "main[target]:1")["rect"], {})


if __name__ == "__main__":
	unittest.main()
