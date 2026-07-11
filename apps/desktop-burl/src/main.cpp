#include "palot_view.hpp"

#include <pulp/view/window_host.hpp>

#include <iostream>

int main() {
	PalotView root;
	root.set_bounds({0.0f, 0.0f, 1200.0f, 800.0f});
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
