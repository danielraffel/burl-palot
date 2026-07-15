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
	if (manifest->source_anchors.size() != 12 || manifest->actions.size() != 29 ||
	    manifest->events.size() != 5 || manifest->data.size() != 5 ||
	    manifest->retained_modules.size() != 7 || manifest->scenarios.size() != 11)
		return fail("manifest surface is incomplete");
	const auto* navigation_new_session =
		pulp::view::find_application_action(*manifest, "navigation.new-session");
	const auto* project_select = pulp::view::find_application_action(*manifest, "project.select");
	const auto* session_create = pulp::view::find_application_action(*manifest, "session.create");
	const auto* session_open = pulp::view::find_application_action(*manifest, "session.open");
	if (!navigation_new_session || !navigation_new_session->required ||
	    !navigation_new_session->fields.empty() || navigation_new_session->result_type != "route")
		return fail("new-session navigation contract is invalid");
	if (!project_select || !project_select->required || !project_select->fields.empty() ||
	    project_select->result_type != "project")
		return fail("project picker must not fabricate a pre-activation directory input");
	if (!session_create || session_create->required || session_create->source_anchor != "opencode.commands" ||
	    session_create->fields.size() != 1 || session_create->fields.front().name != "directory")
		return fail("session creation must remain at the actual OpenCode create boundary");
	if (!session_open || !session_open->required || session_open->fields.size() != 2 ||
	    session_open->fields[0].name != "directory" || session_open->fields[1].name != "sessionID")
		return fail("session opening must retain its directory and session identity");
	if (!manifest->unknown_optional_variants.empty()) return fail("unexpected unknown variants");
	const auto canonical = pulp::view::serialize_application_binding_manifest(*manifest);
	auto round_trip = pulp::view::parse_application_binding_manifest(canonical, &error);
	if (!round_trip || pulp::view::serialize_application_binding_manifest(*round_trip) != canonical)
		return fail("manifest round-trip is not deterministic");
	return EXIT_SUCCESS;
}
