#include "imported_root_host.hpp"

#include <pulp/view/design_ir.hpp>

#include <cstdlib>
#include <fstream>
#include <iostream>
#include <sstream>
#include <stdexcept>

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

void register_actions(ImportedRootHost& host) {
	for (const auto* id : {"composer.copy", "project.select", "prompt.cancel", "prompt.retry",
	                       "prompt.send", "session.create", "session.open"})
		host.register_action(id, [](std::string_view) {});
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
	register_actions(host);
	host.load(argv[1], argv[2]);
	if (!host.source_observed_primary_tree() || host.child_count() != 1) return 5;
	if (host.child_at(0)->child_count() == 0) return 6;
	if (host.attached_action_count() != 0 || host.unattached_required_actions().size() != 7) return 7;
	host.set_bounds({0, 0, 1200, 800});
	host.layout_children();
	if (host.child_at(0)->bounds().width != 1200 || host.child_at(0)->bounds().height != 800) return 8;
	std::cout << "source-observed native primary tree; no WebView/Chromium; remaining action anchors="
	          << host.unattached_required_actions().size() << '\n';
	return EXIT_SUCCESS;
}
