#include "transcript_turn_projection.hpp"

#include <cstdlib>
#include <iostream>

[[noreturn]] static void fail(const char* expression, int line) {
	std::cerr << "CHECK failed at line " << line << ": " << expression << "\n";
	std::exit(1);
}
#define CHECK(expression) do { if (!(expression)) fail(#expression, __LINE__); } while (false)

int main() {
	auto rows = project_transcript_turns({
		{.key = "user-1", .template_id = "user", .message_role = "user",
		 .message_id = "message-user-1"},
		{.key = "reason-1", .template_id = "reasoning", .message_role = "part",
		 .message_id = "message-assistant-1"},
		{.key = "assistant-1", .template_id = "assistant", .message_role = "assistant",
		 .message_id = "message-assistant-1", .parent_message_id = "message-user-1"},
		{.key = "user-2", .template_id = "user", .message_role = "user",
		 .message_id = "message-user-2"},
		{.key = "assistant-2", .template_id = "assistant", .message_role = "assistant",
		 .message_id = "message-assistant-2", .parent_message_id = "message-user-2"},
		{.key = "orphan", .template_id = "tool", .message_role = "part",
		 .message_id = "message-unknown"},
	});
	for (std::size_t index : {0u, 1u, 2u}) {
		CHECK(rows[index].values.at("turn.id") == "message-user-1");
		CHECK(rows[index].values.at("turn.user-message-id") == "message-user-1");
		CHECK(rows[index].values.at("turn.next-user-message-id") == "message-user-2");
	}
	for (std::size_t index : {3u, 4u}) {
		CHECK(rows[index].values.at("turn.id") == "message-user-2");
		CHECK(rows[index].values.at("turn.user-message-id") == "message-user-2");
		CHECK(!rows[index].values.contains("turn.next-user-message-id"));
	}
	CHECK(rows[5].values.empty());

	auto synthetic = project_transcript_turns({{
		.key = "OpenCode-0", .template_id = "assistant", .message_role = "assistant",
	}});
	CHECK(synthetic.front().values.empty());
	std::cout << "transcript-turn-projection PASS\n";
}
