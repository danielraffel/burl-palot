#pragma once

#include "opencode_process.hpp"

#include <pulp/view/text_editor.hpp>
#include <pulp/view/view.hpp>

#include <string>
#include <vector>

class PalotView final : public pulp::view::View {
public:
	PalotView();
	~PalotView() override;
	void paint(pulp::canvas::Canvas& canvas) override;
	void layout_children() override;
	void on_mouse_event(const pulp::view::MouseEvent& event) override;
	bool wants_mouse_input() const override { return true; }
	bool wants_wheel_scroll() const override { return true; }

private:
	void send_prompt(const std::string& prompt);
	void handle_event(std::string type, std::string value);
	void persist() const;
	void restore();

	pulp::view::TextEditor* project_ = nullptr;
	pulp::view::TextEditor* composer_ = nullptr;
	OpenCodeProcess process_;
	std::vector<std::pair<std::string, std::string>> messages_;
	std::string session_;
	std::string status_ = "Ready";
	std::string last_prompt_;
	float transcript_scroll_ = 0.0f;
};
