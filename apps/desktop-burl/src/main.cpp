#include "palot_view.hpp"

#include <pulp/view/window_host.hpp>
#include <pulp/view/accessibility_tree.hpp>
#include <pulp/events/main_thread_dispatcher.hpp>

#include <fstream>
#include <iostream>
#include <string>
#include <string_view>
#include <thread>
#include <chrono>
#include <vector>

namespace {

bool write_png(const std::string& path, const std::vector<std::uint8_t>& bytes) {
	std::ofstream output(path, std::ios::binary | std::ios::trunc);
	output.write(reinterpret_cast<const char*>(bytes.data()),
	             static_cast<std::streamsize>(bytes.size()));
	return output.good();
}

}  // namespace

int main(int argc, char** argv) {
	std::string demo_project;
	std::string demo_prompt;
	std::string demo_capture;
	for (int index = 1; index < argc; ++index) {
		const std::string_view argument(argv[index]);
		if (argument == "--demo-project" && index + 1 < argc) demo_project = argv[++index];
		else if (argument == "--demo-prompt" && index + 1 < argc) demo_prompt = argv[++index];
		else if (argument == "--demo-capture" && index + 1 < argc) demo_capture = argv[++index];
	}
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
	std::jthread demo_starter;
	if (!demo_project.empty() && !demo_prompt.empty()) {
		root.on_demo_complete = [&root, &window, demo_capture] {
			if (!demo_capture.empty()) {
				const auto png = window->capture_back_buffer_png();
				if (!png.empty() && write_png(demo_capture, png))
					std::cout << "demo capture: " << demo_capture << '\n';
			}
		};
		demo_starter = std::jthread(
			[&root, project = std::move(demo_project), prompt = std::move(demo_prompt)]() mutable {
				for (int attempt = 0; attempt < 20; ++attempt) {
					if (pulp::events::MainThreadDispatcher::has_backend()) {
						pulp::events::MainThreadDispatcher::call_async(
						[&root, project = std::move(project), prompt = std::move(prompt)]() mutable {
							root.start_demo(std::move(project), std::move(prompt));
						});
						return;
					}
					std::this_thread::sleep_for(std::chrono::milliseconds(100));
				}
			});
	}
	window->run_event_loop();
	return 0;
}
