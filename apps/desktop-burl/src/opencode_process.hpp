#pragma once

#include <atomic>
#include <functional>
#include <mutex>
#include <string>
#include <thread>

class OpenCodeProcess {
public:
	using EventCallback = std::function<void(std::string type, std::string value)>;

	~OpenCodeProcess();
	bool start(const std::string& project, const std::string& prompt,
	           const std::string& session, EventCallback callback);
	void cancel();
	bool running() const { return running_.load(); }

private:
	void run(std::string project, std::string prompt, std::string session,
	         EventCallback callback);

	std::atomic<bool> running_{false};
	std::mutex process_mutex_;
	int process_id_ = -1;
	std::jthread worker_;
};
