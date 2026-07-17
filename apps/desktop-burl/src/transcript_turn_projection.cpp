#include "transcript_turn_projection.hpp"

#include <cstddef>
#include <unordered_map>

std::vector<TranscriptProjectionRow> project_transcript_turns(
	std::vector<TranscriptProjectionRow> rows) {
	std::vector<std::string> user_messages;
	std::unordered_map<std::string, std::size_t> user_index;
	std::unordered_map<std::string, std::string> assistant_parent;
	for (const auto& row : rows) {
		if (row.message_role == "user" && !row.message_id.empty() &&
		    !user_index.contains(row.message_id)) {
			user_index.emplace(row.message_id, user_messages.size());
			user_messages.push_back(row.message_id);
		} else if (row.message_role == "assistant" && !row.message_id.empty() &&
		           !row.parent_message_id.empty()) {
			assistant_parent[row.message_id] = row.parent_message_id;
		}
	}

	for (auto& row : rows) {
		std::string turn_user_message;
		if (row.message_role == "user") {
			turn_user_message = row.message_id;
		} else if (row.message_role == "assistant") {
			turn_user_message = row.parent_message_id;
		} else if (!row.message_id.empty()) {
			if (const auto assistant = assistant_parent.find(row.message_id);
			    assistant != assistant_parent.end())
				turn_user_message = assistant->second;
		}
		const auto turn = user_index.find(turn_user_message);
		if (turn == user_index.end()) continue;
		row.values["turn.id"] = turn_user_message;
		row.values["turn.user-message-id"] = turn_user_message;
		const auto next = turn->second + 1;
		if (next < user_messages.size())
			row.values["turn.next-user-message-id"] = user_messages[next];
	}
	return rows;
}
