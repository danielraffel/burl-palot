#include <pulp/view/authored_token_document.hpp>

#include <cassert>
#include <fstream>
#include <sstream>
#include <string>

int main(int argc, char** argv) {
	assert(argc == 2);
	std::ifstream input(argv[1]);
	std::ostringstream bytes;
	bytes << input.rdbuf();
	const auto first = pulp::view::parse_authored_token_sidecar(bytes.str());

	assert(first.source.revision == "fd63a75dad3d0e8555ba22a47e720d285889fbf0");
	assert(first.source.adapter == "palot-css-custom-properties-v1");
	assert(first.selected_modes.at("appearance") == "dark");
	assert(first.resolved_theme_is_lossy);
	assert(first.authored_dtcg_json.find("var(--background)") != std::string::npos);
	assert(first.authored_dtcg_json.find("calc(var(--radius) - 4px)") != std::string::npos);
	assert(first.authored_dtcg_json.find("cubic-bezier(0.19, 1, 0.22, 1)") != std::string::npos);
	assert(first.authored_dtcg_json.find("com.palot.cssSource") != std::string::npos);
	assert(first.resolved_theme.color("background").has_value());
	assert(first.resolved_theme.color("sidebar").has_value());
	const auto background = first.resolved_theme.color("background").value();
	const auto sidebar = first.resolved_theme.color("sidebar").value();
	assert(background.r != sidebar.r || background.g != sidebar.g ||
	       background.b != sidebar.b || background.a != sidebar.a);

	const auto encoded = pulp::view::serialize_authored_token_sidecar(first);
	const auto second = pulp::view::parse_authored_token_sidecar(encoded);
	assert(second.authored_dtcg_json == first.authored_dtcg_json);
	assert(second.selected_modes == first.selected_modes);
	assert(pulp::view::serialize_authored_token_sidecar(second) == encoded);
}
