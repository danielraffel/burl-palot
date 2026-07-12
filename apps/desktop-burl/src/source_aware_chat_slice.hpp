#pragma once

#include <pulp/state/async_reducer.hpp>
#include <pulp/canvas/text_shaper.hpp>
#include <pulp/view/collection_model.hpp>
#include <pulp/view/markdown_view.hpp>
#include <pulp/view/text_editor.hpp>

#include <cstdint>
#include <string>
#include <string_view>
#include <vector>

class SourceAwareChatSlice {
public:
	struct Identity {
		std::string session_id;
		std::string message_id;
		std::string part_id;
	};

	struct TypedEvent {
		enum class Kind { part_updated, part_delta };
		Kind kind = Kind::part_delta;
		pulp::state::AsyncTaskKey task;
		std::uint64_t sequence = 0;
		Identity identity;
		std::string field;
		std::string text;
	};

	struct FrameResult {
		bool changed = false;
		bool stale = false;
		float markdown_height = 0.0f;
		float scroll_y = 0.0f;
		std::uint64_t state_hash = 0;
	};

	SourceAwareChatSlice();
	pulp::state::AsyncTaskKey start(Identity identity);
	bool enqueue(const TypedEvent& event);
	FrameResult flush_frame();
	void cancel_and_restart(Identity identity);
	void set_viewport(float scroll_y, float height, bool user_scrolling, bool selecting);
	float relayout_markdown_width(float width);

	pulp::view::TextEditor& composer() { return composer_; }
	const std::string& text() const { return text_; }
	const Identity& identity() const { return identity_; }
	std::string message_accessibility_id() const;
	std::size_t collection_notifications() const { return collection_notifications_; }
	std::size_t accessibility_announcements() const { return accessibility_announcements_; }
	std::size_t stale_drops() const { return reducer_.stale_drops(); }
	const std::vector<std::uint64_t>& state_hashes() const { return state_hashes_; }
	std::size_t prepared_text_generations() const { return prepared_text_generations_; }
	std::size_t width_only_reflows() const { return width_only_reflows_; }

private:
	static std::uint64_t hash(std::string_view text);
	static std::string logical_key(const Identity& identity);
	void reconcile_native_markdown();
	void prepare_native_markdown();
	float layout_prepared_markdown(float width);

	pulp::state::AsyncReducer reducer_{7, {128, 1024 * 1024, 128}};
	pulp::view::CollectionModel collection_{"palot-transcript"};
	pulp::view::MarkdownView markdown_;
	pulp::canvas::TextShaper& text_shaper_ = pulp::canvas::global_text_shaper();
	pulp::canvas::PreparedText prepared_markdown_;
	pulp::view::TextEditor composer_;
	Identity identity_;
	std::string text_;
	std::uint64_t content_version_ = 0;
	float scroll_y_ = 0.0f;
	float viewport_height_ = 320.0f;
	bool user_scrolling_ = false;
	bool selecting_ = false;
	std::size_t collection_notifications_ = 0;
	std::size_t accessibility_announcements_ = 0;
	std::size_t prepared_text_generations_ = 0;
	std::size_t width_only_reflows_ = 0;
	std::vector<std::uint64_t> state_hashes_;
};
