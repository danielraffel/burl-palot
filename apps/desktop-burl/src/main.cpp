#include <pulp/canvas/canvas.hpp>
#include <pulp/view/view.hpp>
#include <pulp/view/window_host.hpp>

#include <iostream>

namespace {

class PalotRoot final : public pulp::view::View {
public:
	void paint(pulp::canvas::Canvas& canvas) override {
		canvas.set_fill_color(pulp::canvas::Color::rgba8(9, 14, 26));
		canvas.fill_rect(0.0f, 0.0f, bounds().width, bounds().height);
		canvas.set_fill_color(pulp::canvas::Color::rgba8(241, 245, 249));
		canvas.set_font("Inter", 26.0f);
		canvas.fill_text("Palot", 32.0f, 52.0f);
	}
};

}  // namespace

int main() {
	PalotRoot root;
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
