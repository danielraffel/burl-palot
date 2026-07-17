#include "source_aware_chat_slice.hpp"

#include <pulp/view/accessibility.hpp>
#include <nlohmann/json.hpp>

#include <cstdlib>
#include <cmath>
#include <fstream>
#include <iostream>

[[noreturn]] static void fail_check(const char* expression, int line) {
	std::cerr << "CHECK failed at line " << line << ": " << expression << "\n";
	std::exit(1);
}
#define CHECK(expression) do { if (!(expression)) fail_check(#expression, __LINE__); } while (false)

int main(int argc, char** argv) {
	CHECK(argc == 2);
	nlohmann::json fixture;
	std::ifstream(argv[1]) >> fixture;
	const auto identity_json = fixture.at("identity");
	SourceAwareChatSlice::Identity identity{identity_json.at("sessionID"),
	                                        identity_json.at("messageID"),
	                                        identity_json.at("partID")};
	std::vector<std::string> announcements;
	pulp::view::set_announcement_sink([&](std::string_view text, auto priority) {
		CHECK(priority == pulp::view::AnnouncementPriority::Polite);
		CHECK(text.size() <= 480);
		announcements.emplace_back(text);
	});

	SourceAwareChatSlice slice;
	auto task = slice.start(identity);
	const auto stable_ax_id = slice.message_accessibility_id();
	const auto selection = slice.composer().selection_range();
	const auto marked = slice.composer().marked_range();
	const auto caret = slice.composer().caret_pos();
	CHECK(slice.composer().has_focus() && slice.composer().has_marked_text());

	for (const auto& event : fixture.at("events")) {
		SourceAwareChatSlice::TypedEvent typed;
		typed.kind = event.at("type") == "message.part.updated"
			? SourceAwareChatSlice::TypedEvent::Kind::part_updated
			: SourceAwareChatSlice::TypedEvent::Kind::part_delta;
		typed.task = task;
		typed.sequence = event.at("seq");
		typed.identity = identity;
		typed.field = event.value("field", "text");
		typed.text = event.value("text", event.value("delta", ""));
		CHECK(slice.enqueue(typed));
	}

	slice.set_viewport(0.0f, 5.0f, false, false);
	const auto bottom = slice.flush_frame();
	CHECK(bottom.changed && slice.text() == fixture.at("expected").get<std::string>());
	CHECK(bottom.scroll_y > 0.0f);
	CHECK(slice.collection_notifications() == 1 && slice.accessibility_announcements() == 1);
	CHECK(announcements.size() == 1);
	CHECK(slice.message_accessibility_id() == stable_ax_id);
	CHECK(slice.composer().has_focus() && slice.composer().selection_range() == selection);
	CHECK(slice.composer().has_marked_text() && slice.composer().marked_range() == marked);
	CHECK(slice.composer().caret_pos() == caret);
	CHECK(slice.prepared_text_generations() == 1);
	const auto prepare_calls_after_append = pulp::canvas::text_shaper_prepare_call_count();
	const auto unchanged = slice.flush_frame();
	CHECK(!unchanged.changed && slice.prepared_text_generations() == 1);
	CHECK(slice.collection_notifications() == 1);
	CHECK(pulp::canvas::text_shaper_prepare_call_count() == prepare_calls_after_append);
	const float narrow_height = slice.relayout_markdown_width(160.0f);
	const float wide_height = slice.relayout_markdown_width(720.0f);
	CHECK(narrow_height >= wide_height);
	CHECK(slice.prepared_text_generations() == 1 && slice.width_only_reflows() == 2);
	CHECK(pulp::canvas::text_shaper_prepare_call_count() == prepare_calls_after_append);

	SourceAwareChatSlice away;
	auto away_task = away.start(identity);
	away.set_viewport(0.0f, 10.0f, true, false);
	for (const auto& event : fixture.at("events")) {
		SourceAwareChatSlice::TypedEvent typed{
			event.at("type") == "message.part.updated" ? SourceAwareChatSlice::TypedEvent::Kind::part_updated : SourceAwareChatSlice::TypedEvent::Kind::part_delta,
			away_task, event.at("seq"), identity, event.value("field", "text"),
			event.value("text", event.value("delta", ""))};
		CHECK(away.enqueue(typed));
	}
	const auto scrolled_away = away.flush_frame();
	CHECK(std::abs(scrolled_away.scroll_y) <= 0.5f);

	const auto stale_task = task;
	slice.cancel_and_restart(identity);
	SourceAwareChatSlice::TypedEvent stale{SourceAwareChatSlice::TypedEvent::Kind::part_delta,
	                                        stale_task, 4, identity, "text", "STALE"};
	CHECK(!slice.enqueue(stale));
	slice.flush_frame();
	CHECK(slice.text().empty() && slice.stale_drops() == 1);

	SourceAwareChatSlice replay;
	auto replay_task = replay.start(identity);
	for (const auto& event : fixture.at("events")) {
		SourceAwareChatSlice::TypedEvent typed{
			event.at("type") == "message.part.updated" ? SourceAwareChatSlice::TypedEvent::Kind::part_updated : SourceAwareChatSlice::TypedEvent::Kind::part_delta,
			replay_task, event.at("seq"), identity, event.value("field", "text"),
			event.value("text", event.value("delta", ""))};
		CHECK(replay.enqueue(typed));
	}
	replay.flush_frame();
	CHECK(replay.state_hashes().back() == away.state_hashes().back());
	pulp::view::set_announcement_sink(nullptr);
	std::cout << "source-aware-palot-slice PASS hash=" << replay.state_hashes().back() << "\n";
}
