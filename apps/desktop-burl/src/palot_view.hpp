#pragma once

#include "opencode_process.hpp"

#include <pulp/view/text_editor.hpp>
#include <pulp/view/view.hpp>
#include <pulp/view/virtual_list.hpp>

#include <string>
#include <memory>
#include <vector>

class PalotView final : public pulp::view::View {
public:
	PalotView();
	~PalotView() override;
	void paint(pulp::canvas::Canvas& canvas) override;
	void layout_children() override;
private:
	class UiEventSink;
	void send_prompt(const std::string& prompt, bool retry = false);
	void handle_event(std::string type, std::string value);
	void persist() const;
	void restore();
	void append_message(std::string role, std::string text, bool announce);
	float message_height(std::size_t index) const;

	pulp::view::TextEditor* project_ = nullptr;
	pulp::view::TextEditor* composer_ = nullptr;
	pulp::view::VirtualList* transcript_ = nullptr;
	OpenCodeProcess process_;
	std::shared_ptr<UiEventSink> event_sink_;
	std::vector<std::pair<std::string, std::string>> messages_;
	std::string session_;
	std::string status_ = "Ready";
	std::string last_prompt_;
	std::string last_request_id_;
};
