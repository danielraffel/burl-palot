#include "palot_view.hpp"

#include <pulp/platform/external_open.hpp>
#include <pulp/view/input_events.hpp>

#include <cstdlib>
#include <unordered_set>

namespace {
pulp::view::View* find_anchor_suffix(pulp::view::View& view, std::string_view suffix) {
	if (view.anchor_id().ends_with(suffix)) return &view;
	for (std::size_t index = 0; index < view.child_count(); ++index)
		if (auto* found = find_anchor_suffix(*view.child_at(index), suffix)) return found;
	return nullptr;
}

std::size_t visible_descendants(const pulp::view::View& view, bool ancestors_visible = true) {
	const bool visible = ancestors_visible && view.visible();
	if (!visible) return 0;
	std::size_t count = 1;
	for (std::size_t index = 0; index < view.child_count(); ++index)
		count += visible_descendants(*view.child_at(index), visible);
	return count;
}
}

int main(int argc, char** argv) {
	if (argc != 1 && argc != 3) return 31;
	PalotView view(argc == 3 ? argv[1] : std::filesystem::path{},
	               argc == 3 ? argv[2] : std::filesystem::path{});
	int external_open_calls = 0;
	std::string external_open_directory;
	pulp::platform::ExternalOpen::set_backend({
		.reveal = [&](const std::string& directory) {
			++external_open_calls;
			external_open_directory = directory;
			return true;
		},
	});
	int appearance_changes = 0;
	pulp::view::WindowAppearance last_appearance = pulp::view::WindowAppearance::system;
	view.on_window_appearance_change = [&](pulp::view::WindowAppearance appearance) {
		++appearance_changes;
		last_appearance = appearance;
	};
	view.set_bounds({0, 0, 1200, 700});
	view.layout_children();
	view.load_visual_parity_fixture();
	auto* imported_sidebar = find_anchor_suffix(view, "div-data-slot-sidebar:0");
	if (!imported_sidebar || !imported_sidebar->visible()) return 21;
	if (!view.sidebar_open() || view.server_menu_open() || view.project_search_open() ||
	    view.command_palette_open() || view.navigation_route() != "/") return 1;
	if (std::getenv("PALOT_ENDPOINT_STATE_PROOF")) {
		if (!view.invoke_imported_action("session.metrics.toggle") ||
		    !view.session_metrics_open())
			return 26;
		if (!view.invoke_imported_action("session.metrics.dismiss") ||
		    view.session_metrics_open())
			return 27;
		if (!view.invoke_imported_action("navigation.settings") ||
		    !view.invoke_imported_action("settings.theme.select") ||
		    view.theme_preference() != "light")
			return 28;
		if (appearance_changes != 1 || last_appearance != pulp::view::WindowAppearance::light)
			return 29;
		return EXIT_SUCCESS;
	}
	if (!view.invoke_imported_action("sidebar.toggle") || view.sidebar_open() ||
	    imported_sidebar->visible()) return 2;
	pulp::view::KeyEvent shortcut;
	shortcut.key = pulp::view::KeyCode::b;
	shortcut.modifiers = pulp::view::kModCmd;
	shortcut.is_down = true;
	if (!view.on_global_key || !view.on_global_key(shortcut) || !view.sidebar_open() ||
	    !imported_sidebar->visible()) return 3;
	for (const auto* action : {"disclosure.thought.toggle", "disclosure.read.toggle",
	                           "disclosure.edit.toggle"}) {
		const auto closed_count = visible_descendants(view);
		if (!view.invoke_imported_action(action)) return 22;
		view.layout_children();
		if (visible_descendants(view) <= closed_count) return 23;
		if (!view.invoke_imported_action(action)) return 24;
		view.layout_children();
		if (visible_descendants(view) != closed_count) return 25;
	}
	if (!view.invoke_imported_action("server.menu.toggle") || !view.server_menu_open()) return 4;
	if (!view.invoke_imported_action("navigation.settings") || view.server_menu_open() ||
	    view.navigation_route() != "/settings/general") return 5;
	if (!view.invoke_imported_action("project.search.toggle") || !view.project_search_open()) return 6;
	if (!view.invoke_imported_action("command.palette.open") || !view.command_palette_open()) return 7;
	if (!view.invoke_imported_action("navigation.automations") ||
	    view.navigation_route() != "/automations") return 8;
	if (!view.invoke_imported_action("session.title.edit.begin") || !view.title_editing()) return 9;
	pulp::view::KeyEvent review_shortcut;
	review_shortcut.key = pulp::view::KeyCode::d;
	review_shortcut.modifiers = pulp::view::kModCmd | pulp::view::kModShift;
	review_shortcut.is_down = true;
	if (!view.on_global_key(review_shortcut) || !view.review_panel_open()) return 10;
	if (!view.invoke_imported_action("review.diff.open") || !view.review_panel_open()) return 26;
	if (!view.invoke_imported_action("session.metrics.toggle") || !view.session_metrics_open()) return 11;
	if (!view.invoke_imported_action("session.metrics.dismiss") || view.session_metrics_open()) return 27;
	if (!view.invoke_imported_action("navigation.settings") ||
	    !view.invoke_imported_action("settings.theme.select") || view.theme_preference() != "light")
		return 28;
	if (appearance_changes != 1 || last_appearance != pulp::view::WindowAppearance::light)
		return 29;
	if (!view.invoke_imported_action("external.open.menu.toggle") || !view.external_open_menu_open()) return 12;
	if (!view.invoke_imported_action("external.open.preferred")) return 32;
	if (argc == 3 && (external_open_calls != 1 || external_open_directory.empty())) return 33;
	if (argc == 1 && external_open_calls != 0) return 34;
	if (!view.invoke_imported_action("composer.agent-menu.toggle") || !view.composer_agent_menu_open()) return 13;
	if (!view.invoke_imported_action("composer.model-menu.toggle") || !view.composer_model_menu_open()) return 14;
	if (!view.invoke_imported_action("composer.variant-menu.toggle") || !view.composer_variant_menu_open()) return 15;
	const auto mode = std::string(view.display_mode());
	if (!view.invoke_imported_action("display.mode.cycle") || view.display_mode() == mode) return 16;
	if (!view.invoke_imported_action("navigation.session.close") || view.navigation_route() != "/") return 17;
	const auto transcript = view.transcript_projection();
	std::unordered_set<std::string> tool_keys;
	std::size_t read_rows = 0;
	std::size_t edit_rows = 0;
	std::size_t reasoning_rows = 0;
	bool completed_duration = false;
	bool running_duration = false;
	bool structured_assistant_metadata = false;
	for (const auto& row : transcript) {
		if (row.key == "fixture-assistant-1") {
			structured_assistant_metadata =
				row.values.contains("message.text") &&
				row.values.at("message.text").find("anthropic.claude-opus-4-6") == std::string::npos &&
				row.values.contains("message.model") &&
				row.values.at("message.model") == "anthropic.claude-opus-4-6" &&
				row.values.contains("message.duration") &&
				row.values.at("message.duration") == "4m 58s" &&
				row.values.contains("message.cost") && row.values.at("message.cost") == "$0.01";
		}
		if (row.template_id == "reasoning") {
			++reasoning_rows;
			if (!row.values.contains("reasoning.label") ||
			    row.values.at("reasoning.label") != "Thought for 2 seconds") return 20;
			if (!row.values.contains("reasoning.text") || row.values.at("reasoning.text").empty()) return 30;
			continue;
		}
		if (row.template_id != "tool.read" && row.template_id != "tool.edit") continue;
		tool_keys.insert(row.key);
		read_rows += row.template_id == "tool.read";
		edit_rows += row.template_id == "tool.edit";
		completed_duration |= row.values.contains("tool.duration") && row.values.at("tool.duration") == "3s";
		running_duration |= row.values.contains("tool.duration") && row.values.at("tool.duration") == "…";
		if (!row.values.contains("tool.label") || !row.values.contains("tool.subject")) return 18;
	}
	if (tool_keys.size() != 4 || read_rows != 1 || edit_rows != 3 || reasoning_rows != 2 ||
	    !completed_duration || !running_duration || !structured_assistant_metadata) return 19;
	pulp::platform::ExternalOpen::clear_backend();
	return EXIT_SUCCESS;
}
