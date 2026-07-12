#include "palot_view.hpp"

#include <pulp/view/input_events.hpp>

#include <cstdlib>
#include <unordered_set>

int main() {
	PalotView view;
	if (!view.sidebar_open() || view.server_menu_open() || view.project_search_open() ||
	    view.command_palette_open() || view.navigation_route() != "/") return 1;
	if (!view.invoke_imported_action("sidebar.toggle") || view.sidebar_open()) return 2;
	pulp::view::KeyEvent shortcut;
	shortcut.key = pulp::view::KeyCode::b;
	shortcut.modifiers = pulp::view::kModCmd;
	shortcut.is_down = true;
	if (!view.on_global_key || !view.on_global_key(shortcut) || !view.sidebar_open()) return 3;
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
	if (!view.invoke_imported_action("session.metrics.toggle") || !view.session_metrics_open()) return 11;
	if (!view.invoke_imported_action("external.open.menu.toggle") || !view.external_open_menu_open()) return 12;
	if (!view.invoke_imported_action("composer.agent-menu.toggle") || !view.composer_agent_menu_open()) return 13;
	if (!view.invoke_imported_action("composer.model-menu.toggle") || !view.composer_model_menu_open()) return 14;
	if (!view.invoke_imported_action("composer.variant-menu.toggle") || !view.composer_variant_menu_open()) return 15;
	const auto mode = std::string(view.display_mode());
	if (!view.invoke_imported_action("display.mode.cycle") || view.display_mode() == mode) return 16;
	if (!view.invoke_imported_action("navigation.session.close") || view.navigation_route() != "/") return 17;
	view.load_visual_parity_fixture();
	const auto transcript = view.transcript_projection();
	std::unordered_set<std::string> tool_keys;
	std::size_t read_rows = 0;
	std::size_t edit_rows = 0;
	std::size_t reasoning_rows = 0;
	bool completed_duration = false;
	bool running_duration = false;
	for (const auto& row : transcript) {
		if (row.template_id == "reasoning") {
			++reasoning_rows;
			if (!row.values.contains("reasoning.label") ||
			    row.values.at("reasoning.label") != "Thought for 2 seconds") return 20;
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
	    !completed_duration || !running_duration) return 19;
	return EXIT_SUCCESS;
}
