#include "palot_view.hpp"

#include <pulp/view/window_host.hpp>
#include <pulp/view/accessibility_tree.hpp>

#include <iostream>
#include <string_view>

int main(int argc, char** argv) {
	PalotView root;
	root.set_bounds({0.0f, 0.0f, 1200.0f, 800.0f});
	root.layout_children();
	if (argc == 2 && std::string_view(argv[1]) == "--accessibility-dump") {
		const auto nodes = pulp::view::snapshot_accessibility_tree(root);
		bool project = false;
		bool composer = false;
		bool transcript = false;
		bool workspace = false;
		std::size_t accessible = 0;
		for (const auto& node : nodes) {
			if (node.role == pulp::view::View::AccessRole::none || node.hidden == "true") continue;
			++accessible;
			project |= node.label == "Project folder";
			composer |= node.label == "Message composer";
			transcript |= node.label == "Conversation transcript";
			workspace |= node.label == "Palot chat workspace";
			if (node.label.size() > 1024 || node.value.size() > 1024) {
				std::cerr << "accessibility node exceeds bounded text contract\n";
				return 2;
			}
			std::cout << node.depth << '\t' << static_cast<int>(node.role)
			          << '\t' << node.label << '\n';
		}
		std::cout << "accessible_nodes\t" << accessible << '\n';
		return project && composer && transcript && workspace ? 0 : 3;
	}
	pulp::view::WindowOptions options;
	options.title = BURL_APP_NAME;
	options.width = 1200.0f;
	options.height = 800.0f;
	options.min_width = 760.0f;
	options.min_height = 520.0f;
	options.use_gpu = true;

	auto window = pulp::view::WindowHost::create(root, options);
	if (!window) {
		std::cerr << "Palot: native WindowHost is unavailable\n";
		return 1;
	}
	window->set_close_callback([] {});
	window->run_event_loop();
	return 0;
}
