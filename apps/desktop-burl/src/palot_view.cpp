#include "palot_view.hpp"

#include <pulp/events/main_thread_dispatcher.hpp>

#include <cstdlib>
#include <algorithm>
#include <filesystem>
#include <fstream>
#include <memory>
#include <cstdint>
#include <fcntl.h>
#include <unistd.h>

namespace {

constexpr float kSidebarWidth = 250.0f;
constexpr float kComposerHeight = 92.0f;

std::filesystem::path state_path() {
	if (const char* home = std::getenv("HOME"))
		return std::filesystem::path(home) /
		       "Library/Application Support/Palot/burl-session.bin";
	return "burl-session.bin";
}

constexpr std::string_view kStateMagic = "PALOT01\n";
constexpr std::size_t kMaxStateBytes = 16 * 1024 * 1024;
constexpr std::uint32_t kMaxMessages = 10000;

void append_string(std::vector<std::uint8_t>& bytes, std::string_view value) {
	const auto length = static_cast<std::uint32_t>(value.size());
	for (int shift = 0; shift < 32; shift += 8)
		bytes.push_back(static_cast<std::uint8_t>((length >> shift) & 0xff));
	bytes.insert(bytes.end(), value.begin(), value.end());
}

bool read_string(const std::vector<std::uint8_t>& bytes, std::size_t& cursor,
	             std::string& value) {
	if (cursor + 4 > bytes.size()) return false;
	std::uint32_t length = 0;
	for (int shift = 0; shift < 32; shift += 8)
		length |= static_cast<std::uint32_t>(bytes[cursor++]) << shift;
	if (length > kMaxStateBytes || cursor + length > bytes.size()) return false;
	value.assign(reinterpret_cast<const char*>(bytes.data() + cursor), length);
	cursor += length;
	return true;
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

	float y = 54.0f - transcript_scroll_;
	for (const auto& [role, text] : messages_) {
		if (y + 68.0f < 40.0f) {
			y += 82.0f;
			continue;
		}
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

void PalotView::on_mouse_event(const pulp::view::MouseEvent& event) {
	if (!event.is_wheel || event.position.x < kSidebarWidth) return;
	const float viewport = std::max(0.0f, local_bounds().height - kComposerHeight - 150.0f);
	const float content = static_cast<float>(messages_.size()) * 82.0f;
	transcript_scroll_ = std::clamp(transcript_scroll_ + event.scroll_delta_y,
	                                0.0f, std::max(0.0f, content - viewport));
	request_repaint();
}

void PalotView::send_prompt(const std::string& prompt) {
	if (prompt.empty() || process_.running()) return;
	const std::string prompt_value = prompt;
	last_prompt_ = prompt_value;
	messages_.emplace_back("You", prompt_value);
	transcript_scroll_ = std::max(0.0f, static_cast<float>(messages_.size()) * 82.0f -
	                                      (local_bounds().height - kComposerHeight - 150.0f));
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
		transcript_scroll_ = std::max(0.0f, static_cast<float>(messages_.size()) * 82.0f -
		                                      (local_bounds().height - kComposerHeight - 150.0f));
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
	if (error) return;
	std::vector<std::uint8_t> bytes(kStateMagic.begin(), kStateMagic.end());
	append_string(bytes, session_);
	append_string(bytes, project_->text());
	const auto count = static_cast<std::uint32_t>(
		std::min<std::size_t>(messages_.size(), kMaxMessages));
	for (int shift = 0; shift < 32; shift += 8)
		bytes.push_back(static_cast<std::uint8_t>((count >> shift) & 0xff));
	for (std::size_t index = messages_.size() - count; index < messages_.size(); ++index) {
		append_string(bytes, messages_[index].first);
		append_string(bytes, messages_[index].second);
		if (bytes.size() > kMaxStateBytes) return;
	}
	const auto temporary = path.string() + ".tmp";
	const int descriptor = open(temporary.c_str(), O_WRONLY | O_CREAT | O_TRUNC, 0600);
	if (descriptor < 0) return;
	std::size_t written = 0;
	while (written < bytes.size()) {
		const ssize_t amount = write(descriptor, bytes.data() + written, bytes.size() - written);
		if (amount <= 0) { close(descriptor); unlink(temporary.c_str()); return; }
		written += static_cast<std::size_t>(amount);
	}
	fsync(descriptor);
	close(descriptor);
	if (rename(temporary.c_str(), path.c_str()) != 0) unlink(temporary.c_str());
}

void PalotView::restore() {
	std::ifstream input(state_path(), std::ios::binary | std::ios::ate);
	if (!input) return;
	const auto size = input.tellg();
	if (size < static_cast<std::streamoff>(kStateMagic.size()) ||
	    size > static_cast<std::streamoff>(kMaxStateBytes)) return;
	input.seekg(0);
	std::vector<std::uint8_t> bytes(static_cast<std::size_t>(size));
	if (!input.read(reinterpret_cast<char*>(bytes.data()), size)) return;
	if (!std::equal(kStateMagic.begin(), kStateMagic.end(), bytes.begin())) return;
	std::size_t cursor = kStateMagic.size();
	std::string project;
	if (!read_string(bytes, cursor, session_) || !read_string(bytes, cursor, project) ||
	    cursor + 4 > bytes.size()) return;
	if (!project.empty()) project_->set_text(project);
	std::uint32_t count = 0;
	for (int shift = 0; shift < 32; shift += 8)
		count |= static_cast<std::uint32_t>(bytes[cursor++]) << shift;
	if (count > kMaxMessages) return;
	for (std::uint32_t index = 0; index < count; ++index) {
		std::string role;
		std::string text;
		if (!read_string(bytes, cursor, role) || !read_string(bytes, cursor, text)) {
			messages_.clear();
			return;
		}
		messages_.emplace_back(std::move(role), std::move(text));
		if (messages_.back().first == "You") last_prompt_ = messages_.back().second;
	}
}
