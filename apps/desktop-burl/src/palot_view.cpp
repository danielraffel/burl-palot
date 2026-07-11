#include "palot_view.hpp"

#include <pulp/events/main_thread_dispatcher.hpp>

#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <memory>

namespace {

constexpr float kSidebarWidth = 250.0f;
constexpr float kComposerHeight = 92.0f;

std::filesystem::path state_path() {
	if (const char* home = std::getenv("HOME"))
		return std::filesystem::path(home) / ".local/share/palot/burl-session.txt";
	return "burl-session.txt";
}

}  // namespace

PalotView::PalotView() {
	set_access_label("Palot chat workspace");
	auto project = std::make_unique<pulp::view::TextEditor>();
	project->placeholder = "Project folder";
	project->set_access_label("Project folder");
	project->set_text(std::filesystem::current_path().string());
	project_ = project.get();
	add_child(std::move(project));

	auto composer = std::make_unique<pulp::view::TextEditor>();
	composer->placeholder = "Ask OpenCode…  Return to send, Esc to cancel";
	composer->multi_line = true;
	composer->multi_line_return_behavior =
		pulp::view::TextEditor::MultiLineReturnBehavior::commit;
	composer->set_access_label("Message composer");
	composer->on_return = [this](const std::string& text) {
		if (!text.empty()) send_prompt(text);
		else if (!last_prompt_.empty()) send_prompt(last_prompt_);
	};
	composer->on_escape = [this] {
		process_.cancel();
		status_ = "Cancelling…";
		request_repaint();
	};
	composer_ = composer.get();
	add_child(std::move(composer));
	restore();
}

PalotView::~PalotView() {
	process_.cancel();
	persist();
}

void PalotView::layout_children() {
	const auto b = local_bounds();
	project_->set_bounds({20.0f, 86.0f, kSidebarWidth - 40.0f, 38.0f});
	composer_->set_bounds({kSidebarWidth + 28.0f, b.height - kComposerHeight - 24.0f,
	                       b.width - kSidebarWidth - 56.0f, kComposerHeight});
}

void PalotView::paint(pulp::canvas::Canvas& canvas) {
	const auto b = local_bounds();
	canvas.set_fill_color(pulp::canvas::Color::rgba8(8, 13, 24));
	canvas.fill_rect(0, 0, b.width, b.height);
	canvas.set_fill_color(pulp::canvas::Color::rgba8(13, 22, 38));
	canvas.fill_rect(0, 0, kSidebarWidth, b.height);
	canvas.set_fill_color(pulp::canvas::Color::rgba8(241, 245, 249));
	canvas.set_font("Inter", 25.0f);
	canvas.fill_text("Palot", 20.0f, 48.0f);
	canvas.set_fill_color(pulp::canvas::Color::rgba8(100, 116, 139));
	canvas.set_font("Inter", 13.0f);
	canvas.fill_text("PROJECT", 20.0f, 75.0f);
	canvas.fill_text("OpenCode • " + status_, 20.0f, b.height - 28.0f);

	float y = 54.0f;
	for (const auto& [role, text] : messages_) {
		const bool user = role == "You";
		canvas.set_fill_color(user ? pulp::canvas::Color::rgba8(20, 48, 60)
		                           : pulp::canvas::Color::rgba8(24, 33, 49));
		canvas.fill_rounded_rect(kSidebarWidth + 28.0f, y,
		                         b.width - kSidebarWidth - 56.0f, 68.0f, 12.0f);
		canvas.set_fill_color(user ? pulp::canvas::Color::rgba8(94, 234, 212)
		                           : pulp::canvas::Color::rgba8(148, 163, 184));
		canvas.set_font("Inter", 12.0f);
		canvas.fill_text(role, kSidebarWidth + 44.0f, y + 22.0f);
		canvas.set_fill_color(pulp::canvas::Color::rgba8(241, 245, 249));
		canvas.set_font("Inter", 15.0f);
		canvas.fill_text(text.substr(0, 120), kSidebarWidth + 44.0f, y + 49.0f);
		y += 82.0f;
		if (y > b.height - kComposerHeight - 110.0f) break;
	}
}

void PalotView::send_prompt(const std::string& prompt) {
	if (prompt.empty() || process_.running()) return;
	const std::string prompt_value = prompt;
	last_prompt_ = prompt_value;
	messages_.emplace_back("You", prompt_value);
	composer_->set_text("");
	status_ = "Streaming";
	request_repaint();
	process_.start(project_->text(), prompt_value, session_,
	               [this](std::string type, std::string value) {
		pulp::events::MainThreadDispatcher::call_async(
			[this, type = std::move(type), value = std::move(value)]() mutable {
				handle_event(std::move(type), std::move(value));
			});
	});
}

void PalotView::handle_event(std::string type, std::string value) {
	if (type == "session") {
		session_ = std::move(value);
	} else if (type == "text" && !value.empty()) {
		messages_.emplace_back("OpenCode", std::move(value));
	} else if (type == "tool") {
		messages_.emplace_back("Tool", std::move(value));
	} else if (type == "done") {
		status_ = "Ready";
		persist();
	} else if (type == "error") {
		status_ = value == "cancelled" ? "Cancelled" : "Error: " + value.substr(0, 80);
	}
	request_repaint();
}

void PalotView::persist() const {
	const auto path = state_path();
	std::error_code error;
	std::filesystem::create_directories(path.parent_path(), error);
	std::ofstream output(path, std::ios::trunc);
	output << session_ << '\n' << project_->text() << '\n';
	for (const auto& [role, text] : messages_) output << role << '\t' << text << '\n';
}

void PalotView::restore() {
	std::ifstream input(state_path());
	std::string line;
	if (!std::getline(input, session_)) return;
	if (std::getline(input, line) && !line.empty()) project_->set_text(line);
	while (std::getline(input, line)) {
		const auto tab = line.find('\t');
		if (tab != std::string::npos) {
			messages_.emplace_back(line.substr(0, tab), line.substr(tab + 1));
			if (messages_.back().first == "You") last_prompt_ = messages_.back().second;
		}
	}
}
