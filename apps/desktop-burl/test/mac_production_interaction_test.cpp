#include "imported_root_host.hpp"
#include "mac_window_harness.hpp"

#include <pulp/view/text_editor.hpp>

#include <cmath>
#include <cstdlib>
#include <iostream>
#include <string>
#include <vector>

namespace {

pulp::view::Point center_in_root(const pulp::view::View& view,
                                 const pulp::view::View& root) {
	float x = view.bounds().width * 0.5f;
	float y = view.bounds().height * 0.5f;
	for (auto* current = &view; current && current != &root; current = current->parent()) {
		x += current->bounds().x;
		y += current->bounds().y;
	}
	return {x, y};
}

bool effectively_visible(const pulp::view::View& view, const pulp::view::View& root) {
	for (auto* current = &view; current; current = current->parent()) {
		if (!current->visible()) return false;
		if (current == &root) return true;
	}
	return false;
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

bool send_mouse(pulp::view::WindowHost& window,
                pulp::test::mac::SimulatedMouse::Phase phase,
                pulp::view::Point point) {
	pulp::test::mac::SimulatedMouse event;
	event.phase = phase;
	event.x = point.x;
	event.y = point.y;
	return pulp::test::mac::simulate_mouse(window, event);
}

}  // namespace

int main(int argc, char** argv) {
	if (argc != 3) return 2;
	ImportedRootHost root;
	int create_calls = 0;
	for (const auto* id : {"composer.copy", "project.open", "project.select", "prompt.cancel",
	                       "prompt.retry", "prompt.send", "session.create", "session.open"}) {
		root.register_action(id, [&, id](std::string_view) {
			if (std::string_view(id) == "session.create") ++create_calls;
		});
	}
	root.load(argv[1], argv[2]);
	root.set_projects({{"project", "project", {{"project.name", "held project"},
	                                                {"directory", "/fixture/project"}}}});
	std::vector<pulp::view::ImportedListItem> rows;
	for (int index = 0; index < 30; ++index) {
		rows.push_back({"message-" + std::to_string(index), index % 2 ? "assistant" : "user",
		                {{"message.text", "Production AppKit wheel row " + std::to_string(index) +
		                                      " with enough content to wrap."}}});
	}
	root.set_transcript_auto_follow(false);
	root.set_transcript(std::move(rows));
	root.set_bounds({0, 0, 1200, 700});
	root.layout_children();

	pulp::view::WindowOptions options;
	options.title = "Palot production interaction test";
	options.width = 1200;
	options.height = 700;
	auto window = pulp::test::mac::make_test_window(root, options);
	if (!window) return 3;
	root.layout_children();

	pulp::view::View* create = nullptr;
	for (auto* candidate : root.bound_action_views("session.create")) {
		if (candidate && effectively_visible(*candidate, root)) { create = candidate; break; }
	}
	if (!create) return 4;
	const auto create_point = center_in_root(*create, root);
	if (!send_mouse(*window, pulp::test::mac::SimulatedMouse::Phase::down, create_point) ||
	    !send_mouse(*window, pulp::test::mac::SimulatedMouse::Phase::up, create_point) ||
	    create_calls != 1)
		return 5;

	if (auto* composer = root.bound_composer(); composer && effectively_visible(*composer, root)) {
		const auto composer_point = center_in_root(*composer, root);
		if (!send_mouse(*window, pulp::test::mac::SimulatedMouse::Phase::down, composer_point) ||
		    !send_mouse(*window, pulp::test::mac::SimulatedMouse::Phase::up, composer_point) ||
		    !composer->has_focus())
			return 6;
	}

	auto* transcript = find_repeated_list(root, 30);
	if (!transcript || transcript->content_height() <= transcript->bounds().height) return 7;
	const auto before = transcript->scroll_y();
	const auto point = center_in_root(*transcript, root);
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
		return 8;
	}

	std::cout << "production AppKit path: bound click, composer focus, and wheel routing pass\n";
	return EXIT_SUCCESS;
}
