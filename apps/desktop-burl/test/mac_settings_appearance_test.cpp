#include "imported_root_host.hpp"
#include "mac_window_harness.hpp"

#include <pulp/view/screenshot_compare.hpp>

#include <nlohmann/json.hpp>

#include <algorithm>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <memory>
#include <optional>
#include <string>
#include <unordered_map>
#include <vector>

namespace {

bool write_bytes(const std::filesystem::path& path, const std::vector<std::uint8_t>& bytes) {
	std::error_code error;
	std::filesystem::create_directories(path.parent_path(), error);
	if (error || bytes.empty()) return false;
	std::ofstream output(path, std::ios::binary);
	output.write(reinterpret_cast<const char*>(bytes.data()),
	             static_cast<std::streamsize>(bytes.size()));
	return output.good();
}

pulp::view::Rect bounds_in_root(const pulp::view::View& view,
	                            const pulp::view::View& root) {
	float x = 0.0f;
	float y = 0.0f;
	for (auto* current = &view; current && current != &root; current = current->parent()) {
		x += current->bounds().x;
		y += current->bounds().y;
	}
	return {x, y, view.bounds().width, view.bounds().height};
}

std::optional<pulp::view::Rect> visible_bounds_in_root(const pulp::view::View& view,
	                                                   const pulp::view::View& root) {
	auto visible = bounds_in_root(view, root);
	auto clip_x = [&](const pulp::view::Rect& clip) {
		const float right = std::min(visible.x + visible.width, clip.x + clip.width);
		visible.x = std::max(visible.x, clip.x);
		visible.width = right - visible.x;
	};
	auto clip_y = [&](const pulp::view::Rect& clip) {
		const float bottom = std::min(visible.y + visible.height, clip.y + clip.height);
		visible.y = std::max(visible.y, clip.y);
		visible.height = bottom - visible.y;
	};
	clip_x({0, 0, root.bounds().width, root.bounds().height});
	clip_y({0, 0, root.bounds().width, root.bounds().height});
	for (auto* ancestor = view.parent(); ancestor; ancestor = ancestor->parent()) {
		const auto clip = bounds_in_root(*ancestor, root);
		if (ancestor->clips_overflow_x()) clip_x(clip);
		if (ancestor->clips_overflow_y()) clip_y(clip);
		if (ancestor == &root) break;
	}
	if (visible.width <= 0.0f || visible.height <= 0.0f) return std::nullopt;
	return visible;
}

pulp::view::Point center_in_visible_root(const pulp::view::View& view,
	                                     const pulp::view::View& root) {
	const auto bounds = visible_bounds_in_root(view, root).value_or(bounds_in_root(view, root));
	const auto layout = bounds_in_root(view, root);
	const pulp::view::Point local{
		bounds.x + bounds.width * 0.5f - layout.x,
		bounds.y + bounds.height * 0.5f - layout.y,
	};
	return pulp::test::mac::visual_point_in_root(view, root, local)
		.value_or(pulp::view::Point{bounds.x + bounds.width * 0.5f,
		                           bounds.y + bounds.height * 0.5f});
}

bool click_action(pulp::view::WindowHost& window,
	              ImportedRootHost& root,
	              std::string_view action,
	              const std::unordered_map<std::string, int>& calls) {
	const auto views = root.bound_action_views(action);
	if (views.size() != 1) {
		std::cerr << "expected one visible action=" << action << " observed=" << views.size() << '\n';
		return false;
	}
	const auto point = center_in_visible_root(*views.front(), root);
	const auto before = calls.contains(std::string(action)) ? calls.at(std::string(action)) : 0;
	const auto trace = pulp::test::mac::simulate_click_traced(
		window, root, point.x, point.y, [&calls, action] {
			const auto found = calls.find(std::string(action));
			return static_cast<std::uint64_t>(found == calls.end() ? 0 : found->second);
		});
	const auto after = calls.contains(std::string(action)) ? calls.at(std::string(action)) : 0;
	const bool passed = trace.down_dispatched && trace.up_dispatched && trace.action_fired &&
	                    after == before + 1;
	if (!passed)
		std::cerr << "click failed action=" << action << " point=" << point.x << ',' << point.y
		          << " down=" << trace.down_dispatched << " up=" << trace.up_dispatched
		          << " fired=" << trace.action_fired << " press=" << trace.press_target
		          << " release=" << trace.release_target
		          << " actionable=" << trace.actionable_ancestor << " calls-before=" << before
		          << " calls-after=" << after << '\n';
	return passed;
}

std::vector<std::uint8_t> capture(pulp::view::WindowHost& window,
	                              ImportedRootHost& root) {
	root.layout_children();
	root.request_repaint();
	auto frames = pulp::test::mac::capture_settled_back_buffer_png(window, 4);
	return frames.empty() ? std::vector<std::uint8_t>{} : std::move(frames.back().png);
}

nlohmann::json appearance_json(const pulp::test::mac::NativeAppearanceSnapshot& snapshot) {
	return {
		{"windowIdentity", snapshot.window_identity},
		{"effectIdentity", snapshot.effect_identity},
		{"explicit", snapshot.has_explicit_window_appearance},
		{"windowBestMatch", snapshot.window_best_match},
		{"effectBestMatch", snapshot.effect_best_match},
	};
}

}  // namespace

int main(int argc, char** argv) {
	if (argc != 4) return 2;
	const auto output = std::filesystem::path(argv[3]);

	ImportedRootHost root;
	std::unique_ptr<pulp::view::WindowHost> window;
	std::unordered_map<std::string, int> calls;
	std::unordered_map<std::string, std::string> payloads;
	for (const auto* id : {
		     "command.palette.open", "composer.agent-menu.toggle", "composer.attachment.open",
		     "composer.copy", "composer.model-menu.toggle", "composer.variant-menu.toggle",
		     "display.mode.cycle", "external.open.menu.toggle", "external.open.preferred",
		     "navigation.automations", "navigation.session.close", "navigation.settings",
		     "project.open", "project.search.toggle", "project.select", "prompt.cancel",
		     "prompt.retry", "prompt.send", "review.panel.toggle", "server.menu.toggle",
		     "session.create", "session.metrics.dismiss", "session.metrics.toggle", "session.open",
		     "session.title.edit.begin", "settings.theme.select", "sidebar.toggle",
		     "terminal.attach", "ui.presentation.toggle"}) {
		root.register_action(id, [&, id](std::string_view payload) {
			++calls[id];
			payloads[id] = payload;
			if (id != std::string_view{"settings.theme.select"} || !window) return;
			const auto appearance = payload == "light"
				? pulp::view::WindowAppearance::light
				: payload == "dark" ? pulp::view::WindowAppearance::dark
				                    : pulp::view::WindowAppearance::system;
			window->set_appearance(appearance);
		});
	}

	root.load(argv[1], argv[2]);
	const std::vector<std::string> expected_unattached{
		"external.open.preferred", "project.select", "session.create", "session.open", "terminal.attach"};
	if (root.unattached_required_actions() != expected_unattached) return 3;
	root.set_bounds({0, 0, 1200, 800});
	root.layout_children();

	pulp::view::WindowOptions options;
	options.title = "Palot Settings appearance proof";
	options.width = 1200;
	options.height = 800;
	options.transparent = true;
	options.backdrop_effect = pulp::view::WindowBackdropEffect::liquid_glass;
	options.appearance = pulp::view::WindowAppearance::dark;
	window = pulp::test::mac::make_test_window(root, options);
	if (!window) return 4;

	if (!click_action(*window, root, "navigation.settings", calls)) return 5;
	root.layout_children();
	if (calls["navigation.settings"] != 1 ||
	    root.bound_action_views("settings.theme.select").size() != 1)
		return 6;

	const auto dark_appearance = pulp::test::mac::inspect_native_appearance(*window);
	const auto dark = capture(*window, root);
	if (!pulp::view::analyze_screenshot_content(dark).passes_content_floor() ||
	    !write_bytes(output / "settings-dark.png", dark))
		return 7;

	window->set_appearance(pulp::view::WindowAppearance::system);
	const auto system_appearance = pulp::test::mac::inspect_native_appearance(*window);
	const auto system = capture(*window, root);
	if (!pulp::view::analyze_screenshot_content(system).passes_content_floor() ||
	    !write_bytes(output / "settings-system-platform-only.png", system))
		return 8;

	window->set_appearance(pulp::view::WindowAppearance::dark);
	if (!click_action(*window, root, "settings.theme.select", calls)) return 9;
	root.layout_children();
	const auto light_appearance = pulp::test::mac::inspect_native_appearance(*window);
	const auto light = capture(*window, root);
	if (calls["settings.theme.select"] != 1 || payloads["settings.theme.select"] != "light" ||
	    dark == light || !pulp::view::analyze_screenshot_content(light).passes_content_floor() ||
	    !write_bytes(output / "settings-light.png", light))
		return 10;

	const bool identities_stable = dark_appearance.window_identity != 0 &&
		dark_appearance.effect_identity != 0 &&
		dark_appearance.window_identity == system_appearance.window_identity &&
		dark_appearance.window_identity == light_appearance.window_identity &&
		dark_appearance.effect_identity == system_appearance.effect_identity &&
		dark_appearance.effect_identity == light_appearance.effect_identity;
	if (!identities_stable || !dark_appearance.has_explicit_window_appearance ||
	    system_appearance.has_explicit_window_appearance ||
	    !light_appearance.has_explicit_window_appearance ||
	    dark_appearance.window_best_match != "NSAppearanceNameDarkAqua" ||
	    light_appearance.window_best_match != "NSAppearanceNameAqua")
		return 11;

	std::filesystem::create_directories(output);
	std::ofstream receipt(output / "settings-appearance-receipt.v1.json");
	receipt << nlohmann::json{
		{"schema", "palot-native-settings-appearance-v1"},
		{"renderer", "production AppKit NSWindow plus CAMetalLayer, Dawn Metal, and Skia Graphite"},
		{"captureSurface", "Skia back buffer with transparent-window alpha preserved"},
		{"designIr", std::filesystem::weakly_canonical(argv[1]).string()},
		{"captureSize", {{"width", 1200}, {"height", 800}}},
		{"appearance", {{"dark", appearance_json(dark_appearance)},
		                {"system", appearance_json(system_appearance)},
		                {"light", appearance_json(light_appearance)}}},
		{"nativeIdentitiesStable", identities_stable},
		{"settingsThemePayload", payloads["settings.theme.select"]},
		{"sourceParity", {{"dark", "available"},
		                   {"light", "unproven-source-capture-is-byte-identical-to-dark"},
		                   {"system", "unproven-missing-source-state-capture"}}},
	}.dump(2) << '\n';
	return receipt.good() ? 0 : 12;
}
