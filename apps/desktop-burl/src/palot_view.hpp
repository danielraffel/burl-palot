#pragma once

#include "opencode_process.hpp"
#include "imported_root_host.hpp"
#include "runtime_session_state.hpp"

#include <pulp/view/buttons.hpp>
#include <pulp/view/text_editor.hpp>
#include <pulp/view/view.hpp>
#include <pulp/view/virtual_list.hpp>
#include <pulp/view/window_host.hpp>

#include <string>
#include <filesystem>
#include <functional>
#include <memory>
#include <unordered_map>
#include <vector>

class PalotView final : public pulp::view::View {
public:
	explicit PalotView(std::filesystem::path design_ir_path = {},
	                   std::filesystem::path binding_manifest_path = {});
	~PalotView() override;
	void paint(pulp::canvas::Canvas& canvas) override;
	void layout_children() override;
	void start_demo(std::string project, std::string prompt);
	void load_visual_parity_fixture();
	bool invoke_imported_action(std::string_view action);
	void flush_demo_projection();
	[[nodiscard]] const std::string& demo_session_id() const noexcept { return runtime_state_.session; }
	[[nodiscard]] bool source_observed_primary_tree() const noexcept;
	[[nodiscard]] const std::vector<std::string>& unattached_required_actions() const noexcept;
	[[nodiscard]] bool sidebar_open() const noexcept { return sidebar_open_; }
	[[nodiscard]] bool server_menu_open() const noexcept { return server_menu_open_; }
	[[nodiscard]] bool project_search_open() const noexcept { return project_search_open_; }
	[[nodiscard]] bool command_palette_open() const noexcept { return command_palette_open_; }
	[[nodiscard]] bool title_editing() const noexcept { return title_editing_; }
	[[nodiscard]] bool review_panel_open() const noexcept { return review_panel_open_; }
	[[nodiscard]] bool session_metrics_open() const noexcept { return session_metrics_open_; }
	[[nodiscard]] std::string_view theme_preference() const noexcept { return theme_preference_; }
	[[nodiscard]] bool external_open_menu_open() const noexcept { return external_open_menu_open_; }
	[[nodiscard]] bool composer_agent_menu_open() const noexcept { return composer_agent_menu_open_; }
	[[nodiscard]] bool composer_model_menu_open() const noexcept { return composer_model_menu_open_; }
	[[nodiscard]] bool composer_variant_menu_open() const noexcept { return composer_variant_menu_open_; }
	[[nodiscard]] std::string_view display_mode() const noexcept { return display_mode_; }
	[[nodiscard]] const std::string& navigation_route() const noexcept { return navigation_route_; }
	[[nodiscard]] std::vector<pulp::view::ImportedListItem> transcript_projection() const;
	std::function<void()> on_demo_complete;
	std::function<void()> on_stream_delta;
	std::function<void()> on_demo_error;
	std::function<void(pulp::view::WindowAppearance)> on_window_appearance_change;
private:
	struct TranscriptEntry {
		std::string key;
		std::string role;
		std::string text;
		std::string template_id;
		std::string message_role;
		std::string message_id;
		std::string parent_message_id;
		std::unordered_map<std::string, std::string> values;
	};
	struct MessageIdentity {
		std::string role;
		std::string parent_message_id;
	};
	class UiEventSink;
	void send_prompt(const std::string& prompt, bool retry = false);
	void handle_event(std::string type, std::string value);
	void persist() const;
	void restore();
	void choose_project_folder();
	void set_configuration_error(std::string error);
	void append_message(std::string role, std::string text, bool announce,
	                    std::string message_id = {}, std::string message_role = {},
	                    std::string parent_message_id = {});
	void upsert_reasoning(std::string payload);
	void upsert_tool(std::string payload, bool announce);
	void sync_imported_transcript();
	void sync_imported_projects();
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
	std::vector<TranscriptEntry> messages_;
	std::unordered_map<std::string, MessageIdentity> message_identities_;
	RuntimeSessionState runtime_state_;
	std::string status_ = "Ready";
	std::string last_prompt_;
	std::string last_request_id_;
	std::string configuration_error_;
	bool sidebar_open_ = true;
	bool server_menu_open_ = false;
	bool project_search_open_ = false;
	bool command_palette_open_ = false;
	bool title_editing_ = false;
	bool review_panel_open_ = false;
	std::string presentation_state_ = "default";
	bool session_metrics_open_ = false;
	std::string theme_preference_ = "dark";
	bool external_open_menu_open_ = false;
	bool composer_agent_menu_open_ = false;
	bool composer_model_menu_open_ = false;
	bool composer_variant_menu_open_ = false;
	std::string display_mode_ = "verbose";
	std::string navigation_route_ = "/";
	ImportedRootHost* imported_root_ = nullptr;
	pulp::view::FrameUpdateCoalescer transcript_updates_;
};
