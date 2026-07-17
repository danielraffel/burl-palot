#include "imported_root_host.hpp"

#include <pulp/view/design_ir.hpp>
#include <pulp/view/accessibility_tree.hpp>
#include <pulp/view/buttons.hpp>
#include <pulp/view/text_editor.hpp>
#include <pulp/view/widgets.hpp>
#include <pulp/canvas/canvas.hpp>
#include <pulp/canvas/text_shaper.hpp>

#include <algorithm>
#include <cstdlib>
#include <fstream>
#include <iostream>
#include <sstream>
#include <stdexcept>
#include <tuple>
#include <unordered_map>

namespace {

class ShapingRecordingCanvas final : public pulp::canvas::RecordingCanvas {
public:
	void set_font(const std::string& family, float size) override {
		family_ = family;
		size_ = size;
		weight_ = 400;
		slant_ = 0;
		letter_spacing_ = 0.0f;
		RecordingCanvas::set_font(family, size);
	}

	void set_font_full(const std::string& family, float size, int weight, int slant,
	                   float letter_spacing) override {
		family_ = family;
		size_ = size;
		weight_ = weight;
		slant_ = slant;
		letter_spacing_ = letter_spacing;
		RecordingCanvas::set_font_full(family, size, weight, slant, letter_spacing);
	}

	float measure_text(const std::string& text) override {
		pulp::canvas::AttributedString attributed;
		pulp::canvas::TextSpan span;
		span.text = text;
		span.font_family = family_;
		span.font_size = size_;
		span.font_weight = weight_;
		span.italic = slant_ != 0;
		span.letter_spacing = letter_spacing_;
		attributed.append(std::move(span));
		return pulp::canvas::global_text_shaper().prepare(attributed).total_width();
	}

private:
	std::string family_ = "Inter";
	float size_ = 14.0f;
	int weight_ = 400;
	int slant_ = 0;
	float letter_spacing_ = 0.0f;
};

bool forbidden_renderer(const pulp::view::IRNode& node) {
	if (node.type == "webview" || node.type == "chromium" || node.type == "iframe") return true;
	for (const auto& child : node.children) {
		if (forbidden_renderer(child)) return true;
	}
	return false;
}

std::string read_text(const char* path) {
	std::ifstream input(path);
	std::ostringstream bytes;
	bytes << input.rdbuf();
	return bytes.str();
}

std::vector<std::string> comma_separated(std::string_view value) {
	std::vector<std::string> result;
	std::size_t begin = 0;
	while (begin <= value.size()) {
		const auto end = value.find(',', begin);
		const auto item = value.substr(begin, end == std::string_view::npos ? value.size() - begin
		                                                                    : end - begin);
		if (!item.empty()) result.emplace_back(item);
		if (end == std::string_view::npos) break;
		begin = end + 1;
	}
	std::ranges::sort(result);
	return result;
}

void register_actions(ImportedRootHost& host, std::unordered_map<std::string, int>* calls = nullptr,
                      std::unordered_map<std::string, std::string>* payloads = nullptr) {
	for (const auto* id : {"command.palette.open", "composer.agent-menu.toggle", "composer.attachment.open",
	                       "composer.copy", "composer.model-menu.toggle", "composer.variant-menu.toggle",
	                       "display.mode.cycle", "external.open.menu.toggle", "external.open.preferred",
	                       "navigation.automations", "navigation.new-session", "navigation.session.close",
	                       "navigation.settings", "navigation.back-to-app",
	                       "message.scroll-to-turn", "session.fork-from-message", "session.undo-to-message",
	                       "project.open", "project.search.toggle", "project.select", "prompt.cancel",
	                       "prompt.retry", "prompt.send", "review.panel.toggle", "server.menu.toggle",
	                       "session.create", "session.metrics.dismiss", "session.metrics.toggle", "session.open",
	                       "session.title.edit.begin", "settings.theme.select", "sidebar.toggle",
	                       "terminal.attach", "ui.presentation.toggle"})
		host.register_action(id, [calls, payloads, id](std::string_view payload) {
			if (calls) ++(*calls)[id];
			if (payloads) (*payloads)[id] = payload;
		});
}

pulp::view::View* find_anchor_suffix(pulp::view::View& view, std::string_view suffix) {
	if (view.anchor_id().ends_with(suffix)) return &view;
	for (std::size_t index = 0; index < view.child_count(); ++index)
		if (auto* found = find_anchor_suffix(*view.child_at(index), suffix)) return found;
	return nullptr;
}

pulp::view::Rect absolute_bounds(const pulp::view::View& view) {
	auto result = view.bounds();
	for (auto* parent = view.parent(); parent; parent = parent->parent()) {
		const auto bounds = parent->bounds();
		result.x += bounds.x;
		result.y += bounds.y;
	}
	return result;
}

bool invoke_installed_click(pulp::view::View& view) {
	if (auto* button = dynamic_cast<pulp::view::TextButton*>(&view)) {
		if (!button->on_click) return false;
		button->on_click();
		return true;
	}
	if (!view.on_click) return false;
	view.on_click();
	return true;
}

}  // namespace

int main(int argc, char** argv) {
	if (argc != 3) return 2;
	const bool state_candidate = std::getenv("PALOT_STATE_CANDIDATE") != nullptr;
	const bool action_state_proof = std::getenv("PALOT_ACTION_STATE_PROOF") != nullptr;
	const bool action_payload_proof = std::getenv("PALOT_ACTION_PAYLOAD_PROOF") != nullptr;
	const bool prompt_cancel_payload_proof =
		std::getenv("PALOT_PROMPT_CANCEL_PAYLOAD_PROOF") != nullptr;
	const auto ir = pulp::view::parse_design_ir_json(read_text(argv[1]));
	if (ir.source_adapter != "observed-dom" || forbidden_renderer(ir.root)) return 3;

	ImportedRootHost missing;
	missing.register_action("prompt.send", [](std::string_view) {});
	try {
		missing.load(argv[1], argv[2]);
		return 4;
	} catch (const std::runtime_error&) {
	}

	ImportedRootHost host;
	std::unordered_map<std::string, int> calls;
	std::unordered_map<std::string, std::string> payloads;
	std::unordered_map<std::string, std::string> runtime_context{
		{"project.directory", "/tmp/runtime-project"}};
	host.set_runtime_context_lookup([&](std::string_view field) -> std::optional<std::string> {
		const auto found = runtime_context.find(std::string(field));
		if (found == runtime_context.end()) return std::nullopt;
		return found->second;
	});
	register_actions(host, &calls, &payloads);
	host.load(argv[1], argv[2]);
	if (const auto* expected = std::getenv("PALOT_EXPECT_UNATTACHED_ACTIONS")) {
		const auto expected_actions = comma_separated(expected);
		if (host.unattached_actions() != expected_actions) {
			std::cerr << "unattached action inventory mismatch" << '\n';
			for (const auto& action : host.unattached_actions()) std::cerr << " actual=" << action << '\n';
			for (const auto& action : expected_actions) std::cerr << " expected=" << action << '\n';
			return 34;
		}
		for (const auto& action : expected_actions) {
			const auto views = host.unattached_action_views(action);
			if (views.empty()) {
				std::cerr << "unattached imported action has no inventoried views: " << action << '\n';
				return 35;
			}
			for (const auto* view : views)
				if (view->enabled() || view->hit_testable()) {
					std::cerr << "unattached imported action remained interactive: " << action << '\n';
					return 36;
				}
		}
		std::cout << "unattached imported actions are inventoried and fail closed\n";
		return EXIT_SUCCESS;
	}
	if (!host.source_observed_primary_tree() || host.child_count() != 1) return 5;
	if (host.child_at(0)->child_count() == 0) return 6;
	host.set_bounds({0, 0, 1200, 800});
	host.layout_children();
	host.set_transcript({{"u1", "user", {{"message.text", "runtime user"}}},
	                     {"r1", "reasoning", {{"reasoning.label", "Thought for 2 seconds"}}},
	                     {"a1", "assistant", {{"message.text", "runtime assistant"},
	                                            {"turn.id", "user-message-1"},
	                                            {"turn.user-message-id", "user-message-1"},
	                                            {"turn.next-user-message-id", "user-message-2"}}},
	                     {"t1", "tool.read", {{"tool.label", "Read"},
	                                           {"tool.subject", "tool.read"},
	                                           {"tool.duration", "1s"}}}});
	if (prompt_cancel_payload_proof) {
		const auto cancel_views = host.bound_action_views("prompt.cancel");
		if (cancel_views.empty() || !cancel_views.front()->enabled() ||
		    !cancel_views.front()->hit_testable() ||
		    !invoke_installed_click(*cancel_views.front()) || calls["prompt.cancel"] != 0)
			return 42;
		runtime_context["session.id"] = "ses_initial";
		if (!invoke_installed_click(*cancel_views.front()) || calls["prompt.cancel"] != 1 ||
		    payloads["prompt.cancel"] !=
		        R"({"directory":"/tmp/runtime-project","sessionID":"ses_initial"})")
			return 43;
		return EXIT_SUCCESS;
	}
	if (action_payload_proof) {
		const auto terminal_views = host.bound_action_views("terminal.attach");
		const auto cancel_views = host.bound_action_views("prompt.cancel");
		if (host.active_action_payload("external.open.preferred") !=
		        R"({"directory":"/tmp/runtime-project"})" ||
		    host.active_action_payload("terminal.attach").has_value() ||
		    terminal_views.empty() || cancel_views.empty() ||
		    !cancel_views.front()->enabled() || !cancel_views.front()->hit_testable() ||
		    !invoke_installed_click(*terminal_views.front()) ||
		    !invoke_installed_click(*cancel_views.front()) ||
		    calls["terminal.attach"] != 0 || calls["prompt.cancel"] != 0) {
			std::cerr << "runtime context payload did not fail closed before session availability"
			          << " terminalViews=" << terminal_views.size()
			          << " cancelViews=" << cancel_views.size()
			          << " cancelEnabled=" << (!cancel_views.empty() && cancel_views.front()->enabled())
			          << " cancelHit=" << (!cancel_views.empty() && cancel_views.front()->hit_testable())
			          << " terminalCalls=" << calls["terminal.attach"]
			          << " cancelCalls=" << calls["prompt.cancel"] << '\n';
			return 39;
		}
		runtime_context["session.id"] = "ses_initial";
		if (!invoke_installed_click(*terminal_views.front()) ||
		    !invoke_installed_click(*cancel_views.front()) ||
		    payloads["terminal.attach"] !=
		        R"({"directory":"/tmp/runtime-project","sessionID":"ses_initial"})" ||
		    payloads["prompt.cancel"] !=
		        R"({"directory":"/tmp/runtime-project","sessionID":"ses_initial"})") {
			std::cerr << "runtime context payload was not resolved at invocation\n";
			return 40;
		}
		runtime_context["project.directory"] = "/tmp/runtime-project-2";
		runtime_context["session.id"] = "ses_updated";
		if (!host.invoke_bound_action("terminal.attach") ||
		    payloads["terminal.attach"] !=
		        R"({"directory":"/tmp/runtime-project-2","sessionID":"ses_updated"})") {
			std::cerr << "runtime context payload captured stale values\n";
			return 41;
		}
		for (const auto& [action, expected] :
		     std::initializer_list<std::pair<std::string_view, std::string_view>>{
		         {"message.scroll-to-turn", "user-message-1"},
		         {"session.fork-from-message", "user-message-2"},
		         {"session.undo-to-message", "user-message-1"}}) {
			const auto actual = host.active_action_payload(action);
			if (actual != expected || !host.invoke_bound_action(action) ||
			    payloads[std::string(action)] != expected) {
				std::cerr << "payload proof action=" << action << " expected=" << expected
				          << " actual=" << (actual ? *actual : "<missing>")
				          << " bound-views=" << host.bound_action_views(action).size() << '\n';
				return 37;
			}
		}
		host.set_transcript({{"a-terminal", "assistant", {{"message.text", "terminal assistant"},
		                                                     {"turn.id", "user-message-terminal"},
		                                                     {"turn.user-message-id", "user-message-terminal"}}}});
		if (host.active_action_payload("message.scroll-to-turn") != "user-message-terminal" ||
		    host.active_action_payload("session.undo-to-message") != "user-message-terminal" ||
		    host.active_action_payload("session.fork-from-message").has_value() ||
		    host.invoke_bound_action("session.fork-from-message")) return 38;
		return EXIT_SUCCESS;
	}
	const std::vector<std::string> v29_unattached_required{
		"external.open.preferred", "project.select", "session.create", "session.open", "terminal.attach"};
	const auto expected_attached_count = action_state_proof ? 23u : 28u;
	const auto expected_unattached_required = action_state_proof
		? v29_unattached_required
		: std::vector<std::string>{};
	if (host.attached_action_count() != expected_attached_count ||
	    host.unattached_required_actions() != expected_unattached_required) {
		std::cerr << "attached action count=" << host.attached_action_count()
		          << " expected=" << expected_attached_count << '\n';
		for (const auto& action : host.unattached_required_actions())
			std::cerr << "unattached required=" << action << '\n';
		return 7;
	}
	host.set_projects({{"p1", "project", {{"id", "/tmp/project-one"},
	                                          {"project.name", "project-one"},
	                                          {"directory", "/tmp/project-one"},
	                                          {"status", "active"}}}});
	host.set_projects({{"p1", "project", {{"id", "/tmp/project-two"},
	                                          {"project.name", "project-two"},
	                                          {"directory", "/tmp/project-two"},
	                                          {"status", "active"}}}});
	host.set_bounds({0, 0, 1200, 800});
	host.layout_children();
	if (std::getenv("PALOT_TRANSCRIPT_PROOF")) {
		for (const auto suffix : {"/div-shape-c88f367d:0", "/p-shape-7610f82b:0",
		                          "/div-data-slot-collapsible:0", "/div-shape-2b83ddd7:0"}) {
			const auto* item = find_anchor_suffix(host, suffix);
			const auto bounds = item ? absolute_bounds(*item) : pulp::view::Rect{};
			std::cerr << "transcript " << suffix << " absolute=" << bounds.x << ',' << bounds.y << ','
			          << bounds.width << ',' << bounds.height << '\n';
		}
	}
	if (host.bound_action_views("project.open").size() != 1) {
		std::cerr << "project bindings=" << host.bound_action_views("project.open").size() << '\n';
		return 15;
	}
	if (host.active_action_payload("project.open") != "/tmp/project-two" ||
	    !host.invoke_bound_action("project.open") ||
	    payloads["project.open"] != "/tmp/project-two")
		return 33;
	const auto smoke_actions = action_state_proof
		? std::vector<const char*>{"composer.copy"}
		: std::vector<const char*>{"navigation.new-session", "project.select", "session.open"};
	for (const auto* id : smoke_actions) {
		if (!host.invoke_bound_action(id) || calls[id] != 1) {
			std::cerr << "smoke action failed: " << id << " calls=" << calls[id] << '\n';
			return 9;
		}
	}
	auto* composer = host.bound_composer();
	if (!composer) return 10;
	if (host.active_text_binding("composer.draft") != composer) return 30;
	if (composer->placeholder != "Send a follow-up message...") return 21;
	composer->set_text("visible imported draft");
	if (host.text_binding_value("composer.draft") != "visible imported draft") return 31;
	if (!host.set_text_binding_value("composer.draft", "updated imported draft") ||
	    composer->text() != "updated imported draft") return 32;
	composer->on_return("hello");
	composer->on_return("");
	composer->on_escape();
	if (calls["prompt.send"] != 1 || payloads["prompt.send"] != "hello" ||
	    calls["prompt.retry"] != 1 || calls["prompt.cancel"] != 1) return 11;
	if (std::getenv("PALOT_RUNTIME_BINDING_PROOF")) return 0;
	if (state_candidate) {
		host.set_bounds({0, 0, 1200, 800});
		host.layout_children();
		const auto visible_anchors = [&] {
			std::vector<std::string> result;
			for (const auto* view : host.bound_action_views("ui.presentation.toggle"))
				result.push_back(view->anchor_id());
			std::ranges::sort(result);
			return result;
		};
		const auto default_anchors = visible_anchors();
		if (default_anchors.empty()) return 22;
		if (!host.set_application_state("ui.presentation", "thought.open")) return 23;
		const auto thought_anchors = visible_anchors();
		if (thought_anchors.empty() || thought_anchors == default_anchors) return 24;
		if (!host.set_application_state("ui.presentation", "default")) return 25;
		return 0;
	}
	for (const auto size : {pulp::view::Rect{0, 0, 760, 520}, pulp::view::Rect{0, 0, 980, 680},
	                        pulp::view::Rect{0, 0, 1200, 800}}) {
		host.set_bounds(size);
		host.layout_children();
		if (host.child_at(0)->bounds().width != size.width || host.child_at(0)->bounds().height != size.height) return 8;
	}
	auto* sidebar = find_anchor_suffix(host, "/div-data-slot-sidebar:0");
	auto* main = find_anchor_suffix(host, "/main-data-slot-sidebar-inset:0");
	if (!sidebar || !main) return 12;
	const auto verify_geometry = [&](float width, bool sidebar_visible, float main_x, float main_width) {
		host.set_bounds({0, 0, width, 800});
		host.layout_children();
		const auto nearly_equal = [](float actual, float expected) {
			return std::abs(actual - expected) <= 0.01f;
		};
		return sidebar->visible() == sidebar_visible && main->visible() &&
		       nearly_equal(main->bounds().x, main_x) &&
		       nearly_equal(main->bounds().width, main_width) &&
		       (!sidebar_visible || (nearly_equal(sidebar->bounds().x, 0.0f) &&
		                            nearly_equal(sidebar->bounds().width, 280.0f)));
	};
	for (const auto geometry : {std::tuple{599.0f, false, 12.0f, 587.0f},
	                            std::tuple{768.0f, true, 280.0f, 488.0f},
	                            std::tuple{1200.0f, true, 280.0f, 920.0f},
	                            std::tuple{768.0f, true, 280.0f, 488.0f},
	                            std::tuple{599.0f, false, 12.0f, 587.0f}})
		if (!verify_geometry(std::get<0>(geometry), std::get<1>(geometry),
		                     std::get<2>(geometry), std::get<3>(geometry))) {
			std::cerr << "responsive geometry width=" << std::get<0>(geometry)
			          << " sidebar-visible=" << sidebar->visible() << " main-x=" << main->bounds().x
			          << " main-width=" << main->bounds().width << '\n';
			return 13;
		}
	host.set_bounds({0, 0, 1200, 800});
	host.layout_children();
	const auto sidebar_toggles = host.bound_action_views("sidebar.toggle");
	if (sidebar_toggles.empty() || !invoke_installed_click(*sidebar_toggles.front())) return 26;
	host.layout_children();
	if (calls["sidebar.toggle"] != 1 || sidebar->visible()) {
		std::cerr << "sidebar toggle did not reflow main: sidebar-visible=" << sidebar->visible()
		          << " main=" << main->bounds().x << ',' << main->bounds().y << ','
		          << main->bounds().width << ',' << main->bounds().height << '\n';
		return 27;
	}
	if (!host.invoke_bound_action("sidebar.toggle") || calls["sidebar.toggle"] != 2) return 28;
	host.layout_children();
	if (!sidebar->visible()) {
		std::cerr << "sidebar reopen did not restore main: sidebar-visible=" << sidebar->visible()
		          << " main=" << main->bounds().x << ',' << main->bounds().y << ','
		          << main->bounds().width << ',' << main->bounds().height << '\n';
		return 29;
	}
	if (!host.set_application_state("session.metrics.open", "open")) return 40;
	host.layout_children();
	const auto metric_dismiss_actions = host.bound_action_views("session.metrics.dismiss");
	if (metric_dismiss_actions.size() != 1 ||
	    !invoke_installed_click(*metric_dismiss_actions.front()))
		return 41;
	host.layout_children();
	if (calls["session.metrics.dismiss"] != 1 ||
	    !host.bound_action_views("session.metrics.dismiss").empty())
		return 42;
	const auto settings_actions = host.bound_action_views("navigation.settings");
	if (settings_actions.size() != 1 ||
	    host.bound_action_views("session.metrics.toggle").empty())
		return 37;
	if (!invoke_installed_click(*settings_actions.front())) return 37;
	host.layout_children();
	if (calls["navigation.settings"] != 1 ||
	    !host.bound_action_views("session.metrics.toggle").empty() ||
	    host.bound_action_views("settings.theme.select").size() != 1)
		return 38;
	const auto theme_actions = host.bound_action_views("settings.theme.select");
	const auto theme_payload = host.active_action_payload("settings.theme.select");
	const auto theme_transition = host.active_action_state_transition("settings.theme.select");
	if (!theme_payload || *theme_payload != "light" || !theme_transition ||
	    theme_transition->first != "settings.theme" || theme_transition->second != "set:light")
		return 44;
	if (!invoke_installed_click(*theme_actions.front()) || calls["settings.theme.select"] != 1 ||
	    payloads["settings.theme.select"] != "light")
		return 43;
	if (action_state_proof) return 0;
	if (!host.set_application_state("navigation.route", "chat")) return 39;
	host.layout_children();
	host.set_bounds({0, 0, 1200, 800});
	host.layout_children();
	auto* app_bar_title = find_anchor_suffix(host, "/button-shape-dabbe371:0/h2-shape-62d7ba2f:0");
	auto* app_bar_title_label = dynamic_cast<pulp::view::Label*>(app_bar_title);
	if (std::getenv("PALOT_APP_BAR_PROOF")) {
		const auto b = app_bar_title ? app_bar_title->bounds() : pulp::view::Rect{};
		std::cerr << "app-bar-title bounds=" << b.x << ',' << b.y << ',' << b.width << ',' << b.height
		          << " intrinsic=" << (app_bar_title_label ? app_bar_title_label->intrinsic_width() : 0.0f) << '\n';
		for (const auto suffix : {"/div-data-slot-app-bar:0", "/div-shape-91386c77:0",
		                          "/div-shape-b9281b89:0", "/button-shape-dabbe371:0"}) {
			const auto* item = find_anchor_suffix(host, suffix);
			const auto r = item ? item->bounds() : pulp::view::Rect{};
			std::cerr << suffix << " bounds=" << r.x << ',' << r.y << ',' << r.width << ',' << r.height << '\n';
			if (item && std::string_view(suffix) == "/div-shape-b9281b89:0") {
				for (std::size_t index = 0; index < item->child_count(); ++index) {
					const auto* child = item->child_at(index);
					const auto child_bounds = child->bounds();
					std::cerr << " child=" << child->anchor_id() << " bounds=" << child_bounds.x << ','
					          << child_bounds.y << ',' << child_bounds.width << ',' << child_bounds.height
					          << " intrinsic=" << child->intrinsic_width() << '\n';
				}
			}
		}
	}
	if (!app_bar_title_label || app_bar_title_label->text() != "Add dark mode toggle to settings" ||
	    app_bar_title_label->bounds().width <= 0 || app_bar_title_label->bounds().height <= 0) {
		std::cerr << "source app-bar title failed native materialization" << '\n';
		return 22;
	}
	ShapingRecordingCanvas paint_probe;
	host.paint_all(paint_probe);
	const auto painted_app_bar_title = std::ranges::any_of(paint_probe.commands(), [](const auto& command) {
		return command.type == pulp::canvas::DrawCommand::Type::fill_text &&
		       command.text == "Add dark mode toggle to settings";
	});
	if (!painted_app_bar_title) {
		std::cerr << "source app-bar title did not reach the native paint stream" << '\n';
		for (const auto& command : paint_probe.commands())
			if (command.type == pulp::canvas::DrawCommand::Type::fill_text &&
			    command.text.find("Add") != std::string::npos)
				std::cerr << " related paint text=" << command.text << " at=" << command.f[0] << ','
				          << command.f[1] << '\n';
		return 24;
	}
	auto* reasoning_label = find_anchor_suffix(host,
		"/div-data-slot-collapsible:0/button-data-slot-collapsible-trigger:0/p-shape-554e6069:0");
	if (!reasoning_label || reasoning_label->bounds().x > 64.0f || reasoning_label->bounds().width > 300.0f) {
		const auto r = reasoning_label ? reasoning_label->bounds() : pulp::view::Rect{};
		std::cerr << "reasoning label lost source-local inline geometry: " << r.x << ',' << r.y << ','
		          << r.width << ',' << r.height << '\n';
		return 23;
	}
	if (!host.set_application_state("sidebar.open", "closed")) return 16;
	host.layout_children();
	if (sidebar->visible()) return 17;
	host.set_bounds({0, 0, 599, 800});
	host.layout_children();
	host.set_bounds({0, 0, 1200, 800});
	host.layout_children();
	if (sidebar->visible()) return 18;
	if (!host.clear_application_state("sidebar.open")) return 19;
	host.layout_children();
	if (!sidebar->visible()) return 20;
	const auto accessibility = pulp::view::snapshot_accessibility_tree(host);
	const auto contains_accessible_text = [&](std::string_view text) {
		return std::ranges::any_of(accessibility, [text](const auto& node) {
			return node.label.find(text) != std::string::npos || node.value.find(text) != std::string::npos;
		});
	};
	for (const auto text : {"runtime user", "Thought for 2 seconds", "runtime assistant", "tool.read", "project-two"})
		if (!contains_accessible_text(text)) {
			std::cerr << "dynamic imported collection missing accessible value: " << text << '\n';
			return 14;
		}
	std::cout << "source-observed native primary tree; no WebView/Chromium; all actions attached\n";
	return EXIT_SUCCESS;
}
