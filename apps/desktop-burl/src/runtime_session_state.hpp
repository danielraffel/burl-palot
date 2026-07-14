#pragma once

#include "opencode_process.hpp"

#include <filesystem>
#include <string>
#include <utility>
#include <vector>

struct RuntimeSessionState {
	std::string project;
	std::string session;
	std::string provider = "opencode";
	std::string model = "north-mini-code-free";
	std::string composer_draft;
	std::vector<OpenCodeAttachment> attachments;
	bool create_session = true;
};

inline OpenCodeRequest make_opencode_request(const RuntimeSessionState& state,
	                                         std::string canonical_project,
	                                         std::string prompt,
	                                         std::string failed_request_id = {}) {
	return {
		.project = std::move(canonical_project),
		.prompt = std::move(prompt),
		.session = state.session,
		.failed_request_id = std::move(failed_request_id),
		.provider_id = state.provider,
		.model_id = state.model,
		.attachments = state.attachments,
	};
}

inline OpenCodeAttachment make_local_file_attachment(const std::filesystem::path& path) {
	const auto absolute = std::filesystem::absolute(path).lexically_normal();
	std::string url = "file://";
	constexpr char hex[] = "0123456789ABCDEF";
	for (const auto byte : absolute.generic_string()) {
		const auto value = static_cast<unsigned char>(byte);
		if ((value >= 'a' && value <= 'z') || (value >= 'A' && value <= 'Z') ||
		    (value >= '0' && value <= '9') || byte == '/' || byte == '-' || byte == '_' ||
		    byte == '.' || byte == '~') {
			url.push_back(byte);
		} else {
			url.push_back('%');
			url.push_back(hex[value >> 4]);
			url.push_back(hex[value & 0x0f]);
		}
	}
	return {.url = std::move(url), .filename = absolute.filename().string()};
}
