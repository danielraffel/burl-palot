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
	return EXIT_SUCCESS;
}
