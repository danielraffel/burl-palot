#include "opencode_process.hpp"

#include <chrono>
#include <condition_variable>
#include <cstdlib>
#include <cstdio>
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

int main(int argc, char** argv) {
	if (argc != 3 || !packaged_handshake(argv[2])) return EXIT_FAILURE;
	auto sink = std::make_shared<Sink>();
	OpenCodeProcess process({.sidecar_path = argv[1], .max_frame_bytes = 64 * 1024});
	if (!process.start({.project = "/tmp/project", .prompt = "hello"}, sink))
		return EXIT_FAILURE;
	if (!sink->wait_for("done")) return EXIT_FAILURE;
	bool session = false;
	bool text = false;
	bool tool = false;
	{
		std::scoped_lock lock(sink->mutex);
		for (const auto& event : sink->events) {
			session |= event.type == "session" && event.value == "session-1";
			text |= event.type == "text" && event.value == "fixture response";
			tool |= event.type == "tool" && event.value == "read";
			if (event.run_id != 1) return EXIT_FAILURE;
		}
	}
	if (!session || !text || !tool || process.running()) return EXIT_FAILURE;

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
			if (event.run_id != 3) return EXIT_FAILURE;
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
	return EXIT_SUCCESS;
}
