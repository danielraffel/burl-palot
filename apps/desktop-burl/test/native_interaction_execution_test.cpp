#include "imported_root_host.hpp"

#include <pulp/view/buttons.hpp>
#include <pulp/view/pointer_dispatch.hpp>
#include <pulp/view/ui_components.hpp>
#include <pulp/view/widgets.hpp>
#include <pulp/canvas/canvas.hpp>
#include <pulp/view/screenshot.hpp>

#include <algorithm>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <functional>
#include <iostream>
#include <optional>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <utility>

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

std::optional<pulp::view::Rect> intersection(const pulp::view::Rect& a,
                                             const pulp::view::Rect& b) {
	const float left = std::max(a.x, b.x);
	const float top = std::max(a.y, b.y);
	const float right = std::min(a.x + a.width, b.x + b.width);
	const float bottom = std::min(a.y + a.height, b.y + b.height);
	if (right <= left || bottom <= top) return std::nullopt;
	return pulp::view::Rect{left, top, right - left, bottom - top};
}

std::optional<pulp::view::Rect> clipped_rect_in_root(const pulp::view::View& view,
                                                     const pulp::view::View& root) {
	auto visible = rect_in_root(view, root);
	for (auto* ancestor = view.parent(); ancestor; ancestor = ancestor->parent()) {
		const auto clip = rect_in_root(*ancestor, root);
		float left = visible.x;
		float top = visible.y;
		float right = visible.x + visible.width;
		float bottom = visible.y + visible.height;
		if (ancestor->clips_overflow_x()) {
			left = std::max(left, clip.x);
			right = std::min(right, clip.x + clip.width);
		}
		if (ancestor->clips_overflow_y()) {
			top = std::max(top, clip.y);
			bottom = std::min(bottom, clip.y + clip.height);
		}
		if (right <= left || bottom <= top) return std::nullopt;
		visible = {left, top, right - left, bottom - top};
		if (ancestor == &root) break;
	}
	return visible;
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
	                       "message.scroll-to-turn", "session.fork-from-message", "session.undo-to-message",
	                       "project.open", "project.search.toggle", "project.select", "prompt.cancel",
	                       "prompt.retry", "prompt.send", "review.panel.toggle", "server.menu.toggle",
	                       "session.create", "session.metrics.dismiss", "session.metrics.toggle", "session.open",
	                       "session.title.edit.begin", "settings.theme.select", "sidebar.toggle",
	                       "terminal.attach"})
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
		{"a1", "assistant", {{"message.text", "first response"},
		                         {"turn.id", "user-message-1"},
		                         {"turn.user-message-id", "user-message-1"},
		                         {"turn.next-user-message-id", "user-message-2"}}},
		{"u2", "user", {{"message.text", "second prompt"}}},
		{"a2", "assistant", {{"message.text", "second response"},
		                         {"turn.id", "user-message-2"},
		                         {"turn.user-message-id", "user-message-2"}}},
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
	float wide_main_height_at_800 = 0.0f;
	std::unordered_map<int, float> bottom_inset_by_width;
	for (const auto [width, height] : {std::pair{280.0f, 248.0f}, std::pair{280.0f, 420.0f},
	                                  std::pair{600.0f, 420.0f}, std::pair{1200.0f, 800.0f},
	                                  std::pair{1440.0f, 800.0f}, std::pair{1440.0f, 900.0f}}) {
		host.set_bounds({0, 0, width, height});
		host.layout_children();
		auto* main_panel = find_anchor_suffix(host, "main-data-slot-sidebar-inset:0");
		const pulp::view::Rect viewport{0, 0, width, height};
		const auto main_rect = main_panel ? rect_in_root(*main_panel, host) : pulp::view::Rect{};
		if (!main_panel ||
		    std::abs(main_panel->corner_radius_bl() - 16.5f) > 0.01f ||
		    std::abs(main_panel->corner_radius_br()) > 0.01f ||
		    !contains(viewport, main_rect)) {
			std::cerr << "main panel does not fill the available height viewport=" << width << 'x'
			          << height << " main=" << main_rect.x << ',' << main_rect.y << ','
			          << main_rect.width << ',' << main_rect.height << " radii="
			          << (main_panel ? main_panel->corner_radius_bl() : 0.0f) << ','
			          << (main_panel ? main_panel->corner_radius_br() : 0.0f) << '\n';
			return 16;
		}
		const float bottom_inset = height - (main_rect.y + main_rect.height);
		const int width_key = static_cast<int>(width);
		if (const auto found = bottom_inset_by_width.find(width_key);
		    found != bottom_inset_by_width.end() && std::abs(found->second - bottom_inset) > 0.5f) {
			std::cerr << "main panel bottom inset changed across heights viewport=" << width << 'x'
			          << height << " baselineInset=" << found->second << " actualInset="
			          << bottom_inset << " mainHeight=" << main_rect.height << '\n';
			return 16;
		} else {
			bottom_inset_by_width.emplace(width_key, bottom_inset);
		}
		if (width == 1440.0f && height == 800.0f) wide_main_height_at_800 = main_rect.height;
		if (width == 1440.0f && height == 900.0f &&
		    std::abs(main_rect.height - wide_main_height_at_800 - 100.0f) > 0.5f) {
			std::cerr << "main panel did not grow with viewport baseline=1440x800:" << wide_main_height_at_800
			          << " actual=1440x900:" << main_rect.height << " expectedGrowth=100 actualGrowth="
			          << main_rect.height - wide_main_height_at_800 << '\n';
			return 16;
		}
		for (const auto* id : {"composer.copy", "project.open", "project.select", "prompt.cancel", "session.create",
		                       "session.open"}) {
			for (auto* candidate : host.bound_action_views(id)) {
				auto* button = dynamic_cast<pulp::view::TextButton*>(candidate);
				if (!button || !effectively_visible(*button, host)) continue;
				const auto visible = intersection(rect_in_root(*button, host),
				                                  {0, 0, host.bounds().width, host.bounds().height});
				if (!visible) continue;
				const pulp::view::Point root_point{visible->x + visible->width * 0.5f,
				                                  visible->y + visible->height * 0.5f};
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
	const auto visible_transcript = clipped_rect_in_root(*transcript, host);
	if (!visible_transcript) return 19;
	const pulp::view::Point wheel_point{
		visible_transcript->x + visible_transcript->width * 0.5f,
		visible_transcript->y + visible_transcript->height * 0.5f};
	auto* wheel_target = pulp::view::find_wheel_scroll_view_at(host, wheel_point);
	if (!wheel_target || !descends_from(wheel_target, transcript)) {
		std::cerr << "wheel target missing point=" << wheel_point.x << ',' << wheel_point.y
		          << " transcript=" << rect_in_root(*transcript, host).x << ','
		          << rect_in_root(*transcript, host).y << ',' << transcript->bounds().width << ','
		          << transcript->bounds().height << " content=" << transcript->content_height()
		          << " children=" << transcript->child_count() << '\n';
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
	const float max_scroll = std::max(0.0f, transcript->content_height() - visible_transcript->height);
	if (transcript->scroll_y() <= 0.0f || std::abs(transcript->scroll_y() - max_scroll) > 0.5f) {
		std::cerr << "wheel scroll did not clamp to end target=" << wheel_target->anchor_id()
		          << " transcript=" << transcript->anchor_id() << " actual=" << transcript->scroll_y()
		          << " expected=" << max_scroll << " viewport=" << visible_transcript->height
		          << " content=" << transcript->content_height() << '\n';
		return 20;
	}
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
		std::function<void(pulp::view::View&)> report_labels = [&](pulp::view::View& view) {
			if (auto* label = dynamic_cast<pulp::view::Label*>(&view);
			    label && (label->text() == "palot" || label->text() == "acme-api" ||
			              label->text() == "landing-page"))
				std::cerr << "project-label " << label->text() << " bounds=" << label->bounds().width
				          << " intrinsic=" << label->intrinsic_width() << '\n';
			for (std::size_t i = 0; i < view.child_count(); ++i) report_labels(*view.child_at(i));
		};
		report_labels(host);
		const auto png = pulp::view::render_to_png(host, 1200, 800, 1.0f,
		                                             pulp::view::ScreenshotBackend::skia);
		std::ofstream output(proof, std::ios::binary);
		output.write(reinterpret_cast<const char*>(png.data()), static_cast<std::streamsize>(png.size()));
		if (!output.good() || png.empty()) return 15;
	}
	std::cout << "native interaction union: anchors, pointer down/up, endpoint, focus, keyboard, disabled, overlay and fail-closed diagnostics pass\n";
	return EXIT_SUCCESS;
}
