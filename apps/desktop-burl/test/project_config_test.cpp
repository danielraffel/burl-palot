#include "project_config.hpp"
#include "runtime_session_state.hpp"

#include <cstdlib>
#include <filesystem>
#include <string>

int main() {
	std::string error;
	auto directory = validate_project_directory("/tmp/../tmp", error);
	if (!directory || *directory != std::filesystem::canonical("/tmp").string())
		return EXIT_FAILURE;
	if (validate_project_directory("/definitely/missing/palot", error) || error.empty())
		return EXIT_FAILURE;
	auto valid = validate_project_configuration(
	    {.project_path = "/tmp/../tmp",
	     .provider_id = "opencode",
	     .model_id = "north-mini-code-free",
	     .create_session = true},
	    error);
	if (!valid || valid->canonical_project_path != std::filesystem::canonical("/tmp").string() ||
	    !valid->session_id.empty())
		return EXIT_FAILURE;
	if (validate_project_configuration(
	        {.project_path = "/definitely/missing/palot",
	         .provider_id = "opencode",
	         .model_id = "model"},
	        error) || error.empty())
		return EXIT_FAILURE;
	if (validate_project_configuration(
	        {.project_path = "/tmp", .provider_id = "", .model_id = "model"}, error) ||
	    error != "Provider and model are required.")
		return EXIT_FAILURE;
	if (validate_project_configuration(
	        {.project_path = "/tmp",
	         .provider_id = "provider",
	         .model_id = "model",
	         .create_session = false},
	        error) ||
	    error != "Enter a session ID or choose New session.")
		return EXIT_FAILURE;
	valid = validate_project_configuration(
	    {.project_path = "/tmp",
	     .provider_id = "provider",
	     .model_id = "model",
	     .create_session = false,
	     .session_id = "session-1"},
	    error);
	if (!valid || valid->session_id != "session-1") return EXIT_FAILURE;

	RuntimeSessionState state;
	state.project = "/tmp";
	state.session = "visible-session-selection";
	state.provider = "visible-provider-selection";
	state.model = "visible-model-selection";
	state.composer_draft = "visible imported composer text";
	auto attachment = make_local_file_attachment("/tmp/visible attachment.png");
	attachment.media_type = "image/png";
	state.attachments = {std::move(attachment)};
	const auto request = make_opencode_request(
	    state, valid->canonical_project_path, state.composer_draft, "retry-request-id");
	if (request.project != valid->canonical_project_path ||
	    request.prompt != "visible imported composer text" ||
	    request.session != "visible-session-selection" ||
	    request.provider_id != "visible-provider-selection" ||
	    request.model_id != "visible-model-selection" ||
	    request.attachments.size() != 1 ||
	    request.attachments[0].url != "file:///tmp/visible%20attachment.png" ||
	    request.failed_request_id != "retry-request-id")
		return EXIT_FAILURE;
	return EXIT_SUCCESS;
}
