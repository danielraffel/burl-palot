#include "palot_view.hpp"

#include <pulp/view/input_events.hpp>

#include <cstdlib>

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
	return EXIT_SUCCESS;
}
