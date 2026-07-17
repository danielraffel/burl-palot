#include "opencode_process.hpp"

#include <nlohmann/json.hpp>

#include <chrono>
#include <condition_variable>
#include <cstdlib>
#include <fstream>
#include <iostream>
#include <memory>
#include <mutex>
#include <string>
#include <vector>

class RealSink final : public OpenCodeEventSink {
public:
	void post(OpenCodeEvent event) override {
		std::scoped_lock lock(mutex);
		events.push_back(std::move(event));
		changed.notify_all();
	}
	bool wait_for(std::string_view type, std::chrono::seconds timeout) {
		std::unique_lock lock(mutex);
		return changed.wait_for(lock, timeout, [&] {
			for (const auto& event : events) if (event.type == type) return true;
			return false;
		});
	}
	bool wait_terminal(std::chrono::seconds timeout) {
		std::unique_lock lock(mutex);
		return changed.wait_for(lock, timeout, [&] {
			for (const auto& event : events) if (event.type == "done" || event.type == "error") return true;
			return false;
		});
	}
	std::string error() const {
		std::scoped_lock lock(mutex);
		for (const auto& event : events) if (event.type == "error") return event.value;
		return {};
	}
	std::string text() const {
		std::scoped_lock lock(mutex);
		std::string out;
		for (const auto& event : events) if (event.type == "text") out += event.value;
		return out;
	}
	std::size_t count(std::string_view type) const {
		std::scoped_lock lock(mutex);
		return static_cast<std::size_t>(std::count_if(events.begin(), events.end(),
			[&](const auto& event) { return event.type == type; }));
	}
	std::string session() const {
		std::scoped_lock lock(mutex);
		for (const auto& event : events) if (event.type == "session") return event.value;
		return {};
	}
	mutable std::mutex mutex;
	std::condition_variable changed;
	std::vector<OpenCodeEvent> events;
};

int main(int argc, char** argv) {
	if (argc != 4) {
		std::cerr << "usage: real-opencode-e2e SIDECAR PROJECT EVIDENCE_JSON\n";
		return 2;
	}
	const std::string sidecar = argv[1], project = argv[2], evidence_path = argv[3];
	const std::string opencode_version = std::getenv("PALOT_OPENCODE_VERSION") ? std::getenv("PALOT_OPENCODE_VERSION") : "unknown";
	const std::string sidecar_sha = std::getenv("PALOT_SIDECAR_SHA256") ? std::getenv("PALOT_SIDECAR_SHA256") : "unknown";
	const auto nonce = std::to_string(std::chrono::system_clock::now().time_since_epoch().count());
	const auto marker = "BURL_REAL_STREAM_" + nonce;
	const auto retry_marker = "BURL_REAL_RETRY_" + nonce;
	OpenCodeProcess process({.sidecar_path = sidecar, .max_frame_bytes = 1024 * 1024});

	auto first = std::make_shared<RealSink>();
	if (!process.start({.project = project, .prompt = "Reply exactly: " + marker}, first) ||
	    !first->wait_terminal(std::chrono::seconds(180)) || !first->error().empty() ||
	    first->count("text") < 2 || first->text().find(marker) == std::string::npos) {
		std::cerr << "initial real prompt failed: " << first->error() << '\n'; return 3;
	}
	std::cerr << "phase initial pass deltas=" << first->count("text") << '\n';
	const auto session = first->session();
	if (session.empty()) return 4;

	auto cancelled = std::make_shared<RealSink>();
	if (!process.start({.project = project,
	                    .prompt = "Write a detailed numbered analysis with at least 1000 words, beginning with CANCEL_STREAM_PROBE."}, cancelled) ||
	    !cancelled->wait_for("text", std::chrono::seconds(120))) return 5;
	process.cancel();
	if (!cancelled->wait_for("error", std::chrono::seconds(20))) return 6;
	std::cerr << "phase cancellation pass deltas=" << cancelled->count("text") << '\n';
	std::this_thread::sleep_for(std::chrono::seconds(3));

	auto retry = std::make_shared<RealSink>();
	if (!process.start({.project = project, .prompt = "Reply exactly: " + retry_marker,
	                    .session = session, .failed_request_id = "2-prompt"}, retry) ||
	    !retry->wait_terminal(std::chrono::seconds(180)) || !retry->error().empty() ||
	    retry->count("text") == 0 || retry->text().find(retry_marker) == std::string::npos) {
		std::cerr << "real retry failed: " << retry->error() << '\n'; return 7;
	}
	std::cerr << "phase retry pass deltas=" << retry->count("text") << '\n';

	nlohmann::json evidence = {
		{"schemaVersion", 1}, {"kind", "real-opencode-stream-proof"},
		{"provenance", {{"opencodePath", "/opt/homebrew/bin/opencode"}, {"opencodeVersion", opencode_version},
		                {"sidecarSha256", sidecar_sha}, {"transport", "bundled-sidecar-stdio-v1"}}},
		{"project", "<redacted-existing-directory>"},
		{"initial", {{"marker", marker}, {"streamDeltaCount", first->count("text")},
		             {"markerObserved", true}, {"sessionCreated", true}}},
		{"cancellation", {{"streamStarted", cancelled->count("text") > 0}, {"cancelled", true},
		                    {"streamDeltaCountBeforeCancel", cancelled->count("text")}}},
		{"retry", {{"attemptedWithFailedRequestId", "2-prompt"},
		             {"streamDeltaCount", retry->count("text")}, {"marker", retry_marker},
		             {"markerObserved", true}, {"completed", true}}}
	};
	std::ofstream output(evidence_path, std::ios::binary | std::ios::trunc);
	output << evidence.dump(2) << '\n';
	if (!output.good()) return 8;
	std::cout << evidence.dump() << '\n';
	return EXIT_SUCCESS;
}
