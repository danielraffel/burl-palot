#include "imported_root_host.hpp"
#include "mac_window_harness.hpp"

#include <pulp/view/text_editor.hpp>
#include <nlohmann/json.hpp>

#include <algorithm>
#include <cmath>
#include <cstdlib>
#include <iostream>
#include <fstream>
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

bool intersects_root(const pulp::view::View& view, const pulp::view::View& root) {
	const auto bounds = bounds_in_root(view, root);
	return bounds.x < root.bounds().width && bounds.y < root.bounds().height &&
	       bounds.x + bounds.width > 0.0f && bounds.y + bounds.height > 0.0f;
}

pulp::view::Point center_in_visible_root(const pulp::view::View& view,
                                         const pulp::view::View& root) {
	const auto bounds = bounds_in_root(view, root);
	const float left = std::max(0.0f, bounds.x);
	const float top = std::max(0.0f, bounds.y);
	const float right = std::min(root.bounds().width, bounds.x + bounds.width);
	const float bottom = std::min(root.bounds().height, bounds.y + bounds.height);
	return {(left + right) * 0.5f, (top + bottom) * 0.5f};
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

void collect_interactive(pulp::view::View& view, const pulp::view::View& root,
	                     const std::unordered_set<pulp::view::View*>& bound,
	                     std::vector<pulp::view::View*>& out) {
	if (effectively_visible(view, root) && intersects_root(view, root) && view.enabled() && view.hit_testable() &&
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
	if (argc != 5) return 2;
	ImportedRootHost root;
	std::unordered_map<std::string, int> calls;
	const std::vector<std::string> action_ids = {
		"command.palette.open", "composer.copy", "navigation.automations", "navigation.settings",
		"project.open", "project.search.toggle", "project.select", "prompt.cancel",
		"prompt.retry", "prompt.send", "server.menu.toggle", "session.create", "session.open",
		"sidebar.toggle"};
	for (const auto* id : {"command.palette.open", "composer.copy", "navigation.automations",
	                       "navigation.settings", "project.open", "project.search.toggle", "project.select",
	                       "prompt.cancel", "prompt.retry", "prompt.send", "server.menu.toggle",
	                       "session.create", "session.open", "sidebar.toggle"}) {
		root.register_action(id, [&, id](std::string_view) { ++calls[id]; });
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

	if (!root.unattached_actions().empty() || !root.unattached_required_actions().empty()) return 4;
	const auto candidates = nlohmann::json::parse(read_text(argv[3]));
	const auto policy_text = read_text(argv[4]);
	for (const auto& candidate : candidates.at("candidates")) {
		if (candidate.at("review").value("status", "") != "mapped") continue;
		const auto action = candidate.at("review").value("applicationAction", "");
		if (action.empty() || policy_text.find(action) == std::string::npos) {
			std::cerr << "mapped source interaction lacks policy coverage action=" << action
			          << " source=" << candidate.value("sourceId", "") << '\n';
			return 5;
		}
	}

	std::size_t census_count = 0;
	std::size_t census_failures = 0;
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
				const int before = calls[found->second];
				if (!send_mouse(*window, pulp::test::mac::SimulatedMouse::Phase::down, point) ||
				    !send_mouse(*window, pulp::test::mac::SimulatedMouse::Phase::up, point) ||
				    calls[found->second] != before + 1) {
					std::cerr << "production action dispatch failed width=" << width << " action="
					          << found->second << " anchor=" << control->anchor_id() << '\n';
					++census_failures;
				}
			} else if (control->focusable() && !dynamic_cast<pulp::view::TextEditor*>(control) &&
			           !control->wants_wheel_scroll()) {
				std::cerr << "visible focusable control has no application binding width=" << width
				          << " anchor=" << control->anchor_id() << " label=" << control->access_label() << '\n';
				++census_failures;
			}
			++census_count;
		}
		if (auto* composer = root.bound_composer(); composer && effectively_visible(*composer, root)) {
			const auto point = center_in_visible_root(*composer, root);
			if (!send_mouse(*window, pulp::test::mac::SimulatedMouse::Phase::down, point) ||
			    !send_mouse(*window, pulp::test::mac::SimulatedMouse::Phase::up, point) ||
			    !composer->has_focus() || !composer->focusable()) return 9;
		}
	}
	if (census_count == 0) return 10;
	if (census_failures != 0) {
		std::cerr << "production interaction census failures=" << census_failures
		          << " controls=" << census_count << '\n';
		return 13;
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

	std::cout << "production AppKit census: " << census_count
	          << " visible controls plus bound click, composer focus, and wheel routing pass\n";
	return EXIT_SUCCESS;
}
