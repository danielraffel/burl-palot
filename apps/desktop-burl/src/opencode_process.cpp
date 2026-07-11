#include "opencode_process.hpp"

#include <cerrno>
#include <csignal>
#include <cstdlib>
#include <cstring>
#include <spawn.h>
#include <sys/wait.h>
#include <unistd.h>

#include <array>
#include <filesystem>
#include <string_view>
#include <vector>

extern char** environ;

namespace {

std::string json_string(const std::string& line, std::string_view key) {
	const std::string marker = "\"" + std::string(key) + "\":\"";
	auto cursor = line.find(marker);
	if (cursor == std::string::npos) return {};
	cursor += marker.size();
	std::string value;
	bool escaped = false;
	for (; cursor < line.size(); ++cursor) {
		const char c = line[cursor];
		if (escaped) {
			switch (c) {
				case 'n': value.push_back('\n'); break;
				case 'r': value.push_back('\r'); break;
				case 't': value.push_back('\t'); break;
				default: value.push_back(c); break;
			}
			escaped = false;
		} else if (c == '\\') {
			escaped = true;
		} else if (c == '"') {
			return value;
		} else {
			value.push_back(c);
		}
	}
	return {};
}

std::string opencode_executable() {
	if (const char* configured = std::getenv("PALOT_OPENCODE_PATH"))
		return configured;
	for (const char* candidate : {"/opt/homebrew/bin/opencode",
	                              "/usr/local/bin/opencode"}) {
		if (std::filesystem::exists(candidate)) return candidate;
	}
	if (const char* home = std::getenv("HOME")) {
		auto candidate = std::filesystem::path(home) / ".opencode/bin/opencode";
		if (std::filesystem::exists(candidate)) return candidate.string();
	}
	return "opencode";
}

}  // namespace

OpenCodeProcess::~OpenCodeProcess() {
	cancel();
}

bool OpenCodeProcess::start(const std::string& project, const std::string& prompt,
	                          const std::string& session, EventCallback callback) {
	if (running_.exchange(true)) return false;
	if (worker_.joinable()) worker_.join();
	worker_ = std::jthread([this, project, prompt, session, callback = std::move(callback)] {
		run(project, prompt, session, callback);
	});
	return true;
}

void OpenCodeProcess::cancel() {
	std::scoped_lock lock(process_mutex_);
	if (process_id_ > 0) kill(process_id_, SIGTERM);
}

void OpenCodeProcess::run(std::string project, std::string prompt,
	                        std::string session, EventCallback callback) {
	int output_pipe[2];
	if (pipe(output_pipe) != 0) {
		callback("error", std::strerror(errno));
		running_ = false;
		return;
	}

	posix_spawn_file_actions_t actions;
	posix_spawn_file_actions_init(&actions);
	posix_spawn_file_actions_adddup2(&actions, output_pipe[1], STDOUT_FILENO);
	posix_spawn_file_actions_adddup2(&actions, output_pipe[1], STDERR_FILENO);
	posix_spawn_file_actions_addclose(&actions, output_pipe[0]);
	posix_spawn_file_actions_addclose(&actions, output_pipe[1]);

	const std::string executable = opencode_executable();
	std::vector<std::string> arguments = {
		executable, "run", "--format", "json", "--model",
		"opencode/north-mini-code-free", "--dir", std::move(project)};
	if (!session.empty()) {
		arguments.emplace_back("--session");
		arguments.push_back(std::move(session));
	}
	arguments.push_back(std::move(prompt));
	std::vector<char*> argv;
	for (auto& argument : arguments) argv.push_back(argument.data());
	argv.push_back(nullptr);

	pid_t pid = -1;
	const int spawn_error = posix_spawnp(&pid, executable.c_str(), &actions, nullptr,
	                                      argv.data(), environ);
	posix_spawn_file_actions_destroy(&actions);
	close(output_pipe[1]);
	if (spawn_error != 0) {
		close(output_pipe[0]);
		callback("error", std::strerror(spawn_error));
		running_ = false;
		return;
	}
	{
		std::scoped_lock lock(process_mutex_);
		process_id_ = pid;
	}

	FILE* stream = fdopen(output_pipe[0], "r");
	std::array<char, 16384> buffer{};
	std::string last_output;
	while (stream && fgets(buffer.data(), static_cast<int>(buffer.size()), stream)) {
		const std::string line(buffer.data());
		last_output = line;
		const auto type = json_string(line, "type");
		if (type == "text") {
			callback("text", json_string(line, "text"));
		} else if (type == "step_start") {
			callback("session", json_string(line, "sessionID"));
		} else if (type == "tool_use" || type == "tool_result") {
			callback("tool", line);
		}
	}
	if (stream) fclose(stream);
	int status = 0;
	waitpid(pid, &status, 0);
	{
		std::scoped_lock lock(process_mutex_);
		process_id_ = -1;
	}
	running_ = false;
	callback(WIFEXITED(status) && WEXITSTATUS(status) == 0 ? "done" : "error",
	         WIFSIGNALED(status) ? "cancelled"
	                             : (last_output.empty() ? "OpenCode exited with an error"
	                                                    : last_output));
}
