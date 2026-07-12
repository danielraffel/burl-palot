#pragma once

#include "opencode_process.hpp"
#include "imported_root_host.hpp"

#include <pulp/view/buttons.hpp>
#include <pulp/view/text_editor.hpp>
#include <pulp/view/view.hpp>
#include <pulp/view/virtual_list.hpp>

#include <string>
#include <functional>
#include <memory>
#include <vector>

class PalotView final : public pulp::view::View {
public:
	PalotView();
	~PalotView() override;
	void paint(pulp::canvas::Canvas& canvas) override;
	void layout_children() override;
	void start_demo(std::string project, std::string prompt);
	void load_visual_parity_fixture();
	[[nodiscard]] bool source_observed_primary_tree() const noexcept;
	[[nodiscard]] const std::vector<std::string>& unattached_required_actions() const noexcept;
	std::function<void()> on_demo_complete;
private:
	class UiEventSink;
	void send_prompt(const std::string& prompt, bool retry = false);
	void handle_event(std::string type, std::string value);
	void persist() const;
	void restore();
	void choose_project_folder();
	void set_configuration_error(std::string error);
	void append_message(std::string role, std::string text, bool announce);
	void sync_imported_transcript();
	void schedule_imported_transcript_sync();
	float message_height(std::size_t index) const;

	pulp::view::TextEditor* project_ = nullptr;
	pulp::view::TextEditor* composer_ = nullptr;
	pulp::view::TextEditor* session_editor_ = nullptr;
	pulp::view::TextEditor* provider_ = nullptr;
	pulp::view::TextEditor* model_ = nullptr;
	pulp::view::TextButton* choose_project_ = nullptr;
	pulp::view::TextButton* new_session_ = nullptr;
	pulp::view::TextButton* open_session_ = nullptr;
	pulp::view::TextButton* send_ = nullptr;
	pulp::view::TextButton* cancel_ = nullptr;
	pulp::view::VirtualList* transcript_ = nullptr;
	OpenCodeProcess process_;
	std::shared_ptr<UiEventSink> event_sink_;
	std::vector<std::pair<std::string, std::string>> messages_;
	std::string session_;
	std::string status_ = "Ready";
	std::string last_prompt_;
	std::string last_request_id_;
	std::string configuration_error_;
	bool create_session_ = true;
	ImportedRootHost* imported_root_ = nullptr;
	pulp::view::FrameUpdateCoalescer transcript_updates_;
};
