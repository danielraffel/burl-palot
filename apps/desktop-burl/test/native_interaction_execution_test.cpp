#include "imported_root_host.hpp"

#include <pulp/view/buttons.hpp>
#include <pulp/view/pointer_dispatch.hpp>
#include <pulp/view/ui_components.hpp>
#include <pulp/canvas/canvas.hpp>
#include <pulp/view/screenshot.hpp>

#include <algorithm>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <string>
#include <unordered_map>
#include <unordered_set>

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

pulp::view::Rect rect_in_root(const pulp::view::View& view, const pulp::view::View& root) {
	auto center = center_in_root(view, root);
	return {center.x - view.bounds().width * 0.5f, center.y - view.bounds().height * 0.5f,
	        view.bounds().width, view.bounds().height};
}

bool contains(const pulp::view::Rect& outer, const pulp::view::Rect& inner) {
	return inner.x >= outer.x && inner.y >= outer.y &&
	       inner.x + inner.width <= outer.x + outer.width &&
	       inner.y + inner.height <= outer.y + outer.height;
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

pulp::view::View* find_anchor_suffix(pulp::view::View& root, std::string_view suffix) {
	if (std::string_view(root.anchor_id()).ends_with(suffix)) return &root;
	for (std::size_t index = 0; index < root.child_count(); ++index)
		if (auto* found = find_anchor_suffix(*root.child_at(index), suffix)) return found;
	return nullptr;
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

}  // namespace

int main(int argc, char** argv) {
	if (argc != 3) return 2;
	ImportedRootHost host;
	std::unordered_map<std::string, int> calls;
	std::unordered_map<std::string, std::string> payloads;
	for (const auto* id : {"command.palette.open", "composer.agent-menu.toggle", "composer.attachment.open",
	                       "composer.copy", "composer.model-menu.toggle", "composer.variant-menu.toggle",
	                       "display.mode.cycle", "external.open.menu.toggle", "external.open.preferred",
	                       "navigation.automations", "navigation.session.close", "navigation.settings",
	                       "project.open", "project.search.toggle", "project.select", "prompt.cancel",
	                       "prompt.retry", "prompt.send", "review.panel.toggle", "server.menu.toggle",
	                       "session.create", "session.metrics.toggle", "session.open", "session.title.edit.begin",
	                       "sidebar.toggle", "terminal.attach"})
		host.register_action(id, [&calls, &payloads, id](std::string_view payload) {
			++calls[id]; payloads[id] = payload;
		});
	host.load(argv[1], argv[2]);
	host.set_projects({
		{"project-a", "project", {{"id", "project-a"}, {"project.name", "palot"},
		                                {"directory", "/fixture/palot"}, {"status", "active"}}},
		{"project-b", "project", {{"id", "project-b"}, {"project.name", "acme-api"},
		                                {"directory", "/fixture/acme-api"}, {"status", "idle"}}},
		{"project-c", "project", {{"id", "project-c"}, {"project.name", "landing-page"},
		                                {"directory", "/fixture/landing-page"}, {"status", "idle"}}},
	});
	host.set_transcript({
		{"u1", "user", {{"message.text", "first prompt"}}},
		{"a1", "assistant", {{"message.text", "first response"}}},
		{"u2", "user", {{"message.text", "second prompt"}}},
		{"a2", "assistant", {{"message.text", "second response"}}},
	});
	host.set_bounds({0, 0, 280, 248});
	host.layout_children();
	auto* minimum_main = find_anchor_suffix(host, "main-data-slot-sidebar-inset:0");
	auto* minimum_composer = find_anchor_suffix(host, "form-shape-b21c5bbc:0");
	auto* minimum_textarea = find_anchor_suffix(host, "textarea-data-slot-input-group-control:0");
	const pulp::view::Rect minimum_viewport{0, 0, 280, 248};
	if (!minimum_main || !minimum_composer || !minimum_textarea ||
	    !contains(minimum_viewport, rect_in_root(*minimum_main, host)) ||
	    !contains(rect_in_root(*minimum_main, host), rect_in_root(*minimum_composer, host)) ||
	    !contains(rect_in_root(*minimum_composer, host), rect_in_root(*minimum_textarea, host))) {
		const auto main_rect = minimum_main ? rect_in_root(*minimum_main, host) : pulp::view::Rect{};
		const auto composer_rect = minimum_composer ? rect_in_root(*minimum_composer, host) : pulp::view::Rect{};
		const auto textarea_rect = minimum_textarea ? rect_in_root(*minimum_textarea, host) : pulp::view::Rect{};
		std::cerr << "minimum content size clips the imported chat frame main=" << main_rect.x << ','
		          << main_rect.y << ',' << main_rect.width << ',' << main_rect.height << " composer="
		          << composer_rect.x << ',' << composer_rect.y << ',' << composer_rect.width << ','
		          << composer_rect.height << " textarea=" << textarea_rect.x << ',' << textarea_rect.y
		          << ',' << textarea_rect.width << ',' << textarea_rect.height << '\n';
		for (auto* current = minimum_composer; current && current != &host; current = current->parent()) {
			const auto rect = rect_in_root(*current, host);
			std::cerr << " composer-ancestor=" << current->anchor_id() << " rect=" << rect.x << ','
			          << rect.y << ',' << rect.width << ',' << rect.height;
			if (auto* scroll = dynamic_cast<pulp::view::ScrollView*>(current))
				std::cerr << " scroll=" << scroll->scroll_x() << ',' << scroll->scroll_y();
			std::cerr << '\n';
		}
		return 17;
	}
	if (!host.unattached_actions().empty()) {
		for (const auto& action : host.unattached_actions()) std::cerr << "unattached=" << action << '\n';
		return 3;
	}
	std::unordered_map<std::string, int> exercised;
	for (const float width : {599.0f, 768.0f, 1200.0f}) {
		host.set_bounds({0, 0, width, 800});
		host.layout_children();
		auto* main_panel = find_anchor_suffix(host, "main-data-slot-sidebar-inset:0");
		if (!main_panel ||
		    std::abs(main_panel->corner_radius_bl() - 16.5f) > 0.01f ||
		    std::abs(main_panel->corner_radius_br() - 16.5f) > 0.01f ||
		    std::abs(main_panel->bounds().height - 788.0f) > 0.01f ||
		    std::abs(main_panel->bounds().width - (width < 768.0f ? width - 24.0f : width - 292.0f)) > 0.01f)
			return 16;
		for (const auto* id : {"composer.copy", "project.open", "project.select", "prompt.cancel", "session.create",
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
				button->on_focus_changed(true);
				if (!button->has_focus()) return 6;
				const int before_pointer = calls[id];
				host.simulate_click(root_point);
				if (calls[id] != before_pointer + 1) {
					std::cerr << "pointer callback count action=" << id << " before=" << before_pointer
					          << " after=" << calls[id] << '\n';
					return 8;
				}

				const int before_keyboard = calls[id];
				if (!button->on_key_event({.key = pulp::view::KeyCode::enter, .is_down = true}) ||
				    !button->on_key_event({.key = pulp::view::KeyCode::enter, .is_down = false}) ||
				    calls[id] != before_keyboard + 1)
					return 9;

				button->set_enabled(false);
				const int before_disabled = calls[id];
				host.simulate_click(root_point);
				if (button->on_key_event({.key = pulp::view::KeyCode::space, .is_down = true}) ||
				    calls[id] != before_disabled)
					return 10;
				button->set_enabled(true);
				button->on_focus_changed(false);
				++exercised[id];
			}
		}
	}
	for (const auto* id : {"project.open", "project.select", "prompt.cancel", "session.create", "session.open"})
		if (exercised[id] == 0) { std::cerr << "unexercised=" << id << '\n'; return 11; }
	if (payloads["project.open"].empty()) return 12;

	std::vector<pulp::view::ImportedListItem> scroll_rows;
	for (int index = 0; index < 24; ++index) {
		scroll_rows.push_back({"scroll-" + std::to_string(index), index % 2 ? "assistant" : "user",
		                       {{"message.text", "Scrollable imported message " + std::to_string(index) +
		                                             " with enough text to exercise wrapped row geometry."}}});
	}
	host.set_transcript(std::move(scroll_rows));
	host.set_bounds({0, 0, 1200, 520});
	host.layout_children();
	auto* transcript = find_repeated_list(host, 24);
	if (!transcript || transcript->content_height() <= transcript->bounds().height) return 18;
	const auto wheel_point = center_in_root(*transcript, host);
	auto* wheel_target = pulp::view::find_wheel_scroll_view_at(host, wheel_point);
	if (!wheel_target || !descends_from(wheel_target, transcript)) {
		std::cerr << "wheel target missing point=" << wheel_point.x << ',' << wheel_point.y
		          << " transcript=" << rect_in_root(*transcript, host).x << ','
		          << rect_in_root(*transcript, host).y << ',' << transcript->bounds().width << ','
		          << transcript->bounds().height << " children=" << transcript->child_count() << '\n';
		for (std::size_t index = 0; index < transcript->child_count(); ++index) {
			auto* child = transcript->child_at(index);
			std::cerr << " child=" << child->anchor_id() << " bounds=" << child->bounds().x << ','
			          << child->bounds().y << ',' << child->bounds().width << ',' << child->bounds().height
			          << " wheel=" << child->wants_wheel_scroll() << '\n';
		}
		for (auto* current = transcript->parent(); current && current != &host; current = current->parent())
			std::cerr << " ancestor=" << current->anchor_id() << " bounds=" << current->bounds().x << ','
			          << current->bounds().y << ',' << current->bounds().width << ',' << current->bounds().height << '\n';
		return 19;
	}
	pulp::view::MouseEvent wheel;
	wheel.is_wheel = true;
	wheel.scroll_delta_y = 100000.0f;
	wheel_target->on_mouse_event(wheel);
	const float max_scroll = std::max(0.0f, transcript->content_height() - transcript->bounds().height);
	if (transcript->scroll_y() <= 0.0f || std::abs(transcript->scroll_y() - max_scroll) > 0.5f)
		return 20;
	wheel.scroll_delta_y = -100000.0f;
	wheel_target->on_mouse_event(wheel);
	if (std::abs(transcript->scroll_y()) > 0.01f) return 21;

	pulp::canvas::RecordingCanvas canvas;
	host.paint_all(canvas);
	std::unordered_set<std::string> painted_projects;
	bool opaque_project_foreground = false;
	std::unordered_set<std::string> painted_composite_labels;
	pulp::canvas::Color current_fill;
	for (const auto& command : canvas.commands()) {
		if (command.type == pulp::canvas::DrawCommand::Type::set_fill_color) {
			current_fill = command.color;
		}
		if (command.type == pulp::canvas::DrawCommand::Type::fill_text &&
		    (command.text == "palot" || command.text == "acme-api" || command.text == "landing-page")) {
			painted_projects.insert(command.text);
			opaque_project_foreground = current_fill.a > 0.9f &&
				(current_fill.r + current_fill.g + current_fill.b) > 1.5f;
		}
		if (command.type == pulp::canvas::DrawCommand::Type::fill_text) {
			for (const auto* label : {"New Session", "Automations", "This Mac", "Settings"})
				if (command.text.find(label) != std::string::npos) painted_composite_labels.insert(label);
		}
	}
	if (painted_projects.size() != 3 || !opaque_project_foreground) {
		std::cerr << "painted project labels=" << painted_projects.size()
		          << " opaque=" << opaque_project_foreground << '\n';
		return 13;
	}
	if (painted_composite_labels.size() != 4) return 14;
	if (const auto* proof = std::getenv("PALOT_PROJECT_ROW_PROOF")) {
		const auto png = pulp::view::render_to_png(host, 1200, 800, 1.0f,
		                                             pulp::view::ScreenshotBackend::skia);
		std::ofstream output(proof, std::ios::binary);
		output.write(reinterpret_cast<const char*>(png.data()), static_cast<std::streamsize>(png.size()));
		if (!output.good() || png.empty()) return 15;
	}
	std::cout << "native interaction union: anchors, pointer down/up, endpoint, focus, keyboard, disabled, overlay and fail-closed diagnostics pass\n";
	return EXIT_SUCCESS;
}
