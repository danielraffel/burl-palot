#include "opencode_process.hpp"

#include <mach-o/dyld.h>
#include <nlohmann/json.hpp>

#include <cerrno>
#include <csignal>
#include <cstring>
#include <filesystem>
#include <optional>
#include <spawn.h>
#include <poll.h>
#include <sys/wait.h>
#include <unistd.h>

#include <array>
#include <chrono>
#include <condition_variable>
#include <deque>
#include <string_view>
#include <unordered_map>
#include <vector>

extern char** environ;

using Json = nlohmann::json;

namespace {

constexpr int kProtocolVersion = 1;

bool write_all(int fd, std::string_view value) {
	while (!value.empty()) {
		const auto written = ::write(fd, value.data(), value.size());
		if (written < 0) {
			if (errno == EINTR) continue;
			return false;
		}
		value.remove_prefix(static_cast<std::size_t>(written));
	}
	return true;
}

std::string frame(Json value) {
	return value.dump() + "\n";
}

std::optional<std::string> read_line(int fd, std::string& pending,
	                                  std::size_t max_bytes) {
	std::array<char, 8192> buffer{};
	for (;;) {
		if (const auto newline = pending.find('\n'); newline != std::string::npos) {
			if (newline > max_bytes) throw std::runtime_error("sidecar frame exceeds limit");
			std::string line = pending.substr(0, newline);
			pending.erase(0, newline + 1);
			if (!line.empty() && line.back() == '\r') line.pop_back();
			return line;
		}
		if (pending.size() > max_bytes) throw std::runtime_error("sidecar frame exceeds limit");
		const auto count = ::read(fd, buffer.data(), buffer.size());
		if (count == 0) return std::nullopt;
		if (count < 0) {
			if (errno == EINTR) continue;
			throw std::runtime_error(std::strerror(errno));
		}
		pending.append(buffer.data(), static_cast<std::size_t>(count));
		if (pending.size() > max_bytes && pending.find('\n') == std::string::npos)
			throw std::runtime_error("sidecar frame exceeds limit");
	}
}

void wait_for_child(pid_t pid) {
	int status = 0;
	const auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(2);
	while (std::chrono::steady_clock::now() < deadline) {
		const auto result = ::waitpid(pid, &status, WNOHANG);
		if (result == pid || (result < 0 && errno == ECHILD)) return;
		if (result < 0 && errno != EINTR) return;
		std::this_thread::sleep_for(std::chrono::milliseconds(10));
	}
	::kill(pid, SIGKILL);
	while (::waitpid(pid, &status, 0) < 0 && errno == EINTR) {}
}

std::optional<Json> parse_frame(const std::string& line) {
	try {
		auto value = Json::parse(line);
		if (!value.is_object() || value.value("version", 0) != kProtocolVersion ||
		    !value.contains("type") || !value["type"].is_string())
			return std::nullopt;
		return value;
	} catch (const Json::exception&) {
		return std::nullopt;
	}
}

void emit(const std::weak_ptr<OpenCodeEventSink>& sink, std::uint64_t run_id,
	      std::string type, std::string value = {}) {
	if (auto target = sink.lock())
		target->post({run_id, std::move(type), std::move(value)});
}

std::string json_error(const Json& result) {
	if (!result.is_object()) return "invalid sidecar response";
	if (result.contains("error") && result["error"].is_object())
		return result["error"].value("message", "OpenCode command failed");
	return "OpenCode command failed";
}

}  // namespace

struct OpenCodeProcess::State {
	explicit State(Options value) : options(std::move(value)) {}
	Options options;
	std::atomic<bool> running{false};
	std::atomic<bool> cancelled{false};
	std::atomic<std::uint64_t> generation{0};
	std::mutex process_mutex;
	pid_t pid = -1;
	int input_fd = -1;
	std::string project_id;
	std::string session_id;
	std::string request_id;
};

OpenCodeProcess::OpenCodeProcess(Options options)
    : state_(std::make_shared<State>(std::move(options))) {
	if (state_->options.sidecar_path.empty())
		state_->options.sidecar_path = default_sidecar_path();
}

OpenCodeProcess::OpenCodeProcess() : OpenCodeProcess(Options{}) {}

OpenCodeProcess::~OpenCodeProcess() {
	cancel();
	if (worker_.joinable()) worker_.join();
}

bool OpenCodeProcess::running() const {
	return state_->running.load();
}

std::uint64_t OpenCodeProcess::run_id() const {
	return state_->generation.load();
}

std::string OpenCodeProcess::default_sidecar_path() {
	std::array<char, 4096> path{};
	std::uint32_t size = static_cast<std::uint32_t>(path.size());
	if (_NSGetExecutablePath(path.data(), &size) != 0)
		throw std::runtime_error("native executable path exceeds supported length");
	auto executable = std::filesystem::weakly_canonical(path.data());
	return (executable.parent_path() / "../Resources/bin/palot-opencode-sidecar")
	    .lexically_normal()
	    .string();
}

bool OpenCodeProcess::start(OpenCodeRequest request,
	                        std::weak_ptr<OpenCodeEventSink> sink) {
	if (request.project.empty() || request.prompt.empty() || sink.expired()) return false;
	if (state_->running.exchange(true)) return false;
	if (worker_.joinable()) worker_.join();
	state_->cancelled = false;
	const auto generation = state_->generation.fetch_add(1) + 1;
	worker_ = std::jthread([state = state_, generation, request = std::move(request), sink] {
		run(std::move(state), generation, std::move(request), sink);
	});
	return true;
}

void OpenCodeProcess::cancel() {
	auto state = state_;
	state->cancelled = true;
	std::scoped_lock lock(state->process_mutex);
	if (state->input_fd >= 0) {
		if (!state->project_id.empty() && !state->session_id.empty()) {
			write_all(state->input_fd,
			          frame({{"version", 1},
			                 {"type", "command"},
			                 {"id", "cancel-" + std::to_string(state->generation.load())},
			                 {"command",
			                  {{"type", "prompt.cancel"},
			                   {"projectId", state->project_id},
			                   {"sessionId", state->session_id},
			                   {"requestId", state->request_id}}}}));
		}
		write_all(state->input_fd,
		          frame({{"version", 1},
		                 {"type", "shutdown"},
		                 {"id", "shutdown-" + std::to_string(state->generation.load())}}));
	}
	if (state->pid > 0) ::kill(state->pid, SIGTERM);
}

void OpenCodeProcess::run(std::shared_ptr<State> state, std::uint64_t generation,
	                      OpenCodeRequest request,
	                      std::weak_ptr<OpenCodeEventSink> sink) {
	int input_pipe[2]{-1, -1};
	int output_pipe[2]{-1, -1};
	int error_pipe[2]{-1, -1};
	pid_t pid = -1;
	std::thread stderr_reader;
	std::atomic<bool> stop_stderr_reader{false};
	std::string stderr_text;
	auto finish = [&](std::string type, std::string value) {
		if (pid > 0) wait_for_child(pid);
		stop_stderr_reader = true;
		if (stderr_reader.joinable()) stderr_reader.join();
		for (int fd : {input_pipe[0], input_pipe[1], output_pipe[0], output_pipe[1],
		               error_pipe[0], error_pipe[1]})
			if (fd >= 0) ::close(fd);
		{
			std::scoped_lock lock(state->process_mutex);
			if (state->generation.load() == generation) {
				state->pid = -1;
				state->input_fd = -1;
				state->project_id.clear();
				state->session_id.clear();
			}
		}
		state->running = false;
		emit(sink, generation, std::move(type), std::move(value));
	};

	if (::pipe(input_pipe) || ::pipe(output_pipe) || ::pipe(error_pipe)) {
		finish("error", std::strerror(errno));
		return;
	}
	posix_spawn_file_actions_t actions;
	posix_spawn_file_actions_init(&actions);
	posix_spawn_file_actions_adddup2(&actions, input_pipe[0], STDIN_FILENO);
	posix_spawn_file_actions_adddup2(&actions, output_pipe[1], STDOUT_FILENO);
	posix_spawn_file_actions_adddup2(&actions, error_pipe[1], STDERR_FILENO);
	for (int fd : {input_pipe[0], input_pipe[1], output_pipe[0], output_pipe[1],
	               error_pipe[0], error_pipe[1]})
		posix_spawn_file_actions_addclose(&actions, fd);
	std::array<char*, 2> argv{state->options.sidecar_path.data(), nullptr};
	const int spawn_error = posix_spawn(&pid, state->options.sidecar_path.c_str(), &actions,
	                                  nullptr, argv.data(), environ);
	posix_spawn_file_actions_destroy(&actions);
	::close(input_pipe[0]);
	input_pipe[0] = -1;
	::close(output_pipe[1]);
	output_pipe[1] = -1;
	::close(error_pipe[1]);
	error_pipe[1] = -1;
	if (spawn_error != 0) {
		finish("error", std::strerror(spawn_error));
		return;
	}
	{
		std::scoped_lock lock(state->process_mutex);
		state->pid = pid;
		state->input_fd = input_pipe[1];
	}
	stderr_reader = std::thread([fd = error_pipe[0], &stderr_text, &stop_stderr_reader] {
		std::array<char, 1024> bytes{};
		while (!stop_stderr_reader.load() && stderr_text.size() < 8192) {
			pollfd descriptor{fd, POLLIN, 0};
			const auto ready = ::poll(&descriptor, 1, 100);
			if (ready == 0) continue;
			if (ready < 0) { if (errno == EINTR) continue; break; }
			if (!(descriptor.revents & (POLLIN | POLLHUP))) break;
			const auto count = ::read(fd, bytes.data(), bytes.size());
			if (count <= 0) break;
			stderr_text.append(bytes.data(), static_cast<std::size_t>(count));
		}
	});
	if (state->cancelled.load()) {
		::kill(pid, SIGTERM);
		finish("error", "cancelled");
		return;
	}

	std::string pending;
	auto next = [&]() -> std::optional<Json> {
		auto line = read_line(output_pipe[0], pending, state->options.max_frame_bytes);
		if (!line) return std::nullopt;
		auto parsed = parse_frame(*line);
		if (!parsed) throw std::runtime_error("invalid sidecar JSON frame");
		return parsed;
	};
	auto send = [&](const Json& value) {
		if (!write_all(input_pipe[1], frame(value)))
			throw std::runtime_error("failed to write sidecar command");
	};
	auto response = [&](std::string_view id) -> Json {
		for (;;) {
			auto value = next();
			if (!value) throw std::runtime_error("sidecar closed before response");
			if (value->value("type", "") == "error")
				throw std::runtime_error(value->value("message", "sidecar error"));
			if (value->value("type", "") == "response" && value->value("id", "") == id)
				return value->at("result");
		}
	};

	try {
		auto ready = next();
		if (!ready || ready->value("type", "") != "ready")
			throw std::runtime_error("sidecar did not send ready frame");
		const auto prefix = std::to_string(generation) + "-";
		send({{"version", 1},
		      {"type", "command"},
		      {"id", prefix + "server"},
		      {"command", {{"type", "server.start"}, {"directory", request.project}}}});
		auto server = response(prefix + "server");
		if (!server.value("ok", false)) throw std::runtime_error(json_error(server));

		send({{"version", 1},
		      {"type", "command"},
		      {"id", prefix + "project"},
		      {"command", {{"type", "project.select"}, {"directory", request.project}}}});
		auto project = response(prefix + "project");
		if (!project.value("ok", false)) throw std::runtime_error(json_error(project));
		{
			std::scoped_lock lock(state->process_mutex);
			state->project_id = project.at("value").at("id").get<std::string>();
		}

		const bool create = request.session.empty();
		send({{"version", 1},
		      {"type", "command"},
		      {"id", prefix + "session"},
		      {"command",
		       create ? Json{{"type", "session.create"}, {"projectId", state->project_id}}
		              : Json{{"type", "session.open"},
		                     {"projectId", state->project_id},
		                     {"sessionId", request.session}}}});
		auto session = response(prefix + "session");
		if (!session.value("ok", false)) throw std::runtime_error(json_error(session));
		{
			std::scoped_lock lock(state->process_mutex);
			state->session_id = session.at("value").at("id").get<std::string>();
		}
		emit(sink, generation, "session", state->session_id);

		send({{"version", 1},
		      {"type", "subscribe"},
		      {"id", prefix + "events"},
		      {"subscription",
		       {{"projectId", state->project_id}, {"sessionId", state->session_id}}}});
		std::unordered_map<std::string, std::string> part_types;
		for (;;) {
			auto subscribed = next();
			if (!subscribed) throw std::runtime_error("sidecar closed before subscription");
			if (subscribed->value("type", "") == "subscribed") break;
		}

		{
			std::scoped_lock lock(state->process_mutex);
			state->request_id = prefix + "prompt";
		}
		const bool retry = !request.failed_request_id.empty();
		Json prompt_command = {{"type", retry ? "prompt.retry" : "prompt.send"},
		                       {"projectId", state->project_id},
		                       {"sessionId", state->session_id},
		                       {"requestId", state->request_id},
		                       {"text", request.prompt},
		                       {"model",
		                        {{"providerId", request.provider_id},
		                         {"modelId", request.model_id}}}};
		if (retry) prompt_command["failedRequestId"] = request.failed_request_id;
		send({{"version", 1},
		      {"type", "command"},
		      {"id", state->request_id},
		      {"command", std::move(prompt_command)}});

		for (;;) {
			if (state->cancelled.load()) throw std::runtime_error("cancelled");
			auto value = next();
			if (!value) throw std::runtime_error("sidecar stream ended");
			const auto type = value->value("type", "");
			if (type == "response" && value->value("id", "") == state->request_id) {
				auto result = value->at("result");
				if (!result.value("ok", false)) throw std::runtime_error(json_error(result));
				continue;
			}
			if (type != "event") continue;
			const auto& sdk = value->at("event").at("payload").at("event");
			const auto sdk_type = sdk.value("type", "");
			const auto& properties = sdk.at("properties");
			if (sdk_type == "message.part.updated") {
				const auto& part = properties.at("part");
				part_types[part.value("id", "")] = part.value("type", "");
				if (part.value("type", "") == "tool")
					emit(sink, generation, "tool", part.dump());
			} else if (sdk_type == "message.part.delta" &&
			           properties.value("field", "") == "text") {
				const auto part_id = properties.value("partID", "");
				if (part_types[part_id] == "text")
					emit(sink, generation, "text", properties.value("delta", ""));
			}
			else if (sdk_type == "session.idle")
				break;
			else if (sdk_type == "session.error")
				throw std::runtime_error("OpenCode session error");
		}
		send({{"version", 1}, {"type", "shutdown"}, {"id", prefix + "shutdown"}});
		finish("done", "");
	} catch (const std::exception& error) {
		::kill(pid, SIGTERM);
		finish("error", state->cancelled.load() ? "cancelled" : error.what());
	}
}
