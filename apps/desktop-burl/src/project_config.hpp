#pragma once

#include <optional>
#include <string>

struct ProjectConfiguration {
	std::string project_path;
	std::string provider_id;
	std::string model_id;
	bool create_session = true;
	std::string session_id;
};

struct ValidatedProjectConfiguration {
	std::string canonical_project_path;
	std::string provider_id;
	std::string model_id;
	std::string session_id;
};

std::optional<std::string> validate_project_directory(
	const std::string& project_path, std::string& error);

std::optional<ValidatedProjectConfiguration> validate_project_configuration(
	const ProjectConfiguration& configuration, std::string& error);
