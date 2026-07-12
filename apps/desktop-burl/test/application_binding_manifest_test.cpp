#include <pulp/view/application_binding_manifest.hpp>

#include <cstdlib>
#include <fstream>
#include <iostream>
#include <sstream>

namespace {

int fail(const char* message) {
	std::cerr << message << "\n";
	return EXIT_FAILURE;
}

}  // namespace

int main(int argc, char** argv) {
	if (argc != 2) return fail("expected manifest path");
	std::ifstream input(argv[1]);
	if (!input) return fail("manifest is not readable");
	std::ostringstream bytes;
	bytes << input.rdbuf();
	std::string error;
	auto manifest = pulp::view::parse_application_binding_manifest(bytes.str(), &error);
	if (!manifest) return fail(error.c_str());
	if (manifest->application_id != "palot.main-chat.fd63a75") return fail("wrong source revision contract");
	if (manifest->source_anchors.size() != 12 || manifest->actions.size() != 8 ||
	    manifest->events.size() != 5 || manifest->data.size() != 5 ||
	    manifest->retained_modules.size() != 7 || manifest->scenarios.size() != 11)
		return fail("manifest surface is incomplete");
	if (!manifest->unknown_optional_variants.empty()) return fail("unexpected unknown variants");
	const auto canonical = pulp::view::serialize_application_binding_manifest(*manifest);
	auto round_trip = pulp::view::parse_application_binding_manifest(canonical, &error);
	if (!round_trip || pulp::view::serialize_application_binding_manifest(*round_trip) != canonical)
		return fail("manifest round-trip is not deterministic");
	return EXIT_SUCCESS;
}
