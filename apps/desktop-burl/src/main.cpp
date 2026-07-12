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
	bool visual_parity_fixture = false;
	for (int index = 1; index < argc; ++index) {
		const std::string_view argument(argv[index]);
		if (argument == "--demo-project" && index + 1 < argc) demo_project = argv[++index];
		else if (argument == "--demo-prompt" && index + 1 < argc) demo_prompt = argv[++index];
		else if (argument == "--demo-capture" && index + 1 < argc) demo_capture = argv[++index];
		else if (argument == "--visual-parity-fixture") visual_parity_fixture = true;
	}
	PalotView root;
	root.set_bounds({0.0f, 0.0f, 1200.0f, 800.0f});
	root.layout_children();
	if (argc == 2 && std::string_view(argv[1]) == "--accessibility-dump") {
		const auto nodes = pulp::view::snapshot_accessibility_tree(root);
		std::size_t accessible = 0;
		for (const auto& node : nodes) {
			if (node.role == pulp::view::View::AccessRole::none || node.hidden == "true") continue;
			++accessible;
			if (node.label.size() > 1024 || node.value.size() > 1024) {
				std::cerr << "accessibility node exceeds bounded text contract\n";
				return 2;
			}
			std::cout << node.depth << '\t' << static_cast<int>(node.role)
			          << '\t' << node.label << '\n';
		}
		std::cout << "accessible_nodes\t" << accessible << '\n';
		return root.source_observed_primary_tree() && accessible > 20 ? 0 : 3;
	}
	if (!root.unattached_required_actions().empty()) {
		std::cerr << "Palot: source-observed controls still lack application action identity:";
		for (const auto& action : root.unattached_required_actions()) std::cerr << ' ' << action;
		std::cerr << '\n';
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
	if ((!demo_project.empty() && !demo_prompt.empty()) || visual_parity_fixture) {
		root.on_demo_complete = [&root, &window, demo_capture] {
			if (!demo_capture.empty()) {
				root.request_repaint();
				window->mark_dirty();
				window->repaint();
				std::thread([&window, demo_capture] {
					std::this_thread::sleep_for(std::chrono::milliseconds(750));
					pulp::events::MainThreadDispatcher::call_async([&window, demo_capture] {
						const auto png = window->capture_back_buffer_png();
						if (!png.empty() && write_png(demo_capture, png))
							std::cout << "demo capture: " << demo_capture << '\n';
					});
				}).detach();
			}
		};
		demo_starter = std::jthread(
			[&root, visual_parity_fixture, project = std::move(demo_project), prompt = std::move(demo_prompt)]() mutable {
				for (int attempt = 0; attempt < 20; ++attempt) {
					if (pulp::events::MainThreadDispatcher::has_backend()) {
						pulp::events::MainThreadDispatcher::call_async(
						[&root, visual_parity_fixture, project = std::move(project), prompt = std::move(prompt)]() mutable {
							if (visual_parity_fixture) root.load_visual_parity_fixture();
							else root.start_demo(std::move(project), std::move(prompt));
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
