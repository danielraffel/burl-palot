#include "imported_root_host.hpp"
#include "mac_window_harness.hpp"

#include <pulp/view/text_editor.hpp>
#include <pulp/view/markdown_view.hpp>
#include <pulp/view/ui_components.hpp>
#include <pulp/view/virtual_list.hpp>
#include <pulp/view/widgets.hpp>
#include <nlohmann/json.hpp>

#include <algorithm>
#include <cmath>
#include <cstdlib>
#include <filesystem>
#include <iostream>
#include <fstream>
#include <optional>
#include <typeinfo>
#include <unordered_map>
#include <unordered_set>
#include <string>
#include <vector>

namespace {

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

bool intersects_root(const pulp::view::View& view, const pulp::view::View& root) {
	return visible_bounds_in_root(view, root).has_value();
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

bool effectively_visible(const pulp::view::View& view, const pulp::view::View& root) {
	for (auto* current = &view; current; current = current->parent()) {
		if (!current->visible()) return false;
		if (current == &root) return true;
	}
	return false;
}

bool descends_from(const pulp::view::View* candidate, const pulp::view::View* ancestor) {
	for (auto* current = candidate; current; current = current->parent())
		if (current == ancestor) return true;
	return false;
}

bool is_native_local_interaction(const pulp::view::View& view) {
	return dynamic_cast<const pulp::view::MarkdownView*>(&view) != nullptr ||
	       dynamic_cast<const pulp::view::VirtualList*>(&view) != nullptr ||
	       dynamic_cast<const pulp::view::ToggleButton*>(&view) != nullptr ||
	       dynamic_cast<const pulp::view::Checkbox*>(&view) != nullptr ||
	       dynamic_cast<const pulp::view::ComboBox*>(&view) != nullptr;
}

void collect_interactive(pulp::view::View& view, const pulp::view::View& root,
	                     const std::unordered_set<pulp::view::View*>& bound,
	                     std::vector<pulp::view::View*>& out) {
	if (!effectively_visible(view, root) || !view.enabled() || !view.hit_testable()) return;
	if (intersects_root(view, root) &&
	    (bound.contains(&view) || view.focusable() || view.wants_mouse_input() ||
	     view.wants_wheel_scroll()))
		out.push_back(&view);
	for (std::size_t index = 0; index < view.child_count(); ++index)
		collect_interactive(*view.child_at(index), root, bound, out);
}

std::string read_text(const char* path) {
	std::ifstream input(path);
	return {std::istreambuf_iterator<char>(input), std::istreambuf_iterator<char>()};
}

bool write_bytes(const std::filesystem::path& path, const std::vector<uint8_t>& bytes) {
	std::error_code error;
	std::filesystem::create_directories(path.parent_path(), error);
	if (error || bytes.empty()) return false;
	std::ofstream output(path, std::ios::binary);
	output.write(reinterpret_cast<const char*>(bytes.data()),
	             static_cast<std::streamsize>(bytes.size()));
	return output.good();
}

pulp::view::ImportedRepeatedList* find_repeated_list(pulp::view::View& root,
                                                     std::size_t item_count) {
	if (auto* list = dynamic_cast<pulp::view::ImportedRepeatedList*>(&root);
	    list && list->items().size() == item_count)
		return list;
	for (std::size_t index = 0; index < root.child_count(); ++index)
		if (auto* found = find_repeated_list(*root.child_at(index), item_count)) return found;
	return nullptr;
}

pulp::view::View* find_anchor(pulp::view::View& root, std::string_view anchor) {
	if (root.anchor_id() == anchor) return &root;
	for (std::size_t index = 0; index < root.child_count(); ++index)
		if (auto* found = find_anchor(*root.child_at(index), anchor)) return found;
	return nullptr;
}

std::vector<pulp::view::ImportedListItem> transcript_fixture() {
	std::vector<pulp::view::ImportedListItem> rows;
	for (int index = 0; index < 30; ++index) {
		const std::string template_id = index == 1 ? "reasoning" : index == 2 ? "tool.read" :
		                                index == 3 ? "tool.edit" : index % 2 ? "assistant" : "user";
		rows.push_back({"message-" + std::to_string(index), template_id,
		                {{"message.text", "Production AppKit wheel row " + std::to_string(index) +
		                                      " with enough content to wrap."},
		                 {"reasoning.label", "Thought for 2 seconds"},
		                 {"reasoning.text", "The imported reasoning row must remain locally interactive."},
		                 {"tool.label", template_id == "tool.read" ? "Read" : "Edit"},
		                 {"tool.subject", "src/lib/theme.ts"}, {"tool.duration", "3s"}}});
	}
	return rows;
}

std::vector<pulp::view::ImportedListItem> source_transcript_fixture() {
	return {
		{"source-user", "user", {{"message.text", "Add a dark mode toggle to the application settings page. It should persist the user's preference to localStorage and apply the theme immediately without a page reload."}}},
		{"source-reasoning", "reasoning", {{"reasoning.label", "Thought for 2 seconds"},
		                                      {"reasoning.text", "Inspecting the settings implementation."}}},
		{"source-read", "tool.read", {{"tool.label", "Read"},
		                                 {"tool.subject", "components/settings.tsx"},
		                                 {"tool.duration", "3s"}}},
		{"source-edit-theme", "tool.edit", {{"tool.label", "Edit"},
		                                        {"tool.subject", "lib/theme.ts"},
		                                        {"tool.duration", "3s"}}},
		{"source-edit-settings", "tool.edit", {{"tool.label", "Edit"},
		                                           {"tool.subject", "components/settings.tsx"},
		                                           {"tool.duration", "3s"}}},
		{"source-assistant", "assistant", {{"message.text", "I've added the dark mode toggle to the settings page."}}},
	};
}

void configure_fixture(ImportedRootHost& root,
	                   const char* design_ir,
	                   const char* bindings,
	                   float width,
	                   float height = 700.0f) {
	root.set_runtime_context_lookup([](std::string_view field) -> std::optional<std::string> {
		if (field == "project.directory") return "/fixture/project";
		if (field == "session.id") return "fixture-session";
		return std::nullopt;
	});
	root.load(design_ir, bindings);
	root.set_projects({{"project", "project", {{"project.name", "held project"},
	                                                {"directory", "/fixture/project"}}}});
	root.set_transcript_auto_follow(false);
	root.set_transcript(transcript_fixture());
	root.set_bounds({0, 0, width, height});
	root.layout_children();
}

void configure_source_fixture(ImportedRootHost& root,
	                          const char* design_ir,
	                          const char* bindings,
	                          float width,
	                          float height) {
	root.set_runtime_context_lookup([](std::string_view field) -> std::optional<std::string> {
		if (field == "project.directory") return "/fixture/project";
		if (field == "session.id") return "fixture-session";
		return std::nullopt;
	});
	root.load(design_ir, bindings);
	root.set_transcript_auto_follow(false);
	root.set_transcript(source_transcript_fixture());
	root.set_bounds({0, 0, width, height});
	root.layout_children();
}

}  // namespace

int main(int argc, char** argv) {
	if (argc != 6) return 2;
	ImportedRootHost root;
	std::unordered_map<std::string, int> calls;
	std::unordered_map<std::string, std::string> payloads;
	const bool navigation_proof_only = std::getenv("PALOT_NAVIGATION_PROOF_ONLY") != nullptr;
	std::vector<std::string> action_ids = {
		"appearance.color-scheme.select",
		"command.palette.open", "composer.agent-menu.toggle", "composer.attachment.open", "composer.copy",
		"composer.model-menu.toggle", "composer.variant-menu.toggle", "composer.variant.select",
		"configuration.reload", "conversation.compact", "developer.demo-mode.toggle",
		"developer.react-scan.toggle", "display.mode.cycle",
		"disclosure.edit.toggle", "disclosure.read.toggle", "disclosure.thought.toggle",
		"external.open.menu.toggle", "external.open.preferred", "navigation.automations",
		"navigation.back-to-app", "navigation.new-session", "navigation.session.close", "navigation.settings", "project.open",
		"project.search.toggle",
		"project.select", "prompt.cancel", "prompt.retry", "prompt.send", "review.diff.open",
		"review.panel.toggle",
		"server.menu.toggle", "session.create", "session.fork", "session.metrics.toggle", "session.open",
		"session.metrics.dismiss", "session.title.edit.begin", "settings.theme.select",
		"sidebar.toggle", "terminal.attach", "message.scroll-to-turn", "session.undo-last-turn",
		"features.automations.toggle", "window.transparency.toggle",
		"session.fork-from-message", "session.undo-to-message"};
	for (const auto& id : action_ids) {
		root.register_action(id, [&, id](std::string_view payload) {
			++calls[id];
			payloads[id] = payload;
		});
	}
	const float proof_height = navigation_proof_only ? 800.0f : 700.0f;
	configure_fixture(root, argv[1], argv[2], 1200.0f, proof_height);
	if (navigation_proof_only) root.set_transcript(source_transcript_fixture());

	const bool variant_overlay_proof_only =
		std::getenv("PALOT_VARIANT_OVERLAY_PROOF_ONLY") != nullptr;
	const bool overlay_proof_only =
		std::getenv("PALOT_OVERLAY_PROOF_ONLY") != nullptr || variant_overlay_proof_only;
	const bool usage_overlay_proof_only = std::getenv("PALOT_USAGE_OVERLAY_PROOF_ONLY") != nullptr;
	std::unique_ptr<pulp::view::WindowHost> window;
	if (!overlay_proof_only) {
		pulp::view::WindowOptions options;
		options.title = "Palot production interaction test";
		options.width = 1200;
		options.height = static_cast<int>(proof_height);
		window = pulp::test::mac::make_test_window(root, options);
		if (!window) return 3;
		root.layout_children();
	}

	for (const auto& action : root.unattached_actions())
		std::cerr << "unattached optional imported action=" << action << '\n';
	if (!root.unattached_required_actions().empty()) {
		for (const auto& action : root.unattached_required_actions())
			std::cerr << "unattached required imported action=" << action << '\n';
		return 4;
	}
	const auto candidates = nlohmann::json::parse(read_text(argv[3]));
	const auto policy = nlohmann::json::parse(read_text(argv[4]));
	std::unordered_set<std::string> policy_actions;
	for (const auto& rule : policy.at("rules")) {
		const auto& attributes = rule.at("attributes");
		const auto action = attributes.value("pulpHostAction",
		                                  attributes.value("action_binding_id", ""));
		if (!action.empty()) policy_actions.insert(action);
	}
	std::unordered_map<std::string, std::string> action_aliases;
	for (const auto& alias : policy.value("actionAliases", nlohmann::json::array())) {
		const auto source = alias.value("sourceAction", "");
		const auto target = alias.value("applicationAction", "");
		if (source.empty() || target.empty() || source == target ||
		    (action_aliases.contains(source) && action_aliases.at(source) != target) ||
		    !policy_actions.contains(target)) {
			std::cerr << "invalid source binding policy action alias source=" << source
			          << " target=" << target << '\n';
			return 5;
		}
		action_aliases[source] = target;
	}
	for (const auto& [source, target] : action_aliases) {
		if (action_aliases.contains(target)) {
			std::cerr << "transitive source binding policy action alias is not allowed source="
			          << source << " target=" << target << '\n';
			return 5;
		}
	}
	for (const auto& candidate : candidates.at("candidates")) {
		if (candidate.at("review").value("status", "") != "mapped") continue;
		const auto source_action = candidate.at("review").value("applicationAction", "");
		const auto action = action_aliases.contains(source_action)
			? action_aliases.at(source_action) : source_action;
		if (action.empty() || !policy_actions.contains(action)) {
			std::cerr << "mapped source interaction lacks policy coverage action=" << source_action
			          << " reconciled=" << action
			          << " source=" << candidate.value("sourceId", "") << '\n';
			return 5;
		}
	}

	// Prove the production AppKit pointer route reaches both the host endpoint
	// and the imported visual-state transition.  A callback counter alone is
	// insufficient: without the transition the control appears inert even
	// though mouse down/up dispatch succeeded.
	const auto click_bound_action = [&](std::string_view action) {
		const auto views = root.bound_action_views(action);
		if (views.size() != 1) {
			std::cerr << "expected one visible bound action=" << action
			          << " observed=" << views.size() << '\n';
			return false;
		}
		const auto point = center_in_visible_root(*views.front(), root);
		const auto before = calls[std::string(action)];
		const auto trace = pulp::test::mac::simulate_click_traced(
			*window, root, point.x, point.y,
			[&calls, action] { return static_cast<uint64_t>(calls[std::string(action)]); });
		const auto passed = trace.down_dispatched && trace.up_dispatched && trace.action_fired &&
		                    calls[std::string(action)] == before + 1;
		if (!passed)
			std::cerr << "AppKit click failed action=" << action
			          << " down=" << trace.down_dispatched << " up=" << trace.up_dispatched
			          << " fired=" << trace.action_fired << " calls-before=" << before
			          << " calls-after=" << calls[std::string(action)]
			          << " point=" << point.x << ',' << point.y
			          << " press=" << trace.press_target << " release=" << trace.release_target
			          << " actionable=" << trace.actionable_ancestor << '\n';
		return passed;
	};
	const auto capture_navigation_state = [&](std::string_view name,
	                                         std::vector<uint8_t>* captured = nullptr) {
		root.layout_children();
		root.request_repaint();
		auto frames = pulp::test::mac::capture_settled_back_buffer_png(*window, 4);
		if (!frames.empty() && captured) *captured = frames.back().png;
		return !frames.empty() && write_bytes(std::filesystem::path(argv[5]) / name,
		                                      frames.back().png);
	};
	if (!overlay_proof_only) {
		if (navigation_proof_only && !capture_navigation_state("01-chat-sidebar-open.png")) return 36;
		if (navigation_proof_only) {
			if (!click_bound_action("session.metrics.toggle")) return 42;
			root.layout_children();
			const auto dismiss_views = root.bound_action_views("session.metrics.dismiss");
			if (dismiss_views.size() != 1) {
				std::cerr << "metrics toggle produced visible dismiss actions=" << dismiss_views.size() << '\n';
				return 43;
			}
			if (!click_bound_action("session.metrics.dismiss"))
				return 43;
			root.layout_children();
			if (!root.bound_action_views("session.metrics.dismiss").empty() ||
			    calls["session.metrics.dismiss"] != 1)
				return 44;
		}
		if (root.bound_action_views("navigation.settings").empty() ||
		    !click_bound_action("sidebar.toggle"))
			return 15;
		root.layout_children();
		if (navigation_proof_only && !capture_navigation_state("02-chat-sidebar-collapsed.png")) return 37;
		if (!root.bound_action_views("navigation.settings").empty()) {
			std::cerr << "sidebar AppKit click fired its endpoint but did not hide sidebar descendants\n";
			return 16;
		}
		if (!click_bound_action("sidebar.toggle")) return 17;
		root.layout_children();
		if (navigation_proof_only && !capture_navigation_state("03-chat-sidebar-restored.png")) return 38;
		if (root.bound_action_views("navigation.settings").empty()) {
			std::cerr << "second sidebar AppKit click did not restore sidebar descendants\n";
			return 18;
		}
		if (navigation_proof_only) {
			if (root.bound_action_views("session.metrics.toggle").empty() ||
			    !click_bound_action("navigation.settings"))
				return 39;
			root.layout_children();
			std::vector<uint8_t> dark_frame;
			std::vector<uint8_t> light_frame;
			const auto metrics_after_navigation =
				root.bound_action_views("session.metrics.toggle").size();
			const auto theme_controls = root.bound_action_views("settings.theme.select").size();
			const auto theme_payload = root.active_action_payload("settings.theme.select");
			const bool settings_captured =
				capture_navigation_state("04-settings-general.png", &dark_frame);
			if (metrics_after_navigation != 0 || theme_controls != 1 ||
			    theme_payload != std::optional<std::string>{"light"} || !settings_captured) {
				std::cerr << "settings navigation postcondition failed metrics="
				          << metrics_after_navigation << " theme-controls=" << theme_controls
				          << " theme-payload=" << theme_payload.value_or("<none>")
				          << " captured=" << settings_captured << '\n';
				return 40;
			}
			// Settings controls from headless component libraries are frequently
			// emitted as <span role=switch> and <button role=combobox>. Prove that
			// semantic materialization produced native local behavior rather than a
			// merely focusable/static accessibility shell.
			std::vector<pulp::view::View*> settings_controls;
			collect_interactive(root, root, {}, settings_controls);
			std::size_t settings_switch_count = 0;
			std::size_t settings_select_count = 0;
			std::size_t settings_switch_proved = 0;
			std::size_t settings_select_proved = 0;
			for (auto* control : settings_controls) {
				if (auto* toggle = dynamic_cast<pulp::view::ToggleButton*>(control)) {
					const auto ordinal = ++settings_switch_count;
					std::vector<uint8_t> before_frame;
					std::vector<uint8_t> after_frame;
					const bool captured_before = capture_navigation_state(
						"settings-switch-" + std::to_string(ordinal) + "-before.png", &before_frame);
					const auto was_on = toggle->is_on();
					const auto point = center_in_visible_root(*toggle, root);
					const auto trace = pulp::test::mac::simulate_click_traced(
						*window, root, point.x, point.y);
					const bool captured_after = capture_navigation_state(
						"settings-switch-" + std::to_string(ordinal) + "-after.png", &after_frame);
					if (trace.down_dispatched && trace.up_dispatched &&
					    toggle->is_on() != was_on &&
					    toggle->access_checked() == (toggle->is_on() ? "true" : "false") &&
					    captured_before && captured_after && before_frame != after_frame)
						++settings_switch_proved;
				}
				if (auto* combo = dynamic_cast<pulp::view::ComboBox*>(control)) {
					const auto ordinal = ++settings_select_count;
					std::vector<uint8_t> closed_frame;
					std::vector<uint8_t> open_frame;
					const bool captured_closed = capture_navigation_state(
						"settings-select-" + std::to_string(ordinal) + "-closed.png", &closed_frame);
					const auto point = center_in_visible_root(*combo, root);
					const auto trace = pulp::test::mac::simulate_click_traced(
						*window, root, point.x, point.y);
					const bool opened = trace.down_dispatched && trace.up_dispatched && combo->is_open();
					const bool captured_open = opened && capture_navigation_state(
						"settings-select-" + std::to_string(ordinal) + "-open.png", &open_frame);
					const bool escaped = opened && pulp::test::mac::simulate_key(*window, {
						.phase = pulp::test::mac::SimulatedKey::Phase::down,
						.key = pulp::view::KeyCode::escape}) &&
						pulp::test::mac::simulate_key(*window, {
						.phase = pulp::test::mac::SimulatedKey::Phase::up,
						.key = pulp::view::KeyCode::escape}) && !combo->is_open();
					if (opened && escaped && captured_closed && captured_open &&
					    closed_frame != open_frame)
						++settings_select_proved;
				}
			}
			if (settings_switch_count == 0 || settings_select_count == 0 ||
			    settings_switch_proved != settings_switch_count ||
			    settings_select_proved != settings_select_count) {
				std::cerr << "settings semantic control execution failed switches="
				          << settings_switch_proved << '/' << settings_switch_count
				          << " selects=" << settings_select_proved << '/' << settings_select_count << '\n';
				return 47;
			}
			if (!click_bound_action("settings.theme.select")) return 45;
			root.layout_children();
			if (calls["settings.theme.select"] != 1 || payloads["settings.theme.select"] != "light" ||
			    !capture_navigation_state("05-settings-light.png", &light_frame) ||
			    dark_frame == light_frame)
				return 46;
			std::ofstream audit(std::filesystem::path(argv[5]) / "navigation-state-audit.v1.json");
			audit << nlohmann::json{{"schema", "palot-native-navigation-state-audit-v1"},
			                        {"designIr", argv[1]},
			                        {"sidebarToggleDispatches", calls["sidebar.toggle"]},
			                        {"metricsDismissDispatches", calls["session.metrics.dismiss"]},
			                        {"settingsNavigationDispatches", calls["navigation.settings"]},
			                        {"chatMetricsHiddenAfterNavigation", true},
				                        {"settingsThemeControlVisible", true},
				                        {"settingsThemePayload", payloads["settings.theme.select"]},
				                        {"settingsThemeVisualTransition", true},
				                        {"settingsNativeSwitchControls", settings_switch_count},
				                        {"settingsNativeSwitchPostconditions", settings_switch_proved},
				                        {"settingsNativeSelectControls", settings_select_count},
				                        {"settingsNativeSelectOpenEscapePostconditions", settings_select_proved}}.dump(2) << '\n';
			return audit.good() ? EXIT_SUCCESS : 41;
		}
	}

	// Exercise the promoted source overlay contracts through the same AppKit
	// event route used by the application.  Trigger lookup is by reviewed
	// application binding identity; the test deliberately contains no Palot
	// coordinates or copied diagnostic typography.
	if (std::getenv("PALOT_INTERACTION_CENSUS_ONLY") == nullptr) {
		ImportedRootHost overlay_root;
		pulp::view::View::dismiss_active_overlay();
		std::unordered_map<std::string, int> overlay_calls;
		for (const auto& id : action_ids)
			overlay_root.register_action(id, [&, id](std::string_view) { ++overlay_calls[id]; });
		// Overlay parity must be proved against the imported source transcript,
		// not the 30-row synthetic wheel fixture used by the independent input
		// census below. Mixing those fixtures made an overlay screenshot incapable
		// of proving a clean application rest state.
		configure_source_fixture(overlay_root, argv[1], argv[2], 1200.0f, 800.0f);
		pulp::view::WindowOptions overlay_options;
		overlay_options.title = "Palot canonical overlay interaction proof";
		overlay_options.width = 1200;
		overlay_options.height = 800;
		auto overlay_window = pulp::test::mac::make_test_window(overlay_root, overlay_options);
		if (!overlay_window) return 19;
		overlay_root.layout_children();
		const auto capture_settled = [&](pulp::view::View* expected_overlay) {
			overlay_root.layout_children();
			overlay_root.request_repaint();
			auto frames = pulp::test::mac::capture_settled_back_buffer_png(*overlay_window, 4);
			if (expected_overlay &&
			    (pulp::view::View::active_overlay_ != expected_overlay ||
			     !effectively_visible(*expected_overlay, overlay_root)))
				return std::vector<uint8_t>{};
			return frames.empty() ? std::vector<uint8_t>{} : std::move(frames.back().png);
		};
		if (pulp::view::View::active_overlay_ != nullptr ||
		    find_repeated_list(overlay_root, source_transcript_fixture().size()) == nullptr ||
		    find_repeated_list(overlay_root, 30) != nullptr)
			return 34;
		if (!write_bytes(std::filesystem::path(argv[5]) / "application-rest.png",
		                 capture_settled(nullptr)))
			return 35;

		if (!usage_overlay_proof_only && !variant_overlay_proof_only) {
			const auto tooltip_triggers = overlay_root.bound_action_views("project.search.toggle");
			if (tooltip_triggers.size() != 1) return 20;
			const auto tooltip_point = center_in_visible_root(*tooltip_triggers.front(), overlay_root);
			if (!pulp::test::mac::simulate_mouse(*overlay_window, {
		        .phase = pulp::test::mac::SimulatedMouse::Phase::move,
		        .x = 1180,
		        .y = 780}))
				return 33;
			const bool tooltip_moved = pulp::test::mac::simulate_mouse(*overlay_window, {
		        .phase = pulp::test::mac::SimulatedMouse::Phase::move,
		        .x = tooltip_point.x,
		        .y = tooltip_point.y});
			if (!tooltip_moved || pulp::view::View::active_overlay_ == nullptr ||
		    !pulp::view::View::active_overlay_->visible() ||
		    !effectively_visible(*pulp::view::View::active_overlay_, overlay_root)) {
				std::cerr << "canonical tooltip failed moved=" << tooltip_moved
			          << " active=" << (pulp::view::View::active_overlay_ != nullptr)
			          << " local=" << (pulp::view::View::active_overlay_ &&
			                              pulp::view::View::active_overlay_->visible())
			          << " effective=" << (pulp::view::View::active_overlay_ &&
			              effectively_visible(*pulp::view::View::active_overlay_, overlay_root)) << '\n';
				std::cerr << "tooltip trigger=" << tooltip_triggers.front()->id() << " hit-chain=";
				for (auto* hit = overlay_root.hit_test(tooltip_point); hit; hit = hit->parent())
					std::cerr << hit->id() << " <- ";
				std::cerr << '\n';
				return 21;
			}
			auto* tooltip_overlay = pulp::view::View::active_overlay_;
			if (!write_bytes(std::filesystem::path(argv[5]) / "project-search-tooltip-open.png",
		                 capture_settled(tooltip_overlay)))
				return 22;
			if (!pulp::test::mac::simulate_mouse(*overlay_window, {
		        .phase = pulp::test::mac::SimulatedMouse::Phase::move,
		        .x = 1180,
		        .y = 780}) ||
		    pulp::view::View::active_overlay_ != nullptr)
				return 23;
			if (!overlay_root.set_application_state("navigation.route", "chat")) return 32;
		}
		overlay_root.layout_children();

		if (!variant_overlay_proof_only) {
		const auto metrics_triggers = overlay_root.bound_action_views("session.metrics.toggle");
		if (metrics_triggers.size() != 1) return 24;
		const auto metrics_point = center_in_visible_root(*metrics_triggers.front(), overlay_root);
		const auto open_trace = pulp::test::mac::simulate_click_traced(
			*overlay_window, overlay_root, metrics_point.x, metrics_point.y,
			[&] { return static_cast<uint64_t>(overlay_calls["session.metrics.toggle"]); });
		if (!open_trace.down_dispatched || !open_trace.up_dispatched || !open_trace.action_fired ||
		    pulp::view::View::active_overlay_ == nullptr ||
		    !pulp::view::View::active_overlay_->visible() ||
		    !effectively_visible(*pulp::view::View::active_overlay_, overlay_root)) {
			std::cerr << "canonical usage overlay failed down=" << open_trace.down_dispatched
			          << " up=" << open_trace.up_dispatched
			          << " action=" << open_trace.action_fired
			          << " active=" << (pulp::view::View::active_overlay_ != nullptr)
			          << " local=" << (pulp::view::View::active_overlay_ &&
			                            pulp::view::View::active_overlay_->visible())
			          << " effective=" << (pulp::view::View::active_overlay_ &&
			              effectively_visible(*pulp::view::View::active_overlay_, overlay_root)) << '\n';
			return 25;
		}
		auto* usage_overlay = pulp::view::View::active_overlay_;
		if (!write_bytes(std::filesystem::path(argv[5]) / "usage-popover-open.png",
		                 capture_settled(usage_overlay)))
			return 26;
		if (!pulp::test::mac::simulate_key(*overlay_window, {
		        .phase = pulp::test::mac::SimulatedKey::Phase::down,
		        .key = pulp::view::KeyCode::escape}) ||
		    !pulp::test::mac::simulate_key(*overlay_window, {
		        .phase = pulp::test::mac::SimulatedKey::Phase::up,
		        .key = pulp::view::KeyCode::escape}) ||
		    pulp::view::View::active_overlay_ != nullptr)
			return 27;
		if (!write_bytes(std::filesystem::path(argv[5]) / "usage-popover-closed-after-escape.png",
		                 capture_settled(nullptr)))
			return 28;

		const auto reopen_trace = pulp::test::mac::simulate_click_traced(
			*overlay_window, overlay_root, metrics_point.x, metrics_point.y);
		if (!reopen_trace.down_dispatched || !reopen_trace.up_dispatched ||
		    pulp::view::View::active_overlay_ == nullptr)
			return 29;
		if (!pulp::test::mac::simulate_mouse(*overlay_window, {
		        .phase = pulp::test::mac::SimulatedMouse::Phase::down, .x = 20, .y = 780}) ||
		    !pulp::test::mac::simulate_mouse(*overlay_window, {
		        .phase = pulp::test::mac::SimulatedMouse::Phase::up, .x = 20, .y = 780}) ||
		    pulp::view::View::active_overlay_ != nullptr)
			return 30;
		if (!write_bytes(std::filesystem::path(argv[5]) / "usage-popover-closed-after-outside.png",
		                 capture_settled(nullptr)))
			return 31;
		}

		// A captured select/menu surface is a top-layer contract, not merely a
		// root-state pixel change. Prove the generic overlay invariants that keep
		// imported portal content from appearing at window origin or surviving
		// after dismissal. The application action below only selects the source
		// control under test; all geometry and lifecycle assertions are generic.
		const bool variant_closed_by_default = pulp::view::View::active_overlay_ == nullptr;
		const auto variant_triggers =
			overlay_root.bound_action_views("composer.variant-menu.toggle");
		bool variant_dispatched = false;
		bool variant_active = false;
		bool variant_window_contained = false;
		bool variant_trigger_anchored = false;
		bool variant_escape_dismissed = false;
		bool variant_outside_dismissed = false;
		bool variant_visual_state_changed = false;
		if (variant_triggers.size() == 1) {
			auto* trigger = variant_triggers.front();
			const auto trigger_rect = bounds_in_root(*trigger, overlay_root);
			const auto trigger_point = center_in_visible_root(*trigger, overlay_root);
			const auto variant_before = capture_settled(nullptr);
			write_bytes(std::filesystem::path(argv[5]) / "variant-menu-closed.png",
			            variant_before);
			const auto trace = pulp::test::mac::simulate_click_traced(
				*overlay_window, overlay_root, trigger_point.x, trigger_point.y,
				[&] { return static_cast<uint64_t>(
					overlay_calls["composer.variant-menu.toggle"]); });
			variant_dispatched = trace.down_dispatched && trace.up_dispatched &&
				trace.action_fired && trace.outcome_after == trace.outcome_before + 1;
			overlay_root.layout_children();
			const auto variant_after_dispatch = capture_settled(nullptr);
			variant_visual_state_changed = !variant_before.empty() &&
				!variant_after_dispatch.empty() && variant_before != variant_after_dispatch;
			write_bytes(std::filesystem::path(argv[5]) / "variant-menu-after-dispatch.png",
			            variant_after_dispatch);
			auto* overlay = pulp::view::View::active_overlay_;
			variant_active = overlay && effectively_visible(*overlay, overlay_root);
			if (variant_active) {
				const auto overlay_rect = bounds_in_root(*overlay, overlay_root);
				constexpr float tolerance = 1.0f;
				variant_window_contained =
					overlay_rect.x >= -tolerance && overlay_rect.y >= -tolerance &&
					overlay_rect.x + overlay_rect.width <= overlay_root.bounds().width + tolerance &&
					overlay_rect.y + overlay_rect.height <= overlay_root.bounds().height + tolerance;
				const bool horizontal_overlap =
					overlay_rect.x < trigger_rect.x + trigger_rect.width + tolerance &&
					overlay_rect.x + overlay_rect.width > trigger_rect.x - tolerance;
				const float below_gap = overlay_rect.y - (trigger_rect.y + trigger_rect.height);
				const float above_gap = trigger_rect.y - (overlay_rect.y + overlay_rect.height);
				variant_trigger_anchored = horizontal_overlap &&
					((below_gap >= -tolerance && below_gap <= 16.0f) ||
					 (above_gap >= -tolerance && above_gap <= 16.0f));
				write_bytes(std::filesystem::path(argv[5]) / "variant-menu-open.png",
				            capture_settled(overlay));
				variant_escape_dismissed =
					pulp::test::mac::simulate_key(*overlay_window, {
						.phase = pulp::test::mac::SimulatedKey::Phase::down,
						.key = pulp::view::KeyCode::escape}) &&
					pulp::test::mac::simulate_key(*overlay_window, {
						.phase = pulp::test::mac::SimulatedKey::Phase::up,
						.key = pulp::view::KeyCode::escape}) &&
					pulp::view::View::active_overlay_ == nullptr;

				const auto reopen = pulp::test::mac::simulate_click_traced(
					*overlay_window, overlay_root, trigger_point.x, trigger_point.y);
				auto* reopened_overlay = pulp::view::View::active_overlay_;
				if (reopen.down_dispatched && reopen.up_dispatched && reopened_overlay) {
					std::optional<pulp::view::Point> outside;
					for (const auto candidate : std::vector<pulp::view::Point>{{8, 8},
					         {overlay_root.bounds().width - 8, 8},
					         {8, overlay_root.bounds().height - 8},
					         {overlay_root.bounds().width - 8, overlay_root.bounds().height - 8}}) {
						const bool in_trigger = candidate.x >= trigger_rect.x &&
							candidate.x <= trigger_rect.x + trigger_rect.width &&
							candidate.y >= trigger_rect.y &&
							candidate.y <= trigger_rect.y + trigger_rect.height;
						if (!in_trigger && !reopened_overlay->overlay_contains(candidate)) {
							outside = candidate;
							break;
						}
					}
					variant_outside_dismissed = outside &&
						pulp::test::mac::simulate_mouse(*overlay_window, {
							.phase = pulp::test::mac::SimulatedMouse::Phase::down,
							.x = outside->x, .y = outside->y}) &&
						pulp::test::mac::simulate_mouse(*overlay_window, {
							.phase = pulp::test::mac::SimulatedMouse::Phase::up,
							.x = outside->x, .y = outside->y}) &&
						pulp::view::View::active_overlay_ == nullptr;
				}
			}
		}
		const nlohmann::json variant_report{
			{"schema", "palot-imported-overlay-geometry-proof-v1"},
			{"action", "composer.variant-menu.toggle"},
			{"closedByDefault", variant_closed_by_default},
			{"triggerCount", variant_triggers.size()},
			{"appKitDispatch", variant_dispatched},
			{"visualStateChanged", variant_visual_state_changed},
			{"activeTopLayer", variant_active},
			{"windowContained", variant_window_contained},
			{"triggerAnchored", variant_trigger_anchored},
			{"escapeDismissed", variant_escape_dismissed},
			{"outsidePointerDismissed", variant_outside_dismissed},
		};
		std::ofstream variant_audit(
			std::filesystem::path(argv[5]) / "variant-menu-overlay-audit.v1.json");
		variant_audit << variant_report.dump(2) << '\n';
		if (!variant_audit.good() || !variant_closed_by_default ||
		    variant_triggers.size() != 1 || !variant_dispatched || !variant_active ||
		    !variant_window_contained || !variant_trigger_anchored ||
		    !variant_escape_dismissed || !variant_outside_dismissed)
			return 48;
	}
	if (overlay_proof_only) return EXIT_SUCCESS;

	std::size_t census_count = 0;
	std::size_t census_failures = 0;
	std::size_t native_local_count = 0;
	std::size_t missing_state_action_count = 0;
	const auto* action_proof_directory = std::getenv("PALOT_ACTION_PROOF_DIR");
	nlohmann::json interaction_records = nlohmann::json::array();
	struct ActionProbe {
		std::string action;
		std::string anchor;
		bool requires_visible_postcondition = false;
	};
	struct PointerProbe { std::string anchor; std::string label; };
	for (const float width : {599.0f, 768.0f, 1200.0f}) {
		root.set_bounds({0, 0, width, 700});
		root.layout_children();
		std::unordered_map<pulp::view::View*, std::string> action_by_view;
		for (const auto& id : action_ids)
			for (auto* view : root.bound_action_views(id)) action_by_view[view] = id;
		std::unordered_set<pulp::view::View*> bound;
		for (const auto& [view, id] : action_by_view) { (void)id; bound.insert(view); }
		std::vector<pulp::view::View*> controls;
		collect_interactive(root, root, bound, controls);
		std::vector<ActionProbe> action_probes;
		std::vector<PointerProbe> pointer_probes;
		for (auto* control : controls) {
			if (control == &root || control->bounds().width <= 0 || control->bounds().height <= 0) continue;
			const auto point = center_in_visible_root(*control, root);
			auto* hit = root.hit_test(point);
			if (!hit || !descends_from(hit, control)) {
				std::cerr << "dead/obstructed control width=" << width << " anchor=" << control->anchor_id()
				          << " label=" << control->access_label() << " hit="
				          << (hit ? hit->anchor_id() : "<none>") << " point=" << point.x << ',' << point.y << '\n';
				++census_failures;
				continue;
			}
			if (auto found = action_by_view.find(control);
			    found != action_by_view.end() && !dynamic_cast<pulp::view::TextEditor*>(control)) {
				const auto transitions = root.bound_action_state_transitions(found->second);
				const bool stateful = std::ranges::any_of(transitions, [](const auto& transition) {
					return !transition.first.empty() && !transition.second.empty();
				});
				action_probes.push_back({found->second, control->anchor_id(), stateful});
			} else if (is_native_local_interaction(*control) ||
			           control == root.bound_composer()) {
				++native_local_count;
			} else if (control->focusable() || control->wants_mouse_input() ||
			           control->wants_wheel_scroll()) {
				pointer_probes.push_back({control->anchor_id(), control->access_label()});
			}
			++census_count;
		}
		// A source click may hide or replace a shared ancestor. Rebuild the
		// imported tree in a fresh host before every dispatch so one probe cannot poison the
		// pre-collected control census or any subsequent probe.
		for (const auto& probe : action_probes) {
			ImportedRootHost isolated;
			for (const auto& id : action_ids)
				isolated.register_action(id, [&, id](std::string_view) { ++calls[id]; });
			configure_fixture(isolated, argv[1], argv[2], width);
			pulp::view::WindowOptions probe_options;
			probe_options.title = "Palot isolated action probe";
			probe_options.width = static_cast<int>(width);
			probe_options.height = 700;
			auto probe_window = pulp::test::mac::make_test_window(isolated, probe_options);
			if (!probe_window) { ++census_failures; continue; }
			isolated.layout_children();
			auto* control = find_anchor(isolated, probe.anchor);
			if (!control) { ++census_failures; continue; }
			std::vector<uint8_t> before_png;
			if (probe.requires_visible_postcondition) {
				auto frames = pulp::test::mac::capture_settled_back_buffer_png(*probe_window, 4);
				if (frames.empty()) { ++census_failures; continue; }
				before_png = std::move(frames.back().png);
				if (action_proof_directory) {
					auto file_action = probe.action;
					std::ranges::replace(file_action, '.', '-');
					if (!write_bytes(std::filesystem::path(action_proof_directory) /
					                 (std::to_string(static_cast<int>(width)) + "-" + file_action + "-before.png"),
					                 before_png)) {
						++census_failures;
						continue;
					}
				}
			}
			const auto point = center_in_visible_root(*control, isolated);
			const auto trace = pulp::test::mac::simulate_click_traced(
				*probe_window, isolated, point.x, point.y,
				[&calls, action = probe.action] { return static_cast<uint64_t>(calls[action]); });
			const bool dispatch_pass =
				trace.down_dispatched && trace.up_dispatched && trace.action_fired &&
				trace.outcome_after == trace.outcome_before + 1;
			if (!dispatch_pass) {
				std::cerr << "production action dispatch failed width=" << width << " action="
				          << probe.action << " anchor=" << probe.anchor
				          << " point=" << trace.x << ',' << trace.y
				          << " press=" << trace.press_target
				          << " release=" << trace.release_target
				          << " actionable=" << trace.actionable_ancestor
				          << " down=" << trace.down_dispatched
				          << " up=" << trace.up_dispatched
				          << " before=" << trace.outcome_before
				          << " after=" << trace.outcome_after << '\n';
				++census_failures;
			} else {
				std::cout << "production action proof width=" << width
				          << " action=" << probe.action
				          << " anchor=" << probe.anchor
				          << " coordinate-hit=1 dispatch=1" << '\n';
			}
			bool postcondition_pass = !probe.requires_visible_postcondition;
			if (probe.requires_visible_postcondition) {
				isolated.layout_children();
				auto frames = pulp::test::mac::capture_settled_back_buffer_png(*probe_window, 4);
				if (frames.empty() || frames.back().png == before_png) {
					std::cerr << "production stateful action has no visible postcondition width="
					          << width << " action=" << probe.action
					          << " anchor=" << probe.anchor << '\n';
					++census_failures;
				} else {
					postcondition_pass = true;
					if (action_proof_directory) {
						auto file_action = probe.action;
						std::ranges::replace(file_action, '.', '-');
						if (!write_bytes(std::filesystem::path(action_proof_directory) /
						                 (std::to_string(static_cast<int>(width)) + "-" + file_action + "-after.png"),
						                 frames.back().png))
							++census_failures;
					}
					std::cout << "production visible postcondition width=" << width
					          << " action=" << probe.action
					          << " anchor=" << probe.anchor << " changed=1" << '\n';
				}
			}
			interaction_records.push_back({
				{"width", width},
				{"action", probe.action},
				{"anchor", probe.anchor},
				{"hitTest", {{"coordinateHit", !trace.press_target.empty()},
				             {"pressTarget", trace.press_target},
				             {"releaseTarget", trace.release_target},
				             {"actionableAncestor", trace.actionable_ancestor}}},
				{"delivery", {{"down", trace.down_dispatched}, {"up", trace.up_dispatched}}},
				{"dispatch", {{"actionFired", trace.action_fired},
				              {"callbackBefore", trace.outcome_before},
				              {"callbackAfter", trace.outcome_after},
				              {"passed", dispatch_pass}}},
				{"postcondition", {{"kind", probe.requires_visible_postcondition
				                                      ? "settled-skia-pixel-diff" : "callback-only"},
				                   {"required", probe.requires_visible_postcondition},
				                   {"result", postcondition_pass ? "pass" : "fail"}}},
				{"keyboard", "not-applicable"},
				{"escape", "not-applicable"},
				{"hover", "not-applicable"},
				{"passed", dispatch_pass && postcondition_pass}
			});
		}
		for (const auto& probe : pointer_probes) {
			ImportedRootHost isolated;
			for (const auto& id : action_ids)
				isolated.register_action(id, [&, id](std::string_view) { ++calls[id]; });
			configure_fixture(isolated, argv[1], argv[2], width);
			pulp::view::WindowOptions probe_options;
			probe_options.title = "Palot isolated pointer probe";
			probe_options.width = static_cast<int>(width);
			probe_options.height = 700;
			auto probe_window = pulp::test::mac::make_test_window(isolated, probe_options);
			if (!probe_window) { ++census_failures; continue; }
			isolated.layout_children();
			auto* control = find_anchor(isolated, probe.anchor);
			if (!control) { ++census_failures; continue; }
			const auto point = center_in_visible_root(*control, isolated);
			const auto trace = pulp::test::mac::simulate_click_traced(
				*probe_window, isolated, point.x, point.y);
				if (!trace.down_dispatched || !trace.up_dispatched ||
				    trace.press_target.empty() || trace.release_target.empty()) {
					std::cerr << "unbound source control does not route pointer input width=" << width
					          << " anchor=" << probe.anchor << " label=" << probe.label
					          << " press=" << trace.press_target << " release=" << trace.release_target << '\n';
					++census_failures;
				} else {
					std::cout << "interaction gap width=" << width
					          << " class=missing-captured-state-or-action"
					          << " anchor=" << probe.anchor << " label=" << probe.label
					          << " press=" << trace.press_target << " release=" << trace.release_target << '\n';
					++missing_state_action_count;
				}
			interaction_records.push_back({
				{"width", width}, {"action", nullptr}, {"anchor", probe.anchor},
				{"label", probe.label},
				{"hitTest", {{"coordinateHit", !trace.press_target.empty()},
				             {"pressTarget", trace.press_target},
				             {"releaseTarget", trace.release_target}}},
				{"delivery", {{"down", trace.down_dispatched}, {"up", trace.up_dispatched}}},
				{"dispatch", {{"actionFired", false}, {"passed", false}}},
				{"postcondition", {{"kind", "missing-captured-state-or-action"},
				                   {"required", true}, {"result", "fail"}}},
				{"keyboard", "not-proved"}, {"escape", "not-proved"},
				{"hover", "not-proved"}, {"passed", false}
			});
		}
		root.set_bounds({0, 0, width, 700});
		root.layout_children();
		if (auto* composer = root.bound_composer(); composer && effectively_visible(*composer, root)) {
			const auto point = center_in_visible_root(*composer, root);
			const auto trace = pulp::test::mac::simulate_click_traced(
				*window, root, point.x, point.y);
			std::cout << "interaction trace width=" << width << " action=composer.focus"
			          << " point=" << trace.x << ',' << trace.y
			          << " press=" << trace.press_target
			          << " release=" << trace.release_target
			          << " actionable=" << trace.actionable_ancestor
			          << " focused=" << composer->has_focus() << '\n';
			if (!trace.down_dispatched || !trace.up_dispatched ||
			    !composer->has_focus() || !composer->focusable()) return 9;
		}
	}
	const auto report_directory = action_proof_directory
		? std::filesystem::path(action_proof_directory) : std::filesystem::path(argv[5]);
	std::filesystem::create_directories(report_directory);
	std::ofstream census_report(report_directory / "interaction-census.v1.json");
	census_report << nlohmann::json{
		{"schema", "palot-native-interaction-census-v1"},
		{"designIr", argv[1]},
		{"strict", true},
		{"summary", {{"controls", census_count}, {"failures", census_failures},
		             {"missingStateOrAction", missing_state_action_count},
		             {"nativeLocal", native_local_count}}},
		{"records", std::move(interaction_records)}}.dump(2) << '\n';
	if (!census_report.good()) {
		std::cerr << "failed to write strict interaction census report\n";
		return 13;
	}
	if (census_count == 0) return 10;
	if (census_failures != 0) {
		std::cerr << "production interaction census failures=" << census_failures
		          << " controls=" << census_count << '\n';
		return 13;
	}
	if (missing_state_action_count != 0) {
		std::cerr << "production interaction census controls=" << census_count
		          << " dead=0 action-dispatch-failures=0 gaps=" << missing_state_action_count
		          << " visible controls with pointer routing but no captured state transition, "
		             "application action, or native-local behavior\n";
		return 14;
	}

	auto* transcript = find_repeated_list(root, 30);
	if (!transcript || transcript->content_height() <= transcript->bounds().height) return 11;
	const auto before = transcript->scroll_y();
	const auto point = center_in_visible_root(*transcript, root);
	pulp::test::mac::SimulatedMouse wheel;
	wheel.phase = pulp::test::mac::SimulatedMouse::Phase::scroll;
	wheel.x = point.x;
	wheel.y = point.y;
	// AppKit reports the Cocoa wheel Y with the inverse sign of Pulp's
	// positive-down scroll convention; the production PulpView bridge performs
	// that conversion before routing to VirtualList.
	wheel.scroll_delta_y = -180.0f;
	if (!pulp::test::mac::simulate_mouse(*window, wheel) || transcript->scroll_y() <= before) {
		std::cerr << "production wheel did not advance transcript before=" << before
		          << " after=" << transcript->scroll_y() << " content="
		          << transcript->content_height() << " viewport=" << transcript->bounds().height << '\n';
		return 12;
	}

	std::cout << "production interaction census controls=" << census_count
	          << " dead=0 action-dispatch-failures=0 gaps=0 native-local="
	          << native_local_count
	          << " plus bound click, composer focus, and wheel routing pass\n";
	return EXIT_SUCCESS;
}
