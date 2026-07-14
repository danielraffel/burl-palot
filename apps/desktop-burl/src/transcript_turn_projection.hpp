#pragma once

#include <string>
#include <unordered_map>
#include <vector>

struct TranscriptProjectionRow {
	std::string key;
	std::string template_id;
	std::string message_role;
	std::string message_id;
	std::string parent_message_id;
	std::unordered_map<std::string, std::string> values;
};

// Projects source message identities into the per-row payload fields consumed by
// imported turn actions. Unknown, orphaned, and terminal identities deliberately
// remain absent so the binding layer can fail closed.
std::vector<TranscriptProjectionRow> project_transcript_turns(
	std::vector<TranscriptProjectionRow> rows);
