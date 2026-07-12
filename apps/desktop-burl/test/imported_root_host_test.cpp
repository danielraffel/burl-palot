#include "imported_root_host.hpp"

#include <pulp/view/design_ir.hpp>
#include <pulp/view/accessibility_tree.hpp>
#include <pulp/view/text_editor.hpp>

#include <cstdlib>
#include <fstream>
#include <iostream>
#include <sstream>
#include <stdexcept>
#include <tuple>
#include <unordered_map>

namespace {

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

void register_actions(ImportedRootHost& host, std::unordered_map<std::string, int>* calls = nullptr) {
	for (const auto* id : {"composer.copy", "project.open", "project.select", "prompt.cancel", "prompt.retry",
	                       "prompt.send", "session.create", "session.open"})
		host.register_action(id, [calls, id](std::string_view) { if (calls) ++(*calls)[id]; });
}

pulp::view::View* find_anchor_suffix(pulp::view::View& view, std::string_view suffix) {
	if (view.anchor_id().ends_with(suffix)) return &view;
	for (std::size_t index = 0; index < view.child_count(); ++index)
		if (auto* found = find_anchor_suffix(*view.child_at(index), suffix)) return found;
	return nullptr;
}

}  // namespace

int main(int argc, char** argv) {
	if (argc != 3) return 2;
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
	register_actions(host, &calls);
	host.load(argv[1], argv[2]);
	if (!host.source_observed_primary_tree() || host.child_count() != 1) return 5;
	if (host.child_at(0)->child_count() == 0) return 6;
	if (host.attached_action_count() != 8 || !host.unattached_required_actions().empty()) return 7;
	host.set_transcript({{"u1", "user", {{"message.text", "runtime user"}}},
	                     {"a1", "assistant", {{"message.text", "runtime assistant"}}},
	                     {"t1", "tool", {{"message.text", "tool.read"}}}});
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
	if (host.bound_action_views("project.open").size() != 1) {
		std::cerr << "project bindings=" << host.bound_action_views("project.open").size() << '\n';
		return 15;
	}
	for (const auto* id : {"composer.copy", "project.select", "session.create", "session.open"}) {
		if (!host.invoke_bound_action(id) || calls[id] != 1) return 9;
	}
	auto* composer = host.bound_composer();
	if (!composer) return 10;
	composer->on_return("hello");
	composer->on_return("");
	composer->on_escape();
	if (calls["prompt.send"] != 1 || calls["prompt.retry"] != 1 || calls["prompt.cancel"] != 1) return 11;
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
		return sidebar->visible() == sidebar_visible && main->visible() &&
		       main->bounds().x == main_x && main->bounds().width == main_width &&
		       (!sidebar_visible || (sidebar->bounds().x == 0.0f && sidebar->bounds().width == 280.0f));
	};
	for (const auto geometry : {std::tuple{599.0f, false, 0.0f, 587.0f},
	                            std::tuple{768.0f, true, 280.0f, 476.0f},
	                            std::tuple{1200.0f, true, 280.0f, 908.0f},
	                            std::tuple{768.0f, true, 280.0f, 476.0f},
	                            std::tuple{599.0f, false, 0.0f, 587.0f}})
		if (!verify_geometry(std::get<0>(geometry), std::get<1>(geometry),
		                     std::get<2>(geometry), std::get<3>(geometry))) {
			std::cerr << "responsive geometry width=" << std::get<0>(geometry)
			          << " sidebar-visible=" << sidebar->visible() << " main-x=" << main->bounds().x
			          << " main-width=" << main->bounds().width << '\n';
			return 13;
		}
	const auto accessibility = pulp::view::snapshot_accessibility_tree(host);
	const auto contains_accessible_text = [&](std::string_view text) {
		return std::ranges::any_of(accessibility, [text](const auto& node) {
			return node.label.find(text) != std::string::npos || node.value.find(text) != std::string::npos;
		});
	};
	for (const auto text : {"runtime user", "runtime assistant", "tool.read", "project-two"})
		if (!contains_accessible_text(text)) {
			std::cerr << "dynamic imported collection missing accessible value: " << text << '\n';
			return 14;
		}
	std::cout << "source-observed native primary tree; no WebView/Chromium; all actions attached\n";
	return EXIT_SUCCESS;
}
