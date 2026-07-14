#pragma once

#include <atomic>
#include <cstdint>
#include <memory>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

struct OpenCodeEvent {
	std::uint64_t run_id = 0;
	std::string type;
	std::string value;
};

class OpenCodeEventSink {
public:
	virtual ~OpenCodeEventSink() = default;
	virtual void post(OpenCodeEvent event) = 0;
};

struct OpenCodeAttachment {
	std::string url;
	std::string media_type = "application/octet-stream";
	std::string filename;
};

struct OpenCodeRequest {
	std::string project;
	std::string prompt;
	std::string session;
	std::string failed_request_id;
	std::string provider_id = "opencode";
	std::string model_id = "north-mini-code-free";
	std::vector<OpenCodeAttachment> attachments;
};

class OpenCodeProcess {
public:
	struct Options {
		std::string sidecar_path;
		std::size_t max_frame_bytes = 1024 * 1024;
	};

	OpenCodeProcess();
	explicit OpenCodeProcess(Options options);
	~OpenCodeProcess();
	OpenCodeProcess(const OpenCodeProcess&) = delete;
	OpenCodeProcess& operator=(const OpenCodeProcess&) = delete;

	bool start(OpenCodeRequest request, std::weak_ptr<OpenCodeEventSink> sink);
	bool session_action(std::string action, std::string message_id,
	                    std::weak_ptr<OpenCodeEventSink> sink);
	void cancel();
	bool running() const;
	std::uint64_t run_id() const;

	static std::string default_sidecar_path();

private:
	struct State;
	static void run(std::shared_ptr<State> state);

	std::shared_ptr<State> state_;
	std::jthread worker_;
};
