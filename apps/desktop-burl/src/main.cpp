#include "palot_view.hpp"

#include <pulp/view/window_host.hpp>
#include <pulp/view/accessibility_tree.hpp>
#include <pulp/events/main_thread_dispatcher.hpp>
#include <pulp/canvas/font_flight_recorder.hpp>
#include <pulp/canvas/font_resolver.hpp>
#include <nlohmann/json.hpp>

#include <fstream>
#include <filesystem>
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

bool write_text(const std::string& path, const std::string& text) {
	std::ofstream output(path, std::ios::binary | std::ios::trunc);
	output << text;
	return output.good();
}

std::string read_text(const std::filesystem::path& path) {
	std::ifstream input(path, std::ios::binary);
	return input ? std::string(std::istreambuf_iterator<char>(input), {}) : std::string{};
}

}  // namespace

int main(int argc, char** argv) {
	pulp::canvas::FontResolver::instance().set_family_alias("monospace", "Menlo");
	std::string demo_project;
	std::string demo_prompt;
	std::string demo_capture;
	std::string font_receipt;
	std::string demo_evidence;
	bool demo_cancel_retry = false;
	bool visual_parity_fixture = false;
	float window_width = 1200.0f;
	float window_height = 800.0f;
	for (int index = 1; index < argc; ++index) {
		const std::string_view argument(argv[index]);
		if (argument == "--demo-project" && index + 1 < argc) demo_project = argv[++index];
		else if (argument == "--demo-prompt" && index + 1 < argc) demo_prompt = argv[++index];
		else if (argument == "--demo-capture" && index + 1 < argc) demo_capture = argv[++index];
		else if (argument == "--font-receipt" && index + 1 < argc) font_receipt = argv[++index];
		else if (argument == "--demo-evidence" && index + 1 < argc) demo_evidence = argv[++index];
		else if (argument == "--demo-cancel-retry-proof") demo_cancel_retry = true;
		else if (argument == "--demo-state" && index + 1 < argc)
			setenv("PALOT_STATE_PATH", argv[++index], 1);
		else if (argument == "--visual-parity-fixture") visual_parity_fixture = true;
		else if (argument == "--window-width" && index + 1 < argc) window_width = std::stof(argv[++index]);
		else if (argument == "--window-height" && index + 1 < argc) window_height = std::stof(argv[++index]);
	}
	PalotView root;
	root.set_bounds({0.0f, 0.0f, window_width, window_height});
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
	options.width = window_width;
	options.height = window_height;
	options.use_gpu = true;
	const auto contract_path = std::filesystem::path(argv[0]).parent_path().parent_path() /
		"Resources/contracts/source-window.browser-window.v1.json";
	const auto source_window = pulp::view::parse_source_window_contract_json(read_text(contract_path));
	if (!source_window) {
		std::cerr << "Palot: source window contract is missing or invalid\n";
		return 1;
	}
	source_window->apply(options);

	auto window = pulp::view::WindowHost::create(root, options);
	if (!window) {
		std::cerr << "Palot: native WindowHost is unavailable\n";
		return 1;
	}
	window->set_close_callback([] {});
	std::jthread demo_starter;
	if ((!demo_project.empty() && !demo_prompt.empty()) || visual_parity_fixture) {
		auto proof_session = std::make_shared<std::string>();
		if (demo_cancel_retry) {
			auto cancellation_started = std::make_shared<bool>(false);
			root.on_stream_delta = [&root, cancellation_started, proof_session, demo_evidence] {
				if (*cancellation_started) return;
				*cancellation_started = true;
				*proof_session = root.demo_session_id();
				if (!demo_evidence.empty()) write_text(demo_evidence + ".progress", "streamed\ncancel\n");
				pulp::events::MainThreadDispatcher::call_async([&root] {
					if (!root.invoke_imported_action("prompt.cancel"))
						std::cerr << "demo proof: bound prompt.cancel unavailable\n";
				});
			};
			root.on_demo_error = [&root, demo_evidence] {
				root.on_stream_delta = {};
				root.on_demo_error = [demo_evidence] {
					if (!demo_evidence.empty()) write_text(demo_evidence + ".progress", "retry-error\n");
				};
				if (!demo_evidence.empty()) write_text(demo_evidence + ".progress", "streamed\ncancelled\nretry\n");
				pulp::events::MainThreadDispatcher::call_async_after([&root] {
					if (!root.invoke_imported_action("prompt.retry"))
						std::cerr << "demo proof: bound retry unavailable\n";
				}, 3000);
			};
		}
		root.on_demo_complete = [&root, &window, demo_capture, font_receipt, demo_evidence,
		                         demo_cancel_retry, proof_session] {
			if (demo_cancel_retry && (proof_session->empty() || root.demo_session_id() != *proof_session)) {
				if (!demo_evidence.empty())
					write_text(demo_evidence + ".progress", "session-changed\nexpected=" +
					           *proof_session + "\nactual=" + root.demo_session_id() + "\n");
				return;
			}
			if (!demo_evidence.empty()) write_text(demo_evidence + ".progress", "streamed\ncancelled\nretried\ndone\n");
			root.flush_demo_projection();
			if (!demo_evidence.empty()) {
				nlohmann::json nodes = nlohmann::json::array();
				for (const auto& node : pulp::view::snapshot_accessibility_tree(root))
					nodes.push_back({{"depth", node.depth}, {"role", static_cast<int>(node.role)},
					                 {"label", node.label}, {"value", node.value}});
				write_text(demo_evidence, nodes.dump(2) + "\n");
			}
			if (!demo_capture.empty() || !font_receipt.empty()) {
				if (!font_receipt.empty()) pulp::canvas::FontFlightRecorder::instance().clear();
				root.request_repaint();
				window->mark_dirty();
				window->repaint();
				std::thread([&window, demo_capture, font_receipt] {
					std::this_thread::sleep_for(std::chrono::milliseconds(750));
					pulp::events::MainThreadDispatcher::call_async([&window, demo_capture, font_receipt] {
						const auto png = window->capture_back_buffer_png();
						if (!demo_capture.empty() && !png.empty() && write_png(demo_capture, png))
							std::cout << "demo capture: " << demo_capture << '\n';
						if (!font_receipt.empty() &&
						    write_text(font_receipt, pulp::canvas::flight_recorder_drain_json()))
							std::cout << "font receipt: " << font_receipt << '\n';
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
