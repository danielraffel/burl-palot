#include "imported_root_host.hpp"

#include <pulp/view/design_ir.hpp>
#include <pulp/view/text_editor.hpp>

#include <cstdlib>
#include <fstream>
#include <iostream>
#include <sstream>
#include <stdexcept>
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
	for (const auto* id : {"composer.copy", "project.select", "prompt.cancel", "prompt.retry",
	                       "prompt.send", "session.create", "session.open"})
		host.register_action(id, [calls, id](std::string_view) { if (calls) ++(*calls)[id]; });
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
	if (host.attached_action_count() != 7 || !host.unattached_required_actions().empty()) return 7;
	for (const auto* id : {"composer.copy", "project.select", "session.create", "session.open"}) {
		if (!host.invoke_bound_action(id) || calls[id] != 1) return 9;
	}
	auto* composer = host.bound_composer();
	if (!composer) return 10;
	composer->on_return("hello");
	composer->on_return("");
	composer->on_escape();
	if (calls["prompt.send"] != 1 || calls["prompt.retry"] != 1 || calls["prompt.cancel"] != 1) return 11;
	host.set_bound_texts({{"transcript.user", "runtime user prompt"},
	                      {"transcript.assistant", "streamed chunk one"},
	                      {"transcript.tool", "tool.read"}});
	if (host.child_count() != 1 || host.attached_action_count() != 7 ||
	    !host.unattached_required_actions().empty()) return 12;
	auto* rebound_composer = host.bound_composer();
	if (!rebound_composer || rebound_composer == composer) return 13;
	rebound_composer->on_return("streamed chunk two");
	if (calls["prompt.send"] != 2) return 14;
	for (const auto size : {pulp::view::Rect{0, 0, 760, 520}, pulp::view::Rect{0, 0, 980, 680},
	                        pulp::view::Rect{0, 0, 1200, 800}}) {
		host.set_bounds(size);
		host.layout_children();
		if (host.child_at(0)->bounds().width != size.width || host.child_at(0)->bounds().height != size.height) return 8;
	}
	std::cout << "source-observed native primary tree; no WebView/Chromium; all actions attached\n";
	return EXIT_SUCCESS;
}
