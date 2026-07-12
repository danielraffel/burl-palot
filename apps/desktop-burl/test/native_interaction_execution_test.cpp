#include "imported_root_host.hpp"

#include <pulp/view/buttons.hpp>
#include <pulp/view/pointer_dispatch.hpp>

#include <algorithm>
#include <cstdlib>
#include <iostream>
#include <string>
#include <unordered_map>

namespace {

pulp::view::Point center_in_root(const pulp::view::View& view, const pulp::view::View& root) {
	float x = view.bounds().width * 0.5f;
	float y = view.bounds().height * 0.5f;
	for (auto* current = &view; current && current != &root; current = current->parent()) {
		x += current->bounds().x;
		y += current->bounds().y;
	}
	return {x, y};
}

bool descends_from(pulp::view::View* candidate, const pulp::view::View* ancestor) {
	for (auto* current = candidate; current; current = current->parent())
		if (current == ancestor) return true;
	return false;
}

bool effectively_visible(const pulp::view::View& view, const pulp::view::View& root) {
	for (auto* current = &view; current; current = current->parent()) {
		if (!current->visible()) return false;
		if (current == &root) return true;
	}
	return false;
}

}  // namespace

int main(int argc, char** argv) {
	if (argc != 3) return 2;
	ImportedRootHost host;
	std::unordered_map<std::string, int> calls;
	for (const auto* id : {"composer.copy", "project.open", "project.select", "prompt.cancel",
	                       "prompt.retry", "prompt.send", "session.create", "session.open"})
		host.register_action(id, [&calls, id](std::string_view) { ++calls[id]; });
	host.load(argv[1], argv[2]);
	if (host.unattached_actions().size() != 1 || host.unattached_actions().front() != "project.open")
		return 3;
	if (!host.bound_action_views("project.open").empty() || host.invoke_bound_action("project.open"))
		return 4;

	std::unordered_map<std::string, int> exercised;
	for (const float width : {599.0f, 768.0f, 1200.0f}) {
		host.set_bounds({0, 0, width, 800});
		host.layout_children();
		for (const auto* id : {"composer.copy", "project.select", "prompt.cancel", "session.create",
		                       "session.open"}) {
			for (auto* candidate : host.bound_action_views(id)) {
				auto* button = dynamic_cast<pulp::view::TextButton*>(candidate);
				if (!button || !effectively_visible(*button, host)) continue;
				const auto root_point = center_in_root(*button, host);
				auto* down_target = host.hit_test(root_point);
				if (!down_target || !descends_from(down_target, button)) {
					std::cerr << "dead overlay width=" << width << " action=" << id
					          << " anchor=" << button->anchor_id() << " target="
					          << (down_target ? down_target->anchor_id() : "<none>") << " point="
					          << root_point.x << ',' << root_point.y << " bounds=" << button->bounds().x
					          << ',' << button->bounds().y << ',' << button->bounds().width << ','
					          << button->bounds().height << '\n';
					for (auto* ancestor = button->parent(); ancestor && ancestor != &host;
					     ancestor = ancestor->parent())
						std::cerr << " ancestor=" << ancestor->anchor_id() << " bounds="
						          << ancestor->bounds().x << ',' << ancestor->bounds().y << ','
						          << ancestor->bounds().width << ',' << ancestor->bounds().height << '\n';
					return 5;
				}
				const auto local = pulp::view::point_to_local(root_point, down_target, &host);
				button->on_focus_changed(true);
				if (!button->has_focus()) return 6;
				const int before_pointer = calls[id];
				down_target->on_mouse_down(local);
				auto* up_target = host.hit_test(root_point);
				if (up_target != down_target) return 7;
				up_target->on_mouse_up(local);
				if (calls[id] != before_pointer + 1) return 8;

				const int before_keyboard = calls[id];
				if (!button->on_key_event({.key = pulp::view::KeyCode::enter, .is_down = true}) ||
				    !button->on_key_event({.key = pulp::view::KeyCode::enter, .is_down = false}) ||
				    calls[id] != before_keyboard + 1)
					return 9;

				button->set_enabled(false);
				const int before_disabled = calls[id];
				button->on_mouse_down(local);
				button->on_mouse_up(local);
				if (button->on_key_event({.key = pulp::view::KeyCode::space, .is_down = true}) ||
				    calls[id] != before_disabled)
					return 10;
				button->set_enabled(true);
				button->on_focus_changed(false);
				++exercised[id];
			}
		}
	}
	for (const auto* id : {"project.select", "prompt.cancel", "session.create", "session.open"})
		if (exercised[id] == 0) return 11;
	std::cout << "native interaction union: anchors, pointer down/up, endpoint, focus, keyboard, disabled, overlay and fail-closed diagnostics pass\n";
	return EXIT_SUCCESS;
}
