#include "imported_root_host.hpp"
#include "mac_window_harness.hpp"

#include <pulp/view/widgets.hpp>

#include <nlohmann/json.hpp>

#include <algorithm>
#include <cmath>
#include <filesystem>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <limits>
#include <set>
#include <sstream>
#include <string>
#include <string_view>
#include <unordered_map>
#include <vector>

namespace {

using json = nlohmann::json;
using pulp::view::Point;
using pulp::view::Rect;
using pulp::view::View;

constexpr float kGeometryTolerance = 1.0f;

Rect rect_in_root(const View& view, const View& root) {
	float x = 0.0f;
	float y = 0.0f;
	for (auto* current = &view; current && current != &root; current = current->parent()) {
		x += current->bounds().x;
		y += current->bounds().y;
	}
	return {x, y, view.bounds().width, view.bounds().height};
}

bool effectively_visible(const View& view, const View& root) {
	for (auto* current = &view; current; current = current->parent()) {
		if (!current->visible()) return false;
		if (current == &root) return true;
	}
	return false;
}

bool approximately(float actual, float expected) {
	return std::abs(actual - expected) <= kGeometryTolerance;
}

float right(const Rect& rect) { return rect.x + rect.width; }
float bottom(const Rect& rect) { return rect.y + rect.height; }

bool contains(const Rect& outer, const Rect& inner) {
	return inner.x >= outer.x - kGeometryTolerance &&
	       inner.y >= outer.y - kGeometryTolerance &&
	       right(inner) <= right(outer) + kGeometryTolerance &&
	       bottom(inner) <= bottom(outer) + kGeometryTolerance;
}

bool strictly_contains(const Rect& outer, const Rect& inner) {
	return inner.x >= outer.x && inner.y >= outer.y &&
	       right(inner) <= right(outer) && bottom(inner) <= bottom(outer);
}

bool intersects(const Rect& a, const Rect& b) {
	return a.x < right(b) - kGeometryTolerance && b.x < right(a) - kGeometryTolerance &&
	       a.y < bottom(b) - kGeometryTolerance && b.y < bottom(a) - kGeometryTolerance;
}

struct VisibleSubtreeGeometry {
	bool has_positive_geometry = false;
	bool entirely_within_viewport = true;
	Rect bounds{};
	std::size_t positive_view_count = 0;
	std::vector<std::pair<std::string, Rect>> viewport_violations;
};

VisibleSubtreeGeometry measure_visible_subtree(const View& view,
	                                           const View& root,
	                                           const Rect& viewport) {
	VisibleSubtreeGeometry result;
	const auto visit = [&](const View& candidate, const auto& self) -> void {
		if (!effectively_visible(candidate, root)) return;
		const auto rect = rect_in_root(candidate, root);
		if (rect.width > 0.0f && rect.height > 0.0f) {
			const bool within_viewport = strictly_contains(viewport, rect);
			result.entirely_within_viewport &= within_viewport;
			if (!within_viewport)
				result.viewport_violations.emplace_back(candidate.anchor_id(), rect);
			if (!result.has_positive_geometry) {
				result.bounds = rect;
				result.has_positive_geometry = true;
			} else {
				const float left = std::min(result.bounds.x, rect.x);
				const float top = std::min(result.bounds.y, rect.y);
				const float extent_right = std::max(right(result.bounds), right(rect));
				const float extent_bottom = std::max(bottom(result.bounds), bottom(rect));
				result.bounds = {left, top, extent_right - left, extent_bottom - top};
			}
			++result.positive_view_count;
		}
		for (std::size_t index = 0; index < candidate.child_count(); ++index)
			self(*candidate.child_at(index), self);
	};
	visit(view, visit);
	return result;
}

View* find_anchor(View& root, std::string_view anchor) {
	if (root.anchor_id() == anchor) return &root;
	for (std::size_t index = 0; index < root.child_count(); ++index)
		if (auto* found = find_anchor(*root.child_at(index), anchor)) return found;
	return nullptr;
}

void find_anchor_candidates(View& root, std::string_view anchor, std::vector<View*>& result) {
	const std::string_view candidate(root.anchor_id());
	if (candidate == anchor || candidate.ends_with(anchor)) result.push_back(&root);
	for (std::size_t index = 0; index < root.child_count(); ++index)
		find_anchor_candidates(*root.child_at(index), anchor, result);
}

std::string read_text(const std::filesystem::path& path) {
	std::ifstream input(path, std::ios::binary);
	return input ? std::string(std::istreambuf_iterator<char>(input), {}) : std::string{};
}

bool write_bytes(const std::filesystem::path& path, const std::vector<uint8_t>& bytes) {
	std::error_code error;
	std::filesystem::create_directories(path.parent_path(), error);
	if (error || bytes.empty()) return false;
	std::ofstream output(path, std::ios::binary | std::ios::trunc);
	output.write(reinterpret_cast<const char*>(bytes.data()),
	             static_cast<std::streamsize>(bytes.size()));
	return output.good();
}

bool write_json(const std::filesystem::path& path, const json& value) {
	std::error_code error;
	std::filesystem::create_directories(path.parent_path(), error);
	if (error) return false;
	std::ofstream output(path, std::ios::binary | std::ios::trunc);
	output << value.dump(2) << '\n';
	return output.good();
}

std::string fixture_fingerprint(std::string_view bytes) {
	uint64_t value = 1469598103934665603ULL;
	for (const auto byte : bytes) {
		value ^= static_cast<unsigned char>(byte);
		value *= 1099511628211ULL;
	}
	std::ostringstream output;
	output << std::hex << std::setfill('0') << std::setw(16) << value;
	return output.str();
}

std::optional<std::filesystem::path> resolve_repo_relative_evidence(
	const std::filesystem::path& contract_path,
	std::string_view relative_path) {
	if (relative_path.empty()) return std::nullopt;
	auto cursor = std::filesystem::absolute(contract_path).parent_path();
	while (!cursor.empty()) {
		const auto candidate = cursor / relative_path;
		if (std::filesystem::is_regular_file(candidate)) return candidate;
		const auto parent = cursor.parent_path();
		if (parent == cursor) break;
		cursor = parent;
	}
	return std::nullopt;
}

void collect_source_revisions(const json& node, std::set<std::string>& revisions) {
	if (node.is_object()) {
		if (const auto attributes = node.find("attributes"); attributes != node.end() &&
		    attributes->is_object()) {
			if (const auto revision = attributes->find("source_revision");
			    revision != attributes->end() && revision->is_string() && !revision->get<std::string>().empty())
				revisions.insert(revision->get<std::string>());
		}
		for (const auto& [key, value] : node.items()) {
			(void)key;
			collect_source_revisions(value, revisions);
		}
	} else if (node.is_array()) {
		for (const auto& value : node) collect_source_revisions(value, revisions);
	}
}

const json* find_source_node(const json& node, std::string_view anchor) {
	if (node.is_object()) {
		if (node.value("stable_anchor_id", "") == anchor) return &node;
		for (const auto& [key, value] : node.items()) {
			(void)key;
			if (const auto* found = find_source_node(value, anchor)) return found;
		}
	} else if (node.is_array()) {
		for (const auto& value : node)
			if (const auto* found = find_source_node(value, anchor)) return found;
	}
	return nullptr;
}

std::optional<Rect> source_rect(const json& node) {
	const auto raw_source = node.value("raw_source", "");
	if (raw_source.empty()) return std::nullopt;
	const auto raw = json::parse(raw_source, nullptr, false);
	if (raw.is_discarded()) return std::nullopt;
	const auto rect = raw.value("node", json::object()).value("rect", json::object());
	if (!rect.is_object()) return std::nullopt;
	return Rect{rect.value("x", 0.0f), rect.value("y", 0.0f),
	            rect.value("width", 0.0f), rect.value("height", 0.0f)};
}

std::optional<float> source_fixed_height_at_width(const json& node, float width) {
	const auto responsive = node.value("responsive", json::object());
	const auto variants = responsive.value("verticalVariants", json::array());
	if (!variants.empty()) {
		std::size_t selected = 0;
		for (std::size_t index = 0; index + 1 < variants.size(); ++index) {
			const auto transition = variants[index].value("transitionToNext", json::object());
			if (!transition.empty() && width >= transition.value("upperBound", 0.0f)) selected = index + 1;
		}
		const auto constraint = variants[selected].value("constraint", json::object());
		if (constraint.value("kind", "") == "fixed") return constraint.value("value", 0.0f);
	}
	const auto vertical = responsive.value("vertical", json::object());
	if (vertical.value("kind", "") == "fixed") return vertical.value("value", 0.0f);
	return std::nullopt;
}

std::string find_anchor_by_slot(const json& node, std::string_view slot) {
	if (node.is_object()) {
		if (node.value("attributes", json::object()).value("sourceDataSlot", "") == slot)
			return node.value("stable_anchor_id", "");
		for (const auto& [key, value] : node.items()) {
			(void)key;
			if (auto found = find_anchor_by_slot(value, slot); !found.empty()) return found;
		}
	} else if (node.is_array()) {
		for (const auto& value : node)
			if (auto found = find_anchor_by_slot(value, slot); !found.empty()) return found;
	}
	return {};
}

std::string find_form_containing_slot(const json& node, std::string_view slot) {
	if (!node.is_object() && !node.is_array()) return {};
	if (node.is_object() && !find_anchor_by_slot(node, slot).empty()) {
		const auto raw_source = node.value("raw_source", "");
		if (!raw_source.empty()) {
			const auto raw = json::parse(raw_source, nullptr, false);
			if (!raw.is_discarded() && raw.value("node", json::object()).value("tagName", "") ==
			                              "form")
				return node.value("stable_anchor_id", "");
		}
	}
	if (node.is_object()) {
		for (const auto& [key, value] : node.items()) {
			(void)key;
			if (auto found = find_form_containing_slot(value, slot); !found.empty()) return found;
		}
	} else {
		for (const auto& value : node)
			if (auto found = find_form_containing_slot(value, slot); !found.empty()) return found;
	}
	return {};
}

std::string find_state_width_anchor(const json& node, std::string_view state_key) {
	if (node.is_object()) {
		const auto responsive = node.value("responsive", json::object());
		if (responsive.contains("applicationStateVariants")) {
			bool has_closed_width = false;
			bool has_open_width = false;
			bool has_closed_state = false;
			bool has_open_state = false;
			for (const auto& variant : responsive["applicationStateVariants"]) {
				if (variant.value("key", "") != state_key) continue;
				const bool is_closed = variant.value("value", "") == "closed";
				const bool is_open = variant.value("value", "") == "open";
				has_closed_state |= is_closed;
				has_open_state |= is_open;
				const bool has_width = variant.contains("layout") &&
				                       variant["layout"].contains("width");
				has_closed_width |= is_closed && has_width;
				has_open_width |= is_open && has_width;
			}
			const bool has_base_width = responsive.value("applicationStateBase", json::object())
			                                .value("layout", json::object()).contains("width");
			if (has_closed_state && has_open_state &&
			    ((has_closed_width && has_open_width) ||
			     (has_base_width && (has_closed_width || has_open_width))))
				return node.value("stable_anchor_id", "");
		}
		for (const auto& [key, value] : node.items()) {
			(void)key;
			if (auto found = find_state_width_anchor(value, state_key); !found.empty()) return found;
		}
	} else if (node.is_array()) {
		for (const auto& value : node)
			if (auto found = find_state_width_anchor(value, state_key); !found.empty()) return found;
	}
	return {};
}

std::string find_state_owner_anchor(const json& node,
	                                std::string_view state_key,
	                                std::string_view visible_value) {
	if (node.is_object()) {
		const auto responsive = node.value("responsive", json::object());
		if (responsive.value("applicationStateKey", "") == state_key &&
		    responsive.value("visibilityByApplicationState", json::object())
		        .value(std::string(visible_value), false))
			return node.value("stable_anchor_id", "");
		for (const auto& [key, value] : node.items()) {
			(void)key;
			if (auto found = find_state_owner_anchor(value, state_key, visible_value);
			    !found.empty())
				return found;
		}
	} else if (node.is_array()) {
		for (const auto& value : node)
			if (auto found = find_state_owner_anchor(value, state_key, visible_value);
			    !found.empty())
				return found;
	}
	return {};
}

json rect_json(const Rect& rect) {
	return {{"x", rect.x}, {"y", rect.y}, {"width", rect.width}, {"height", rect.height},
	        {"right", right(rect)}, {"bottom", bottom(rect)}};
}

struct Anchors {
	std::string main;
	std::string sidebar;
	std::string app_bar;
	std::string composer;
	std::string chat_frame;
	std::vector<std::string> composer_accessories;
	std::string review_panel;
};

bool subtree_contains_anchor(const json& node, std::string_view anchor) {
	if (node.is_object()) {
		if (node.value("stable_anchor_id", "") == anchor) return true;
		for (const auto& [key, value] : node.items()) {
			(void)key;
			if (subtree_contains_anchor(value, anchor)) return true;
		}
	} else if (node.is_array()) {
		for (const auto& value : node)
			if (subtree_contains_anchor(value, anchor)) return true;
	}
	return false;
}

struct ChatFrameAnchors {
	std::string frame;
	std::vector<std::string> accessories;
};

bool has_positive_source_geometry(const json& node) {
	const auto raw_source = node.value("raw_source", "");
	if (raw_source.empty()) return false;
	const auto raw = json::parse(raw_source, nullptr, false);
	if (raw.is_discarded()) return false;
	const auto rect = raw.value("node", json::object()).value("rect", json::object());
	return rect.value("width", 0.0f) > 0.0f && rect.value("height", 0.0f) > 0.0f;
}

ChatFrameAnchors find_complete_chat_frame(const json& node, std::string_view composer_anchor) {
	if (!node.is_object()) return {};
	const auto children = node.value("children", json::array());
	for (const auto& child : children) {
		if (auto nested = find_complete_chat_frame(child, composer_anchor); !nested.frame.empty())
			return nested;
	}
	if (children.size() < 2) return {};
	std::size_t composer_branch = children.size();
	for (std::size_t index = 0; index < children.size(); ++index) {
		if (subtree_contains_anchor(children[index], composer_anchor)) {
			composer_branch = index;
			break;
		}
	}
	if (composer_branch == children.size()) return {};
	ChatFrameAnchors result{.frame = node.value("stable_anchor_id", "")};
	for (std::size_t index = 0; index < children.size(); ++index) {
		if (index == composer_branch) continue;
		if (!has_positive_source_geometry(children[index])) continue;
		if (const auto anchor = children[index].value("stable_anchor_id", ""); !anchor.empty())
			result.accessories.push_back(anchor);
	}
	if (result.frame.empty() || result.accessories.empty()) return {};
	return result;
}

Anchors discover_anchors(const json& ir) {
	const auto composer = find_form_containing_slot(ir, "input-group");
	const auto chat_frame = find_complete_chat_frame(ir.at("root"), composer);
	auto review_panel = find_state_width_anchor(ir, "review.panel.open");
	if (review_panel.empty())
		review_panel = find_state_owner_anchor(ir, "review.panel.open", "open");
	return {
		.main = find_anchor_by_slot(ir, "sidebar-inset"),
		.sidebar = find_anchor_by_slot(ir, "sidebar"),
		.app_bar = find_anchor_by_slot(ir, "app-bar"),
		.composer = composer,
		.chat_frame = chat_frame.frame,
		.composer_accessories = chat_frame.accessories,
		.review_panel = std::move(review_panel),
	};
}

std::vector<pulp::view::ImportedListItem> transcript_fixture() {
	return {
		{"user", "user", {{"message.text", "Check production geometry."}}},
		{"assistant", "assistant", {{"message.text", "The native layout remains responsive."}}},
	};
}

void register_actions(ImportedRootHost& root,
                      const json& bindings,
                      std::unordered_map<std::string, uint64_t>& calls) {
	for (const auto& action : bindings.at("actions")) {
		const auto id = action.at("id").get<std::string>();
		root.register_action(id, [&, id](std::string_view) {
			++calls[id];
		});
	}
}

Point center(const View& view, const View& root) {
	const auto rect = rect_in_root(view, root);
	return {rect.x + rect.width * 0.5f, rect.y + rect.height * 0.5f};
}

bool click_action(pulp::view::WindowHost& window,
	              ImportedRootHost& root,
	              std::unordered_map<std::string, uint64_t>& calls,
	              std::string_view action,
	              json& trace_json) {
	const auto views = root.bound_action_views(action);
	if (views.size() != 1) {
		trace_json = {{"action", action}, {"boundViewCount", views.size()}, {"passed", false}};
		return false;
	}
	const auto point = center(*views.front(), root);
	const auto trace = pulp::test::mac::simulate_click_traced(
		window, root, point.x, point.y,
		[&calls, key = std::string(action)] { return calls[key]; });
	root.layout_children();
	trace_json = {
		{"action", action}, {"x", trace.x}, {"y", trace.y},
		{"pressTarget", trace.press_target}, {"releaseTarget", trace.release_target},
		{"actionableAncestor", trace.actionable_ancestor},
		{"downDispatched", trace.down_dispatched}, {"upDispatched", trace.up_dispatched},
		{"actionFired", trace.action_fired}, {"outcomeBefore", trace.outcome_before},
		{"outcomeAfter", trace.outcome_after},
	};
	const bool passed = trace.down_dispatched && trace.up_dispatched && trace.action_fired &&
	                    trace.outcome_after == trace.outcome_before + 1;
	trace_json["passed"] = passed;
	return passed;
}

View* largest_sibling_before(const View& view) {
	if (!view.parent()) return nullptr;
	View* result = nullptr;
	float area = 0.0f;
	for (std::size_t index = 0; index < view.parent()->child_count(); ++index) {
		auto* sibling = view.parent()->child_at(index);
		if (sibling == &view || !sibling->visible()) continue;
		const float candidate_area = sibling->bounds().width * sibling->bounds().height;
		if (candidate_area > area) {
			area = candidate_area;
			result = sibling;
		}
	}
	return result;
}

View* leftmost_visible_label(View& view, const View& root) {
	View* result = nullptr;
	float left = std::numeric_limits<float>::max();
	const auto visit = [&](View& candidate, const auto& self) -> void {
		if (!effectively_visible(candidate, root)) return;
		if (const auto* label = dynamic_cast<const pulp::view::Label*>(&candidate);
		    label && !label->text().empty()) {
			const auto rect = rect_in_root(candidate, root);
			if (rect.width > 0.0f && rect.height > 0.0f && rect.x < left) {
				left = rect.x;
				result = &candidate;
			}
		}
		for (std::size_t index = 0; index < candidate.child_count(); ++index)
			self(*candidate.child_at(index), self);
	};
	visit(view, visit);
	return result;
}

float minimum_usable_width(const View& view, const View& root) {
	if (!effectively_visible(view, root)) return 0.0f;
	const auto& flex = view.flex();
	float own = std::max(1.0f, view.intrinsic_width());
	if (flex.dim_min_width.unit == pulp::view::DimensionUnit::px)
		own = std::max(own, flex.dim_min_width.value);
	std::vector<float> children;
	for (std::size_t index = 0; index < view.child_count(); ++index) {
		const auto* child = view.child_at(index);
		if (!effectively_visible(*child, root) || child->position() == View::Position::absolute ||
		    child->position() == View::Position::fixed)
			continue;
		children.push_back(minimum_usable_width(*child, root));
	}
	if (children.empty()) return own;
	const float horizontal_padding = std::max(0.0f, flex.padding_left) +
	                                 std::max(0.0f, flex.padding_right);
	if (flex.direction == pulp::view::FlexDirection::row ||
	    flex.direction == pulp::view::FlexDirection::row_reverse) {
		float total = horizontal_padding;
		for (const auto width : children) total += width;
		const float gap = flex.column_gap >= 0.0f ? flex.column_gap : std::max(0.0f, flex.gap);
		if (children.size() > 1) total += gap * static_cast<float>(children.size() - 1);
		return flex.flex_wrap == pulp::view::FlexWrap::no_wrap ? std::max(own, total)
		                                                     : std::max(own, *std::max_element(children.begin(), children.end()) + horizontal_padding);
	}
	return std::max(own, *std::max_element(children.begin(), children.end()) + horizontal_padding);
}

bool subtree_has_positive_visible_geometry(const View& view, const View& root) {
	if (view.visible()) {
		const auto rect = rect_in_root(view, root);
		if (rect.width > kGeometryTolerance && rect.height > kGeometryTolerance) return true;
	}
	for (std::size_t index = 0; index < view.child_count(); ++index)
		if (subtree_has_positive_visible_geometry(*view.child_at(index), root)) return true;
	return false;
}

json collect_layout_diagnostics(View& root, const Rect& viewport) {
	json offscreen = json::array();
	json overlaps = json::array();
	json wraps = json::array();
	const auto visit = [&](View& candidate, const auto& self) -> void {
		if (!effectively_visible(candidate, root)) return;
		const auto candidate_rect = rect_in_root(candidate, root);
		if (candidate_rect.width > 0.0f && candidate_rect.height > 0.0f &&
		    !contains(viewport, candidate_rect))
			offscreen.push_back({{"anchor", candidate.anchor_id()}, {"bounds", rect_json(candidate_rect)}});

		std::vector<View*> visible_children;
		for (std::size_t index = 0; index < candidate.child_count(); ++index) {
			auto* child = candidate.child_at(index);
			if (effectively_visible(*child, root) && child->bounds().width > 0.0f &&
			    child->bounds().height > 0.0f)
				visible_children.push_back(child);
		}
		for (std::size_t left_index = 0; left_index < visible_children.size(); ++left_index) {
			for (std::size_t right_index = left_index + 1; right_index < visible_children.size(); ++right_index) {
				const auto left_rect = visible_children[left_index]->bounds();
				const auto right_rect = visible_children[right_index]->bounds();
				if (intersects(left_rect, right_rect))
					overlaps.push_back({{"parent", candidate.anchor_id()},
					                    {"first", visible_children[left_index]->anchor_id()},
					                    {"second", visible_children[right_index]->anchor_id()},
					                    {"firstBounds", rect_json(left_rect)},
					                    {"secondBounds", rect_json(right_rect)}});
			}
		}
		const auto direction = candidate.flex().direction;
		if ((direction == pulp::view::FlexDirection::row ||
		     direction == pulp::view::FlexDirection::row_reverse) && visible_children.size() > 1) {
			std::vector<float> line_origins;
			for (const auto* child : visible_children) {
				const float origin = child->bounds().y;
				if (std::ranges::none_of(line_origins, [&](float prior) { return approximately(prior, origin); }))
					line_origins.push_back(origin);
			}
			float child_extent = 0.0f;
			for (const auto* child : visible_children) child_extent = std::max(child_extent, child->bounds().right());
			if (line_origins.size() > 1 || child_extent > candidate.bounds().width + kGeometryTolerance)
				wraps.push_back({{"anchor", candidate.anchor_id()},
				                 {"bounds", rect_json(candidate_rect)},
				                 {"lineCount", line_origins.size()},
				                 {"wrapEnabled", candidate.flex().flex_wrap != pulp::view::FlexWrap::no_wrap},
				                 {"childRight", child_extent},
				                 {"availableWidth", candidate.bounds().width}});
		}
		for (auto* child : visible_children) self(*child, self);
	};
	visit(root, visit);
	return {{"offscreen", offscreen}, {"siblingOverlaps", overlaps}, {"horizontalWraps", wraps}};
}

json evaluate_geometry(ImportedRootHost& root,
	                   const Anchors& anchors,
	                   float width,
	                   float height,
	                   bool sidebar_expected_closed,
	                   bool review_expected_open,
	                   std::optional<float> source_composer_height,
	                   float maximum_source_footer_inset) {
	json checks = json::object();
	json geometry = json::object();
	const Rect viewport{0, 0, width, height};
	auto* main = find_anchor(root, anchors.main);
	auto* sidebar = find_anchor(root, anchors.sidebar);
	auto* app_bar = find_anchor(root, anchors.app_bar);
	auto* composer = find_anchor(root, anchors.composer);
	auto* chat_frame = find_anchor(root, anchors.chat_frame);
	auto* review = find_anchor(root, anchors.review_panel);
	const auto toggle_views = root.bound_action_views("sidebar.toggle");

	if (main) geometry["main"] = rect_json(rect_in_root(*main, root));
	if (sidebar) geometry["sidebar"] = rect_json(rect_in_root(*sidebar, root));
	if (app_bar) geometry["appBar"] = rect_json(rect_in_root(*app_bar, root));
	if (composer) geometry["composer"] = rect_json(rect_in_root(*composer, root));
	if (chat_frame) geometry["chatFrame"] = rect_json(rect_in_root(*chat_frame, root));
	geometry["composerAccessories"] = json::array();
	bool accessories_present = !anchors.composer_accessories.empty();
	bool accessories_visible = !anchors.composer_accessories.empty();
	bool accessories_contained = !anchors.composer_accessories.empty();
	for (const auto& anchor : anchors.composer_accessories) {
		std::vector<View*> candidates;
		find_anchor_candidates(root, anchor, candidates);
		accessories_present &= !candidates.empty();
		bool candidate_visible = false;
		bool candidate_contained = true;
		json candidate_geometry = json::array();
		for (auto* accessory : candidates) {
			const auto measured = measure_visible_subtree(*accessory, root, viewport);
			candidate_visible |= measured.has_positive_geometry;
			if (measured.has_positive_geometry)
				candidate_contained &= measured.entirely_within_viewport;
			json viewport_violations = json::array();
			for (const auto& [violation_anchor, violation_bounds] : measured.viewport_violations)
				viewport_violations.push_back({
					{"anchor", violation_anchor},
					{"bounds", rect_json(violation_bounds)},
				});
			candidate_geometry.push_back({
				{"bounds", rect_json(measured.bounds)},
				{"positiveViewCount", measured.positive_view_count},
				{"anchor", accessory->anchor_id()},
				{"viewportViolations", std::move(viewport_violations)},
			});
		}
		geometry["composerAccessories"].push_back(std::move(candidate_geometry));
		accessories_visible &= candidate_visible;
		accessories_contained &= candidate_contained;
	}
	if (review) geometry["reviewPanel"] = rect_json(rect_in_root(*review, root));
	if (toggle_views.size() == 1)
		geometry["sidebarToggle"] = rect_json(rect_in_root(*toggle_views.front(), root));
	View* leading_header_label = app_bar ? leftmost_visible_label(*app_bar, root) : nullptr;
	if (leading_header_label)
		geometry["leadingHeaderLabel"] = rect_json(rect_in_root(*leading_header_label, root));

	checks["requiredGeometryPresent"] = main && sidebar && app_bar && composer && chat_frame && review &&
	                                      accessories_present &&
	                                      toggle_views.size() == 1;
	if (main) {
		const auto rect = rect_in_root(*main, root);
		checks["mainConsumesRightEdge"] = approximately(right(rect), width);
		checks["mainConsumesBottomEdge"] = approximately(bottom(rect), height);
		checks["mainWithinViewport"] = contains(viewport, rect);
	}
	if (composer && main) {
		const auto composer_rect = rect_in_root(*composer, root);
		const bool fully_occluded_by_review = review_expected_open && review &&
			rect_in_root(*review, root).width >= rect_in_root(*main, root).width - kGeometryTolerance;
		checks["composerWithinMain"] = fully_occluded_by_review ||
			contains(rect_in_root(*main, root), composer_rect);
		checks["composerWithinBottomEdge"] = fully_occluded_by_review ||
			bottom(composer_rect) <= height + kGeometryTolerance;
		geometry["minimumUsableComposerWidth"] = minimum_usable_width(*composer, root);
		checks["composerHasUsableWidth"] = composer_rect.width + kGeometryTolerance >=
		                                    minimum_usable_width(*composer, root);
		if (source_composer_height)
			checks["composerMatchesSourceResponsiveHeight"] =
				approximately(composer_rect.height, *source_composer_height);
		if (chat_frame) {
			const auto frame_rect = rect_in_root(*chat_frame, root);
			checks["completeChatFrameWithinMain"] = fully_occluded_by_review ||
				contains(rect_in_root(*main, root), frame_rect);
			checks["completeChatFrameWithinViewport"] = fully_occluded_by_review ||
				contains(viewport, frame_rect);
			checks["completeChatFrameContainsComposer"] = fully_occluded_by_review ||
				contains(frame_rect, composer_rect);
			checks["composerAccessoriesVisible"] = fully_occluded_by_review || accessories_visible;
			checks["composerAccessoriesWithinViewport"] =
				fully_occluded_by_review || accessories_contained;
			float footer_bottom = 0.0f;
			for (const auto& accessory_group : geometry["composerAccessories"])
				for (const auto& accessory : accessory_group)
					footer_bottom = std::max(footer_bottom, accessory["bounds"].value("bottom", 0.0f));
			geometry["composerFooterBottom"] = footer_bottom;
			checks["composerFooterPinnedToBottom"] = fully_occluded_by_review ||
				footer_bottom <= height + kGeometryTolerance &&
				height - footer_bottom <= maximum_source_footer_inset + kGeometryTolerance;
		}
	}
	if (toggle_views.size() == 1 && effectively_visible(*toggle_views.front(), root))
		checks["toggleSlotDoesNotOverlapLeadingHeaderContent"] =
			!leading_header_label ||
			!intersects(rect_in_root(*leading_header_label, root),
			            rect_in_root(*toggle_views.front(), root));
	if (sidebar && sidebar_expected_closed) {
		checks["sidebarClosed"] = !effectively_visible(*sidebar, root);
		checks["sidebarClosedHasZeroGeometry"] = sidebar->bounds().width == 0.0f &&
		                                               sidebar->bounds().height == 0.0f;
		checks["sidebarClosedCannotHitTest"] = sidebar->hit_test({0.0f, 0.0f}) == nullptr;
	}
	if (review) {
		const auto review_rect = rect_in_root(*review, root);
		checks["reviewConsumesRightEdge"] = approximately(right(review_rect), width);
		checks["reviewConsumesBottomEdge"] = approximately(bottom(review_rect), height);
		checks[review_expected_open ? "reviewOpen" : "reviewClosed"] =
			review_expected_open ? review_rect.width > 2.0f : review_rect.width <= 2.0f;
		if (review_expected_open) {
			if (auto* conversation = largest_sibling_before(*review)) {
				const auto conversation_rect = rect_in_root(*conversation, root);
				geometry["conversationPanel"] = rect_json(conversation_rect);
				checks["conversationMeetsReviewPanel"] =
					approximately(right(conversation_rect), review_rect.x);
				checks["conversationConsumesBottomEdge"] = approximately(bottom(conversation_rect), height);
				if (composer && review_rect.width < rect_in_root(*main, root).width - kGeometryTolerance)
					checks["composerWithinConversation"] =
						contains(conversation_rect, rect_in_root(*composer, root));
				checks["conversationRetainsUsableWidth"] = composer &&
					conversation_rect.width + kGeometryTolerance >= minimum_usable_width(*composer, root);
			}
		}
	}
	json unexpected_top_level_surfaces = json::array();
	for (std::size_t index = 1; index < root.child_count(); ++index) {
		const auto* surface = root.child_at(index);
		if (!subtree_has_positive_visible_geometry(*surface, root)) continue;
		unexpected_top_level_surfaces.push_back({
			{"anchor", surface->anchor_id()},
			{"bounds", rect_json(rect_in_root(*surface, root))},
		});
	}
	geometry["unexpectedRestTopLevelSurfaces"] = unexpected_top_level_surfaces;
	checks["noUnexpectedRestOverlay"] = View::active_overlay_ == nullptr &&
	                                          unexpected_top_level_surfaces.empty();
	geometry["diagnostics"] = collect_layout_diagnostics(root, viewport);

	bool passed = !checks.empty();
	for (const auto& [key, value] : checks.items()) {
		(void)key;
		passed &= value.is_boolean() && value.get<bool>();
	}
	return {{"geometry", geometry}, {"checks", checks}, {"passed", passed}};
}

bool capture_state(pulp::view::WindowHost& window,
	               const std::filesystem::path& output,
	               std::string_view viewport,
	               std::string_view state,
	               json& record) {
	auto frames = pulp::test::mac::capture_settled_back_buffer_png(window, 4);
	if (frames.empty()) return false;
	const auto path = output / (std::string(viewport) + "-" + std::string(state) + ".png");
	const bool written = write_bytes(path, frames.back().png);
	record["screenshot"] = path.string();
	record["capturedFrames"] = frames.size();
	record["captureElapsedMs"] = frames.back().elapsed_ms;
	record["screenshotWritten"] = written;
	return written;
}

}  // namespace

int main(int argc, char** argv) {
	if (argc != 5) return 2;
	const auto ir_bytes = read_text(argv[1]);
	const auto binding_bytes = read_text(argv[2]);
	const auto source_window_bytes = read_text(argv[3]);
	const auto ir = json::parse(ir_bytes);
	const auto bindings = json::parse(binding_bytes);
	const auto source_window_json = json::parse(source_window_bytes);
	const auto source_window = pulp::view::parse_source_window_contract_json(source_window_bytes);
	if (!source_window) return 3;
	const auto anchors = discover_anchors(ir);
	if (anchors.main.empty() || anchors.sidebar.empty() || anchors.app_bar.empty() ||
	    anchors.composer.empty() || anchors.chat_frame.empty() ||
	    anchors.composer_accessories.empty() || anchors.review_panel.empty())
		return 4;
	std::set<std::string> source_revisions;
	collect_source_revisions(ir, source_revisions);
	const auto contract_revision = source_window_json.value("projection", json::object())
		.value("minimumContentSize", json::object()).value("sourceRevision", "");
	const auto minimum_contract = source_window_json.value("projection", json::object())
		.value("minimumContentSize", json::object());
	const auto minimum_evidence_path = resolve_repo_relative_evidence(
		argv[3], minimum_contract.value("evidence", ""));
	json minimum_evidence;
	json capture_ledger;
	std::string minimum_evidence_bytes;
	std::string capture_ledger_bytes;
	std::optional<std::filesystem::path> capture_ledger_path;
	if (minimum_evidence_path) {
		minimum_evidence_bytes = read_text(*minimum_evidence_path);
		minimum_evidence = json::parse(minimum_evidence_bytes, nullptr, false);
		if (!minimum_evidence.is_discarded()) {
			const auto ledger_name = minimum_evidence.value("canonicalCaptureSet", "");
			if (!ledger_name.empty()) {
				const auto candidate = minimum_evidence_path->parent_path() / ledger_name;
				if (std::filesystem::is_regular_file(candidate)) {
					capture_ledger_path = candidate;
					capture_ledger_bytes = read_text(candidate);
					capture_ledger = json::parse(capture_ledger_bytes, nullptr, false);
				}
			}
		}
	}
	json minimum_capture;
	if (capture_ledger.is_object()) {
		for (const auto& capture : capture_ledger.value("captures", json::array())) {
			const auto viewport = capture.value("viewport", json::object());
			if (viewport.value("width", 0.0f) == minimum_contract.value("width", 0.0f) &&
			    viewport.value("height", 0.0f) + 1.0f == minimum_contract.value("height", 0.0f)) {
				minimum_capture = capture;
				break;
			}
		}
	}
	const bool immutable_source_evidence_matches = minimum_evidence.is_object() &&
		capture_ledger.is_object() && minimum_capture.is_object() &&
		minimum_evidence.value("sourceRevision", "") == contract_revision &&
		capture_ledger.value("sourceRevision", "") == contract_revision &&
		minimum_evidence.value("minimum", json::object()).value("width", 0.0f) ==
			source_window->minimum_width &&
		minimum_evidence.value("minimum", json::object()).value("height", 0.0f) ==
			source_window->minimum_height &&
		!minimum_capture.value("evidenceSha256", "").empty() &&
		!minimum_capture.value("screenshotSha256", "").empty() &&
		!minimum_capture.value("metadataSha256", "").empty();
	const bool identical_source_fixture = source_revisions.size() == 1 &&
	                                        !contract_revision.empty() &&
	                                        *source_revisions.begin() == contract_revision &&
	                                        immutable_source_evidence_matches;
	const auto* composer_source = find_source_node(ir, anchors.composer);
	const auto* chat_frame_source = find_source_node(ir, anchors.chat_frame);
	const auto root_source_rect = source_rect(ir.at("root"));
	const auto chat_frame_source_rect = chat_frame_source ? source_rect(*chat_frame_source) : std::nullopt;
	if (!composer_source || !root_source_rect || !chat_frame_source_rect) return 4;
	const float maximum_source_footer_inset = std::max(
		0.0f, bottom(*root_source_rect) - bottom(*chat_frame_source_rect));

	const std::filesystem::path output(argv[4]);
	json receipt = {
		{"schema", "burl-native-layout-transition-census-v1"},
		{"coordinateSpace", "production AppKit content coordinates, top-left logical pixels"},
		{"sourceWindowMinimum", {{"width", source_window->minimum_width},
		                         {"height", source_window->minimum_height}}},
		{"fixtureIdentity", {
			{"ir", {{"path", std::filesystem::absolute(argv[1]).string()},
			        {"bytes", ir_bytes.size()}, {"fingerprint", fixture_fingerprint(ir_bytes)}}},
			{"bindings", {{"path", std::filesystem::absolute(argv[2]).string()},
			              {"bytes", binding_bytes.size()}, {"fingerprint", fixture_fingerprint(binding_bytes)}}},
			{"sourceWindow", {{"path", std::filesystem::absolute(argv[3]).string()},
			                  {"bytes", source_window_bytes.size()}, {"fingerprint", fixture_fingerprint(source_window_bytes)}}},
			{"irSourceRevisions", source_revisions},
			{"contractSourceRevision", contract_revision},
			{"immutableSourceEvidence", {
				{"minimumContractPath", minimum_evidence_path ? minimum_evidence_path->string() : ""},
				{"minimumContractFingerprint", fixture_fingerprint(minimum_evidence_bytes)},
				{"captureLedgerPath", capture_ledger_path ? capture_ledger_path->string() : ""},
				{"captureLedgerFingerprint", fixture_fingerprint(capture_ledger_bytes)},
				{"minimumCaptureEvidenceSha256", minimum_capture.value("evidenceSha256", "")},
				{"minimumCaptureScreenshotSha256", minimum_capture.value("screenshotSha256", "")},
				{"minimumCaptureMetadataSha256", minimum_capture.value("metadataSha256", "")},
				{"matches", immutable_source_evidence_matches},
			}},
			{"identicalSourceFixture", identical_source_fixture},
		}},
		{"sourceGeometry", {{"root", rect_json(*root_source_rect)},
		                    {"completeChatFrame", rect_json(*chat_frame_source_rect)},
		                    {"maximumFooterBottomInset", maximum_source_footer_inset}}},
		{"viewports", json::array()},
	};
	std::size_t failures = identical_source_fixture ? 0 : 1;
	{
		View boundary_root;
		boundary_root.set_bounds({0, 0, source_window->minimum_width,
		                          source_window->minimum_height});
		pulp::view::WindowOptions options;
		options.title = "Native minimum-size rejection probe";
		options.width = 280;
		options.height = 248;
		options.resizable = true;
		source_window->apply(options);
		auto window = pulp::test::mac::make_test_window(boundary_root, options);
		if (!window) return 5;
		const auto native = pulp::test::mac::resize_and_measure_native_content(*window, 280.0f, 248.0f);
		const bool rejected = 248.0f < source_window->minimum_height &&
		                      approximately(native.window_width, source_window->minimum_width) &&
		                      approximately(native.window_height, source_window->minimum_height) &&
		                      approximately(native.hosted_width, source_window->minimum_width) &&
		                      approximately(native.hosted_height, source_window->minimum_height);
		receipt["underMinimumBoundaryProbe"] = {
			{"requested", {{"width", 280.0f}, {"height", 248.0f}}},
			{"hosted", {{"width", native.hosted_width}, {"height", native.hosted_height}}},
			{"expectedMinimum", {{"width", source_window->minimum_width},
			                     {"height", source_window->minimum_height}}},
			{"rejected", rejected},
			{"passed", rejected},
		};
		failures += rejected ? 0 : 1;
	}
	for (const auto& [width, height, label] :
	     std::vector<std::tuple<float, float, std::string>>{
		     {1200.0f, 800.0f, "1200x800"},
		     {1200.0f, 1000.0f, "1200x1000"},
		     {768.0f, 800.0f, "768x800"},
		     {599.0f, 420.0f, "599x420"},
		     {280.0f, 421.0f, "280x421"},
	     }) {
		const bool fixture_stable = fixture_fingerprint(read_text(argv[1])) == fixture_fingerprint(ir_bytes) &&
		                            fixture_fingerprint(read_text(argv[2])) == fixture_fingerprint(binding_bytes) &&
		                            fixture_fingerprint(read_text(argv[3])) == fixture_fingerprint(source_window_bytes) &&
		                            minimum_evidence_path && capture_ledger_path &&
		                            fixture_fingerprint(read_text(*minimum_evidence_path)) ==
			                            fixture_fingerprint(minimum_evidence_bytes) &&
		                            fixture_fingerprint(read_text(*capture_ledger_path)) ==
			                            fixture_fingerprint(capture_ledger_bytes);
		failures += fixture_stable ? 0 : 1;
		ImportedRootHost root;
		const float expected_width = std::max(width, source_window->minimum_width);
		const float expected_height = std::max(height, source_window->minimum_height);
		std::unordered_map<std::string, uint64_t> calls;
		register_actions(root, bindings, calls);
		root.load(argv[1], argv[2]);
		root.set_projects({{"project", "project", {{"project.name", "palot"},
		                                                  {"directory", "/fixture/palot"}}}});
		root.set_transcript(transcript_fixture());
		root.set_transcript_auto_follow(false);
		root.set_application_state("navigation.route", "chat");
		root.set_application_state("sidebar.open", "open");
		root.set_application_state("review.panel.open", "closed");
		root.set_bounds({0, 0, expected_width, expected_height});
		root.layout_children();

		pulp::view::WindowOptions options;
		options.title = "Native layout transition census";
		options.width = static_cast<int>(width);
		options.height = static_cast<int>(height);
		options.resizable = true;
		source_window->apply(options);
		auto window = pulp::test::mac::make_test_window(root, options);
		if (!window) return 5;
		const auto native = pulp::test::mac::resize_and_measure_native_content(*window, width, height);
		root.layout_children();

		json viewport = {
			{"label", label}, {"requested", {{"width", width}, {"height", height}}},
			{"fixtureStable", fixture_stable},
			{"native", {{"windowWidth", native.window_width}, {"windowHeight", native.window_height},
			            {"hostedWidth", native.hosted_width}, {"hostedHeight", native.hosted_height}}},
			{"states", json::array()}, {"transitions", json::array()},
		};
		const bool native_matches = approximately(native.window_width, expected_width) &&
		                            approximately(native.window_height, expected_height) &&
		                            approximately(native.hosted_width, expected_width) &&
		                            approximately(native.hosted_height, expected_height) &&
		                            approximately(root.bounds().width, expected_width) &&
		                            approximately(root.bounds().height, expected_height);
		viewport["nativeBoundsPassed"] = native_matches;
		failures += native_matches ? 0 : 1;

		const auto expected_composer_height = source_fixed_height_at_width(*composer_source, expected_width);
		auto append_state = [&](std::string_view state, bool sidebar_closed, bool review_open) {
			json record = evaluate_geometry(root, anchors, expected_width, expected_height,
			                                sidebar_closed, review_open, expected_composer_height,
			                                maximum_source_footer_inset);
			const bool captured = capture_state(*window, output, label, state, record);
			record["name"] = state;
			record["passed"] = record.value("passed", false) && captured;
			failures += record["passed"].get<bool>() ? 0 : 1;
			viewport["states"].push_back(std::move(record));
		};

		append_state("sidebar-open", false, false);
		json sidebar_close_trace;
		const bool sidebar_close = click_action(*window, root, calls, "sidebar.toggle", sidebar_close_trace);
		viewport["transitions"].push_back(sidebar_close_trace);
		failures += sidebar_close ? 0 : 1;
		append_state("sidebar-closed", true, false);
		json sidebar_open_trace;
		const bool sidebar_open = click_action(*window, root, calls, "sidebar.toggle", sidebar_open_trace);
		viewport["transitions"].push_back(sidebar_open_trace);
		failures += sidebar_open ? 0 : 1;
		append_state("sidebar-reopened", false, false);

		json review_open_trace;
		const bool review_open = click_action(*window, root, calls, "review.panel.toggle", review_open_trace);
		viewport["transitions"].push_back(review_open_trace);
		failures += review_open ? 0 : 1;
		append_state("changes-open", false, true);
		json review_close_trace;
		const bool review_close = click_action(*window, root, calls, "review.panel.toggle", review_close_trace);
		viewport["transitions"].push_back(review_close_trace);
		failures += review_close ? 0 : 1;
		append_state("changes-reclosed", false, false);
		receipt["viewports"].push_back(std::move(viewport));
	}

	receipt["failureCount"] = failures;
	receipt["passed"] = failures == 0;
	if (!write_json(output / "receipt.json", receipt)) return 6;
	std::cout << "native layout transition census failures=" << failures
	          << " receipt=" << (output / "receipt.json") << '\n';
	return failures == 0 ? EXIT_SUCCESS : EXIT_FAILURE;
}
