#include "project_config.hpp"

#include <filesystem>

std::optional<std::string> validate_project_directory(
	const std::string& project_path, std::string& error) {
	error.clear();
	if (project_path.empty()) {
		error = "Choose a project folder before sending.";
		return std::nullopt;
	}
	std::error_code filesystem_error;
	auto path = std::filesystem::canonical(project_path, filesystem_error);
	if (filesystem_error || !std::filesystem::is_directory(path, filesystem_error)) {
		error = "Project folder does not exist or is not accessible.";
		return std::nullopt;
	}
	return path.string();
}

std::optional<ValidatedProjectConfiguration> validate_project_configuration(
	const ProjectConfiguration& configuration, std::string& error) {
	auto path = validate_project_directory(configuration.project_path, error);
	if (!path) return std::nullopt;
	if (configuration.provider_id.empty() || configuration.model_id.empty()) {
		error = "Provider and model are required.";
		return std::nullopt;
	}
	if (!configuration.create_session && configuration.session_id.empty()) {
		error = "Enter a session ID or choose New session.";
		return std::nullopt;
	}
	return ValidatedProjectConfiguration{
	    .canonical_project_path = *path,
	    .provider_id = configuration.provider_id,
	    .model_id = configuration.model_id,
	    .session_id = configuration.create_session ? "" : configuration.session_id,
	};
}
