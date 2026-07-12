#include "source_aware_chat_slice.hpp"

#include <pulp/view/accessibility.hpp>

#include <algorithm>
#include <cmath>

SourceAwareChatSlice::SourceAwareChatSlice() {
	markdown_.set_bounds({0.0f, 0.0f, 720.0f, 1000.0f});
	markdown_.set_access_role(pulp::view::View::AccessRole::group);
	markdown_.set_access_label("Conversation log");
	composer_.set_text("draft composition");
	composer_.set_selection(2, 8);
	composer_.on_focus_changed(true);
	composer_.set_marked_text("かな", 0, 6);
}

pulp::state::AsyncTaskKey SourceAwareChatSlice::start(Identity identity) {
	identity_ = std::move(identity);
	text_.clear();
	content_version_ = 1;
	auto task = reducer_.start();
	pulp::view::CollectionModel::Snapshot snapshot;
	snapshot.epoch = task.generation;
	snapshot.revision = 1;
	snapshot.items.push_back({logical_key(identity_), content_version_, 28.0f, "article"});
	collection_.apply_snapshot(snapshot);
	markdown_.set_id(message_accessibility_id());
	return task;
}

bool SourceAwareChatSlice::enqueue(const TypedEvent& event) {
	if (event.identity.session_id != identity_.session_id ||
	    event.identity.message_id != identity_.message_id ||
	    event.identity.part_id != identity_.part_id ||
	    (event.kind == TypedEvent::Kind::part_delta && event.field != "text")) return false;
	pulp::state::AsyncEvent reduced;
	reduced.key = event.task;
	reduced.seq_first = event.sequence;
	reduced.seq_last = event.sequence;
	reduced.command_id = reducer_.command_id();
	reduced.kind = pulp::state::AsyncEventKind::delta;
	reduced.logical_id = logical_key(event.identity);
	reduced.payload = event.text;
	return reducer_.enqueue(std::move(reduced));
}

SourceAwareChatSlice::FrameResult SourceAwareChatSlice::flush_frame() {
	const auto stale_before = reducer_.stale_drops();
	const auto previous = reducer_.state();
	reducer_.drain(128, 1024 * 1024);
	text_ = reducer_.state();
	FrameResult result;
	result.stale = reducer_.stale_drops() != stale_before;
	result.changed = text_ != previous;
	if (result.changed) reconcile_native_markdown();
	result.markdown_height = markdown_.content_height();
	result.scroll_y = scroll_y_;
	result.state_hash = hash(text_);
	state_hashes_.push_back(result.state_hash);
	return result;
}

void SourceAwareChatSlice::cancel_and_restart(Identity identity) {
	reducer_.request_cancel();
	start(std::move(identity));
}

void SourceAwareChatSlice::set_viewport(float scroll_y, float height,
	                                    bool user_scrolling, bool selecting) {
	scroll_y_ = scroll_y;
	viewport_height_ = height;
	user_scrolling_ = user_scrolling;
	selecting_ = selecting;
}

float SourceAwareChatSlice::relayout_markdown_width(float width) {
	markdown_.set_bounds({0.0f, 0.0f, width, 1000.0f});
	markdown_.layout_children();
	++width_only_reflows_;
	return layout_prepared_markdown(width);
}

std::string SourceAwareChatSlice::message_accessibility_id() const {
	return collection_.accessibility_id(logical_key(identity_), "message");
}

std::uint64_t SourceAwareChatSlice::hash(std::string_view text) {
	std::uint64_t value = 1469598103934665603ull;
	for (const unsigned char byte : text) { value ^= byte; value *= 1099511628211ull; }
	return value;
}

std::string SourceAwareChatSlice::logical_key(const Identity& identity) {
	return identity.session_id + "/" + identity.message_id + "/" + identity.part_id;
}

void SourceAwareChatSlice::reconcile_native_markdown() {
	const bool follow = collection_.should_follow_bottom(scroll_y_, viewport_height_, 24.0f,
	                                                    user_scrolling_, selecting_);
	const auto anchor = collection_.capture_anchor(scroll_y_, viewport_height_);
	markdown_.set_markdown(text_);
	prepare_native_markdown();
	markdown_.layout_children();
	const float measured = std::max(1.0f, layout_prepared_markdown(markdown_.bounds().width));
	const auto old_revision = collection_.revision();
	++content_version_;
	pulp::view::CollectionModel::Item replacement{
		logical_key(identity_), content_version_, measured, "article"};
	collection_.apply_patch({old_revision, old_revision + 1,
	                         {pulp::view::CollectionModel::Reload{0, replacement}}});
	if (follow) scroll_y_ = collection_.bottom_scroll(viewport_height_);
	else if (anchor) scroll_y_ = collection_.restore_anchor(*anchor);
	++collection_notifications_;
	const std::string announcement = text_.substr(text_.size() > 480 ? text_.size() - 480 : 0);
	pulp::view::announce_accessibility(announcement,
	                                   pulp::view::AnnouncementPriority::Polite);
	++accessibility_announcements_;
}

void SourceAwareChatSlice::prepare_native_markdown() {
	pulp::canvas::AttributedString attributed;
	for (const auto& block : markdown_.document().blocks()) {
		for (auto span : block.attributed_text.spans()) attributed.append(std::move(span));
		pulp::canvas::TextSpan newline;
		newline.text = "\n";
		newline.font_family = "system";
		newline.font_size = 14.0f;
		attributed.append(std::move(newline));
	}
	prepared_markdown_ = text_shaper_.prepare(attributed);
	++prepared_text_generations_;
}

float SourceAwareChatSlice::layout_prepared_markdown(float width) {
	return text_shaper_.measure_height(prepared_markdown_, std::max(1.0f, width));
}
