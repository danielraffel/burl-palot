#include "project_config.hpp"

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
	return valid && valid->session_id == "session-1" ? EXIT_SUCCESS : EXIT_FAILURE;
}
