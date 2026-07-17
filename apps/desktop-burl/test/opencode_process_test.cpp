#include "opencode_process.hpp"

#include <chrono>
#include <condition_variable>
#include <cstdlib>
#include <cstdio>
#include <fstream>
#include <memory>
#include <mutex>
#include <string>
#include <vector>

#include <nlohmann/json.hpp>

class Sink final : public OpenCodeEventSink {
public:
	void post(OpenCodeEvent event) override {
		std::scoped_lock lock(mutex);
		events.push_back(std::move(event));
		changed.notify_all();
	}

	bool wait_for(std::string_view type) {
		std::unique_lock lock(mutex);
		return changed.wait_for(lock, std::chrono::seconds(5), [&] {
			for (const auto& event : events)
				if (event.type == type) return true;
			return false;
		});
	}

	std::mutex mutex;
	std::condition_variable changed;
	std::vector<OpenCodeEvent> events;
};

bool packaged_handshake(const std::string& executable) {
	const std::string command =
	    "printf '%s\\n' '{\"version\":1,\"type\":\"shutdown\",\"id\":\"native-test\"}' | '" +
	    executable + "'";
	FILE* stream = popen(command.c_str(), "r");
	if (!stream) return false;
	char buffer[4096];
	bool ready = false;
	bool shutdown = false;
	while (fgets(buffer, sizeof(buffer), stream)) {
		try {
			const auto value = nlohmann::json::parse(buffer);
			ready |= value.value("version", 0) == 1 && value.value("type", "") == "ready";
			shutdown |= value.value("type", "") == "shutdown" &&
			            value.value("id", "") == "native-test";
		} catch (const nlohmann::json::exception&) {
			pclose(stream);
			return false;
		}
	}
	return pclose(stream) == 0 && ready && shutdown;
}

std::size_t lifecycle_count(const std::string& path, std::string_view value) {
	std::ifstream input(path);
	std::size_t count = 0;
	for (std::string line; std::getline(input, line);)
		if (line == value) ++count;
	return count;
}

int main(int argc, char** argv) {
	if (argc != 3 || !packaged_handshake(argv[2])) return EXIT_FAILURE;
	const std::string prompt_log = "/tmp/palot-opencode-prompt-contract.jsonl";
	std::remove(prompt_log.c_str());
	setenv("PALOT_FAKE_PROMPT_LOG", prompt_log.c_str(), 1);
	auto sink = std::make_shared<Sink>();
	OpenCodeProcess process({.sidecar_path = argv[1], .max_frame_bytes = 64 * 1024});
	if (!process.start({.project = "/tmp/project",
	                    .prompt = "hello",
	                    .provider_id = "visible-provider",
	                    .model_id = "visible-model",
	                    .attachments = {{.url = "file:///tmp/visible%20attachment.png",
	                                     .media_type = "image/png",
	                                     .filename = "visible attachment.png"}}},
	                   sink))
		return EXIT_FAILURE;
	if (!sink->wait_for("done")) return EXIT_FAILURE;
	{
		std::ifstream input(prompt_log);
		std::string line;
		if (!std::getline(input, line)) return EXIT_FAILURE;
		const auto command = nlohmann::json::parse(line);
		if (command.at("model").at("providerId") != "visible-provider" ||
		    command.at("model").at("modelId") != "visible-model" ||
		    command.at("files").size() != 1 ||
		    command.at("files").at(0).at("url") != "file:///tmp/visible%20attachment.png" ||
		    command.at("files").at(0).at("mediaType") != "image/png" ||
		    command.at("files").at(0).at("filename") != "visible attachment.png")
			return EXIT_FAILURE;
	}
	bool session = false;
	bool text = false;
	bool user_message = false;
	bool assistant_message = false;
	bool tool_running = false;
	bool tool_completed = false;
	std::size_t tool_updates = 0;
	bool reasoning_completed = false;
	{
		std::scoped_lock lock(sink->mutex);
		for (const auto& event : sink->events) {
			session |= event.type == "session" && event.value == "session-1";
			if (event.type == "text") {
				const auto delta = nlohmann::json::parse(event.value);
				text |= delta.value("messageID", "") == "assistant-message-1" &&
				        delta.value("partID", "") == "text-1" &&
				        delta.value("delta", "") == "fixture response";
			}
			if (event.type == "message") {
				const auto info = nlohmann::json::parse(event.value);
				user_message |= info.value("id", "") == "user-message-1" &&
				                info.value("role", "") == "user";
				assistant_message |= info.value("id", "") == "assistant-message-1" &&
				                     info.value("role", "") == "assistant" &&
				                     info.value("parentID", "") == "user-message-1";
			}
			if (event.type == "tool") {
				++tool_updates;
				tool_running |= event.value.find("\"status\":\"running\"") != std::string::npos &&
				                event.value.find("src/lib/theme.ts") != std::string::npos;
				tool_completed |= event.value.find("\"status\":\"completed\"") != std::string::npos &&
				                  event.value.find("\"end\":4000") != std::string::npos;
			}
			reasoning_completed |= event.type == "reasoning" &&
			                       event.value.find("\"end\":3000") != std::string::npos;
			if (event.run_id != 1) return EXIT_FAILURE;
		}
	}
	if (!session || !text || !user_message || !assistant_message || !tool_running || !tool_completed || tool_updates != 2 ||
	    !reasoning_completed || process.running())
		return EXIT_FAILURE;

	auto revert_sink = std::make_shared<Sink>();
	if (!process.session_action("session.revert", "user-message-1", revert_sink) ||
	    !revert_sink->wait_for("session-action")) return EXIT_FAILURE;
	{
		std::scoped_lock lock(revert_sink->mutex);
		const auto found = std::ranges::find_if(revert_sink->events, [](const auto& event) {
			if (event.type != "session-action") return false;
			const auto result = nlohmann::json::parse(event.value);
			return result.value("action", "") == "session.revert" &&
			       result.at("value").value("messageID", "") == "user-message-1";
		});
		if (found == revert_sink->events.end()) return EXIT_FAILURE;
	}
	auto fork_sink = std::make_shared<Sink>();
	if (!process.session_action("session.fork", "user-message-2", fork_sink) ||
	    !fork_sink->wait_for("session-action")) return EXIT_FAILURE;
	{
		std::scoped_lock lock(fork_sink->mutex);
		const auto found = std::ranges::find_if(fork_sink->events, [](const auto& event) {
			if (event.type != "session-action") return false;
			const auto result = nlohmann::json::parse(event.value);
			return result.value("action", "") == "session.fork" &&
			       result.at("value").value("id", "") == "session-forked";
		});
		if (found == fork_sink->events.end()) return EXIT_FAILURE;
	}
	if (process.session_action("session.fork", "", fork_sink) ||
	    process.session_action("session.unknown", "user-message-1", fork_sink))
		return EXIT_FAILURE;

	auto cancelled_sink = std::make_shared<Sink>();
	if (!process.start({.project = "/tmp/project", .prompt = "cancel me"}, cancelled_sink))
		return EXIT_FAILURE;
	process.cancel();
	if (!cancelled_sink->wait_for("error")) return EXIT_FAILURE;
	{
		std::scoped_lock lock(cancelled_sink->mutex);
		bool cancelled = false;
		for (const auto& event : cancelled_sink->events) {
			cancelled |= event.type == "error" && event.value == "cancelled";
			if (event.run_id != 2) return EXIT_FAILURE;
		}
		if (!cancelled) return EXIT_FAILURE;
	}

	auto closed_pipe_sink = std::make_shared<Sink>();
	if (!process.start({.project = "/tmp/close-on-cancel", .prompt = "stream then close"},
	                   closed_pipe_sink) || !closed_pipe_sink->wait_for("text"))
		return EXIT_FAILURE;
	process.cancel();
	if (!closed_pipe_sink->wait_for("error")) return EXIT_FAILURE;
	for (const auto& event : closed_pipe_sink->events)
		if (event.run_id != 3) return EXIT_FAILURE;

	auto delayed_cancel_sink = std::make_shared<Sink>();
	if (!process.start({.project = "/tmp/delayed-cancel", .prompt = "settle cancel"},
	                   delayed_cancel_sink) || !delayed_cancel_sink->wait_for("text"))
		return EXIT_FAILURE;
	const auto cancel_started = std::chrono::steady_clock::now();
	process.cancel();
	if (!delayed_cancel_sink->wait_for("error") ||
	    std::chrono::steady_clock::now() - cancel_started < std::chrono::milliseconds(150))
		return EXIT_FAILURE;

	auto retry_sink = std::make_shared<Sink>();
	if (!process.start({.project = "/tmp/project",
	                    .prompt = "retry",
	                    .session = "session-1",
	                    .failed_request_id = "1-prompt"},
	                   retry_sink))
		return EXIT_FAILURE;
	if (!retry_sink->wait_for("done")) return EXIT_FAILURE;
	{
		std::scoped_lock lock(retry_sink->mutex);
		for (const auto& event : retry_sink->events)
			if (event.run_id != 5) return EXIT_FAILURE;
	}

	OpenCodeProcess bounded({.sidecar_path = argv[1], .max_frame_bytes = 512});
	auto bounded_sink = std::make_shared<Sink>();
	if (!bounded.start({.project = "/tmp/oversize", .prompt = "oversize"}, bounded_sink))
		return EXIT_FAILURE;
	if (!bounded_sink->wait_for("error")) return EXIT_FAILURE;
	{
		std::scoped_lock lock(bounded_sink->mutex);
		bool rejected = false;
		for (const auto& event : bounded_sink->events)
			rejected |= event.type == "error" && event.value.find("frame exceeds") != std::string::npos;
		if (!rejected) return EXIT_FAILURE;
	}

	const std::string lifecycle_log = "/tmp/palot-persistent-lifecycle-contract.log";
	std::remove(lifecycle_log.c_str());
	setenv("PALOT_FAKE_LIFECYCLE_LOG", lifecycle_log.c_str(), 1);
	{
		OpenCodeProcess persistent({.sidecar_path = argv[1], .max_frame_bytes = 64 * 1024});
		auto first = std::make_shared<Sink>();
		if (!persistent.start({.project = "/tmp/persistent-a", .prompt = "first"}, first) ||
		    !first->wait_for("done")) return 20;
		auto retry = std::make_shared<Sink>();
		if (!persistent.start({.project = "/tmp/persistent-a", .prompt = "retry",
		                       .session = "session-1", .failed_request_id = "1-prompt"}, retry) ||
		    !retry->wait_for("done")) return 21;
		auto switched = std::make_shared<Sink>();
		if (!persistent.start({.project = "/tmp/persistent-b", .prompt = "switch"}, switched) ||
		    !switched->wait_for("done")) return 22;
		auto cancelled = std::make_shared<Sink>();
		if (!persistent.start({.project = "/tmp/delayed-cancel", .prompt = "cancel"}, cancelled) ||
		    !cancelled->wait_for("text")) return 23;
		persistent.cancel();
		if (!cancelled->wait_for("error")) return 24;
	}
	unsetenv("PALOT_FAKE_LIFECYCLE_LOG");
	const auto starts = lifecycle_count(lifecycle_log, "sidecar.start");
	const auto servers = lifecycle_count(lifecycle_log, "server.start");
	const auto subscriptions = lifecycle_count(lifecycle_log, "events.subscribe");
	const auto shutdowns = lifecycle_count(lifecycle_log, "sidecar.shutdown");
	const auto projects = lifecycle_count(lifecycle_log, "project.select");
	const auto retries = lifecycle_count(lifecycle_log, "prompt.retry");
	const bool one_transport_for_prompts = starts == 1 && servers == 1;
	const bool cancel_keeps_transport = starts == 1;
	const bool retry_keeps_subscription = retries == 1 && subscriptions == 1;
	const bool project_switch_keeps_server = projects >= 2 && servers == 1;
	const bool explicit_teardown_once = shutdowns == 1;
	if (!(one_transport_for_prompts && cancel_keeps_transport && retry_keeps_subscription &&
	      project_switch_keeps_server && explicit_teardown_once)) {
		std::fprintf(stderr,
		             "persistent lifecycle contracts: prompts=%d cancel=%d retry=%d project=%d teardown=%d "
		             "(starts=%zu servers=%zu subscriptions=%zu projects=%zu retries=%zu shutdowns=%zu)\n",
		             one_transport_for_prompts, cancel_keeps_transport, retry_keeps_subscription,
		             project_switch_keeps_server, explicit_teardown_once, starts, servers,
		             subscriptions, projects, retries, shutdowns);
		return 25;
	}
	return EXIT_SUCCESS;
}
