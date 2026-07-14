#include "palot_view.hpp"
#include "project_config.hpp"
#include "transcript_turn_projection.hpp"

#include <pulp/events/main_thread_dispatcher.hpp>
#include <pulp/platform/file_dialog.hpp>
#include <pulp/platform/clipboard.hpp>
#include <pulp/view/accessibility.hpp>
#include <pulp/view/buttons.hpp>
#include <pulp/view/markdown_view.hpp>
#include <pulp/view/widgets.hpp>
#include <nlohmann/json.hpp>

#include <cstdlib>
#include <algorithm>
#include <cmath>
#include <cctype>
#include <filesystem>
#include <fstream>
#include <memory>
#include <cstdint>
#include <fcntl.h>
#include <unistd.h>
#include <mutex>

namespace {

constexpr float kSidebarWidth = 280.0f;
constexpr float kAppBarHeight = 46.0f;
constexpr float kComposerHeight = 112.0f;
constexpr float kTranscriptTop = 58.0f;
constexpr float kTranscriptGap = 40.0f;
constexpr float kContentMaxWidth = 896.0f;
constexpr std::size_t kAccessibilitySummaryBytes = 480;

struct ProjectedTool {
	std::string id;
	std::string template_id;
	std::string label;
	std::string subject;
	std::string duration;
	std::string status;
};

std::string first_string(const nlohmann::json& object,
	                     std::initializer_list<std::string_view> keys) {
	if (!object.is_object()) return {};
	for (const auto key : keys) {
		const auto found = object.find(std::string(key));
		if (found != object.end() && found->is_string() && !found->get_ref<const std::string&>().empty())
			return found->get<std::string>();
	}
	return {};
}

ProjectedTool project_tool_part(std::string_view payload) {
	const auto part = nlohmann::json::parse(payload);
	if (!part.is_object() || part.value("type", "") != "tool")
		throw std::invalid_argument("OpenCode tool event is not a tool part");
	ProjectedTool out;
	out.id = first_string(part, {"id", "callID", "callId"});
	if (out.id.empty()) throw std::invalid_argument("OpenCode tool part has no stable identity");
	const auto tool = first_string(part, {"tool", "name"});
	const auto normalized = [&] {
		auto value = tool;
		std::ranges::transform(value, value.begin(), [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
		return value;
	}();
	out.template_id = normalized == "read" ? "tool.read" : "tool.edit";
	out.label = normalized == "read" ? "Read" :
	            (normalized == "edit" || normalized == "write" || normalized == "patch") ? "Edit" : tool;
	if (out.label.empty()) out.label = "Tool";
	out.label.front() = static_cast<char>(std::toupper(static_cast<unsigned char>(out.label.front())));
	const auto& state = part.contains("state") ? part.at("state") : nlohmann::json::object();
	out.status = first_string(state, {"status"});
	const auto& input = state.is_object() && state.contains("input") ? state.at("input") : nlohmann::json::object();
	out.subject = first_string(input, {"path", "filePath", "file", "filename"});
	if (out.subject.empty()) out.subject = first_string(state, {"title"});
	if (out.subject.empty()) out.subject = first_string(part, {"title"});
	if (out.subject.empty()) out.subject = tool;
	out.duration = out.status == "running" || out.status == "pending" ? "…" : "";
	if (state.is_object() && state.contains("time") && state.at("time").is_object()) {
		const auto& time = state.at("time");
		if (time.contains("start") && time.contains("end") && time.at("start").is_number() && time.at("end").is_number()) {
			auto seconds = time.at("end").get<double>() - time.at("start").get<double>();
			if (seconds > 100.0) seconds /= 1000.0;
			out.duration = std::to_string(std::max(0L, std::lround(seconds))) + "s";
		}
	}
	return out;
}

struct PalotComposer final : pulp::view::TextEditor {
	void paint(pulp::canvas::Canvas& canvas) override {
		pulp::view::TextEditor::paint(canvas);
		const auto b = local_bounds();
		canvas.set_font(".SF NS", 12.0f);
		canvas.set_fill_color(pulp::canvas::Color::rgba8(166, 166, 166));
		canvas.fill_text("+     Build⌄",
		                 18.0f, b.height - 17.0f);
		canvas.set_fill_color(pulp::canvas::Color::rgba8(248, 248, 248));
		canvas.fill_rounded_rect(b.width - 82.0f, b.height - 35.0f, 68.0f, 24.0f, 7.0f);
		canvas.set_fill_color(pulp::canvas::Color::rgba8(24, 24, 24));
		canvas.fill_text("□  8m 32s", b.width - 74.0f, b.height - 18.0f);
	}
};

struct PalotChromeButton final : pulp::view::TextButton {
	explicit PalotChromeButton(std::string text) : pulp::view::TextButton(std::move(text)) {
		set_style(Style::ghost);
	}
	void paint(pulp::canvas::Canvas& canvas) override {
		canvas.set_font(".SF NS", 12.0f);
		canvas.set_fill_color(pulp::canvas::Color::rgba8(190, 190, 190));
		canvas.fill_text(label(), 4.0f, std::max(15.0f, bounds().height * 0.62f));
	}
};

std::string accessibility_summary(std::string_view text) {
	if (text.size() <= kAccessibilitySummaryBytes) return std::string(text);
	std::size_t end = kAccessibilitySummaryBytes;
	while (end > 0 && (static_cast<unsigned char>(text[end]) & 0xc0) == 0x80) --end;
	return std::string(text.substr(0, end)) + "…";
}

struct MessageRow final : pulp::view::View {
	pulp::view::Label* role = nullptr;
	pulp::view::MarkdownView* content = nullptr;
	pulp::view::TextButton* copy = nullptr;
	bool user = false;
	bool tool = false;

	MessageRow() {
		set_access_role(AccessRole::group);
		set_overflow(Overflow::hidden);
	}

	void bind(const std::string& role_text, const std::string& text) {
		while (child_count() != 0) remove_child(child_at(child_count() - 1));
		user = role_text == "You";
		tool = role_text == "Tool";
		set_access_label(role_text + " message");

		auto role_label = std::make_unique<pulp::view::Label>(role_text);
		role_label->set_font_size(13.0f);
		role_label->set_font_weight(700);
		role_label->set_font_family(".SF NS");
		role_label->set_text_color(pulp::canvas::Color::rgba8(166, 166, 166));
		role = role_label.get();
		add_child(std::move(role_label));

		auto markdown = std::make_unique<pulp::view::MarkdownView>(
			tool ? "```json\n" + text + "\n```" : text);
		markdown->set_body_style(".SF NS", 13.0f, 300,
		                         pulp::canvas::Color::rgba8(237, 237, 237));
		markdown->set_code_font_family("Menlo");
		const auto summary = accessibility_summary(text);
		markdown->set_access_label(role_text + " message text: " + summary);
		markdown->set_access_value(summary);
		for (std::size_t index = 0; index < markdown->child_count(); ++index) {
			markdown->child_at(index)->set_access_hidden("true");
			markdown->child_at(index)->set_access_label("");
			markdown->child_at(index)->set_access_value("");
		}
		content = markdown.get();
		add_child(std::move(markdown));

		auto copy_button = std::make_unique<pulp::view::TextButton>("Copy");
		copy_button->set_style(pulp::view::TextButton::Style::ghost);
		copy_button->set_access_label("Copy " + role_text + " message");
		copy_button->on_click = [this] {
			content->set_selection(0, static_cast<int>(content->get_text().size()));
			content->copy_selection();
		};
		copy = copy_button.get();
		add_child(std::move(copy_button));
	}

	void layout_children() override {
		const auto b = local_bounds();
		role->set_visible(false);
		copy->set_visible(false);
		const float bubble_x = user ? b.width * 0.05f : 0.0f;
		const float inset = user ? 16.0f : 0.0f;
		content->set_bounds({bubble_x + inset, user ? 14.0f : 2.0f,
		                     std::max(0.0f, b.width - bubble_x - inset * 2.0f),
		                     std::max(0.0f, b.height - (user ? 28.0f : 8.0f) - kTranscriptGap)});
		content->layout_children();
	}

	void paint(pulp::canvas::Canvas& canvas) override {
		if (user) {
			canvas.set_fill_color(pulp::canvas::Color::rgba8(32, 32, 32));
			const float bubble_x = bounds().width * 0.05f;
			canvas.fill_rounded_rect(bubble_x, 0.0f, bounds().width - bubble_x,
			                         std::max(0.0f, bounds().height - kTranscriptGap), 8.0f);
		} else if (tool) {
			canvas.set_fill_color(pulp::canvas::Color::rgba8(24, 24, 24));
			canvas.fill_rounded_rect(0.0f, 0.0f, bounds().width,
			                         std::max(0.0f, bounds().height - kTranscriptGap), 8.0f);
		}
	}
};

std::filesystem::path state_path() {
	if (const char* override_path = std::getenv("PALOT_STATE_PATH")) return override_path;
	if (const char* home = std::getenv("HOME"))
		return std::filesystem::path(home) /
		       "Library/Application Support/Palot/burl-session.bin";
	return "burl-session.bin";
}

constexpr std::string_view kStateMagic = "PALOT02\n";
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

class PalotView::UiEventSink final
    : public OpenCodeEventSink,
      public std::enable_shared_from_this<PalotView::UiEventSink> {
public:
	explicit UiEventSink(PalotView* view) : view_(view) {}

	void post(OpenCodeEvent event) override {
		auto self = shared_from_this();
		pulp::events::MainThreadDispatcher::call_async(
		    [self = std::move(self), event = std::move(event)]() mutable {
			    std::scoped_lock lock(self->mutex_);
			    if (self->view_ && event.run_id == self->view_->process_.run_id())
				    self->view_->handle_event(std::move(event.type), std::move(event.value));
		    });
	}

	void detach() {
		std::scoped_lock lock(mutex_);
		view_ = nullptr;
	}
	void schedule_transcript_sync() {
		auto self = shared_from_this();
		pulp::events::MainThreadDispatcher::call_async_after([self = std::move(self)] {
			std::scoped_lock lock(self->mutex_);
			if (!self->view_) return;
			if (self->view_->transcript_updates_.flush()) self->view_->sync_imported_transcript();
		}, 16);
	}

private:
	std::mutex mutex_;
	PalotView* view_ = nullptr;
};

PalotView::PalotView(std::filesystem::path design_ir_path,
                     std::filesystem::path binding_manifest_path) {
	runtime_state_.project = std::filesystem::current_path().string();
	event_sink_ = std::make_shared<UiEventSink>(this);
	set_access_label("Palot chat workspace");
	auto imported_root = std::make_unique<ImportedRootHost>();
	imported_root->register_action("composer.agent-menu.toggle", [this](std::string_view) {
		composer_agent_menu_open_ = !composer_agent_menu_open_;
		request_repaint();
	});
	imported_root->register_action("composer.attachment.open", [this](std::string_view) {
		runtime_state_.attachments.clear();
		for (const auto& path : pulp::platform::FileDialog::open_files(
		         "Attach files to the Palot prompt", {}, runtime_state_.project))
			runtime_state_.attachments.push_back(make_local_file_attachment(path));
		request_repaint();
	});
	imported_root->register_action("composer.model-menu.toggle", [this](std::string_view) {
		composer_model_menu_open_ = !composer_model_menu_open_;
		request_repaint();
	});
	imported_root->register_action("composer.variant-menu.toggle", [this](std::string_view) {
		composer_variant_menu_open_ = !composer_variant_menu_open_;
		request_repaint();
	});
	imported_root->register_action("command.palette.open", [this](std::string_view) {
		command_palette_open_ = true;
		request_repaint();
	});
	imported_root->register_action("composer.copy", [this](std::string_view) {
		if (transcript_ && transcript_->child_count() != 0) request_repaint();
	});
	imported_root->register_action("display.mode.cycle", [this](std::string_view) {
		display_mode_ = display_mode_ == "default" ? "verbose" : "default";
		request_repaint();
	});
	for (const auto& [action, state_key] :
	     std::initializer_list<std::pair<std::string_view, std::string_view>>{
	         {"disclosure.thought.toggle", "disclosure.thought.open"},
	         {"disclosure.read.toggle", "disclosure.read.open"},
	         {"disclosure.edit.toggle", "disclosure.edit.open"}})
		imported_root->register_action(std::string(action), [this, action, state_key](std::string_view) {
			if (imported_root_) {
				const auto transition = imported_root_->active_action_state_transition(action);
				const bool imported_transition = transition && !transition->first.empty() &&
				                                 !transition->second.empty();
				if (!imported_transition)
					imported_root_->apply_application_state_transition(state_key, "cycle:closed,open");
			}
			request_repaint();
		});
	imported_root->register_action("external.open.menu.toggle", [this](std::string_view) {
		external_open_menu_open_ = !external_open_menu_open_;
		request_repaint();
	});
	imported_root->register_action("external.open.preferred", [this](std::string_view) {
		set_configuration_error("No portable external-editor launcher is available in this Burl build");
	});
	imported_root->register_action("navigation.settings", [this](std::string_view) {
		navigation_route_ = "/settings/general";
		server_menu_open_ = false;
		request_repaint();
	});
	imported_root->register_action("navigation.automations", [this](std::string_view) {
		navigation_route_ = "/automations";
		server_menu_open_ = false;
		request_repaint();
	});
	imported_root->register_action("navigation.session.close", [this](std::string_view) {
		navigation_route_ = "/";
		request_repaint();
	});
	imported_root->register_action("project.select", [this](std::string_view) { choose_project_folder(); });
	imported_root->register_action("project.open", [this](std::string_view payload) {
		std::string error;
		auto canonical_path = validate_project_directory(std::filesystem::path(payload), error);
		if (!canonical_path) {
			set_configuration_error(std::move(error));
			return;
		}
		runtime_state_.project = *canonical_path;
		project_->set_text(runtime_state_.project);
		sync_imported_projects();
		set_configuration_error("");
		runtime_state_.create_session = false;
		request_repaint();
	});
	imported_root->register_action("project.search.toggle", [this](std::string_view) {
		project_search_open_ = !project_search_open_;
		request_repaint();
	});
	imported_root->register_action("prompt.cancel", [this](std::string_view) {
		process_.cancel();
		status_ = "Cancelling…";
		request_repaint();
	});
	imported_root->register_action("prompt.retry", [this](std::string_view) {
		if (!last_prompt_.empty()) send_prompt(last_prompt_, true);
	});
	imported_root->register_action("prompt.send", [this](std::string_view payload) {
		auto prompt = std::string(payload);
		if (prompt.empty() && imported_root_)
			if (const auto visible = imported_root_->text_binding_value("composer.draft")) prompt = *visible;
		if (prompt.empty() && composer_) prompt = composer_->text();
		if (!prompt.empty()) {
			runtime_state_.composer_draft = prompt;
			send_prompt(runtime_state_.composer_draft);
		}
	});
	imported_root->register_action("session.create", [this](std::string_view) {
		runtime_state_.create_session = true;
		runtime_state_.session.clear();
		if (session_editor_) session_editor_->set_text("");
	});
	imported_root->register_action("session.open", [this](std::string_view payload) {
		runtime_state_.create_session = false;
		if (!payload.empty()) {
			runtime_state_.session = payload;
			if (session_editor_) session_editor_->set_text(runtime_state_.session);
		}
	});
	imported_root->register_action("message.scroll-to-turn", [this](std::string_view payload) {
		if (payload.empty() || !imported_root_ || !imported_root_->scroll_transcript_to_item(payload))
			set_configuration_error("The requested transcript turn is no longer available");
	});
	imported_root->register_action("session.fork-from-message", [this](std::string_view payload) {
		if (!process_.session_action("session.fork", std::string(payload), event_sink_))
			set_configuration_error("Unable to fork from the requested OpenCode message");
	});
	imported_root->register_action("session.undo-to-message", [this](std::string_view payload) {
		if (!process_.session_action("session.revert", std::string(payload), event_sink_))
			set_configuration_error("Unable to undo to the requested OpenCode message");
	});
	imported_root->register_action("server.menu.toggle", [this](std::string_view) {
		server_menu_open_ = !server_menu_open_;
		request_repaint();
	});
	imported_root->register_action("review.panel.toggle", [this](std::string_view) {
		review_panel_open_ = !review_panel_open_;
		presentation_state_ = review_panel_open_ ? "review.open" : "default";
		if (imported_root_)
			imported_root_->set_application_state("ui.presentation", presentation_state_);
		request_repaint();
	});
	imported_root->register_action("review.diff.open", [this](std::string_view) {
		review_panel_open_ = true;
		presentation_state_ = "review.open";
		if (imported_root_) {
			imported_root_->set_application_state("review.panel.open", "open");
			imported_root_->set_application_state("review.diff.open", "open");
			imported_root_->set_application_state("ui.presentation", presentation_state_);
		}
		request_repaint();
	});
	imported_root->register_action("ui.presentation.toggle", [this](std::string_view state) {
		presentation_state_ = presentation_state_ == state ? "default" : std::string(state);
		review_panel_open_ = presentation_state_ == "review.open";
		if (imported_root_)
			imported_root_->set_application_state("ui.presentation", presentation_state_);
		request_repaint();
	});
	imported_root->register_action("session.metrics.toggle", [this](std::string_view) {
		session_metrics_open_ = !session_metrics_open_;
		request_repaint();
	});
	imported_root->register_action("session.metrics.dismiss", [this](std::string_view) {
		session_metrics_open_ = false;
		request_repaint();
	});
	imported_root->register_action("settings.theme.select", [this](std::string_view payload) {
		if (payload != "light" && payload != "dark" && payload != "system") {
			set_configuration_error("Imported theme selection has an unsupported value");
			return;
		}
		theme_preference_ = payload;
		if (on_window_appearance_change) {
			const auto appearance = payload == "light"
				? pulp::view::WindowAppearance::light
				: payload == "dark" ? pulp::view::WindowAppearance::dark
				                    : pulp::view::WindowAppearance::system;
			on_window_appearance_change(appearance);
		}
		request_repaint();
	});
	imported_root->register_action("session.title.edit.begin", [this](std::string_view) {
		title_editing_ = true;
		request_repaint();
	});
	imported_root->register_action("sidebar.toggle", [this](std::string_view) {
		sidebar_open_ = !sidebar_open_;
		request_repaint();
	});
	imported_root->register_action("terminal.attach", [this](std::string_view) {
		const auto& directory = runtime_state_.project;
		const auto command = "opencode attach http://127.0.0.1:4101 --session " + runtime_state_.session +
		                     " --dir " + directory;
		if (!pulp::platform::Clipboard::set_text(command))
			set_configuration_error("Unable to copy the OpenCode attach command");
		request_repaint();
	});
	if (design_ir_path.empty())
		design_ir_path = palot_bundle_resource("import/main-chat.observed.design-ir.v1.json");
	if (binding_manifest_path.empty())
		binding_manifest_path = palot_bundle_resource("contracts/main-chat.application-bindings.v1.json");
	imported_root->load(design_ir_path, binding_manifest_path);
	imported_root_ = imported_root.get();
	add_child(std::move(imported_root));
	on_global_key = [this](const pulp::view::KeyEvent& event) {
		if (!event.is_down || !event.isMainModifier()) return false;
		if (event.key == pulp::view::KeyCode::b) return invoke_imported_action("sidebar.toggle");
		if (event.key == pulp::view::KeyCode::d && event.isShiftDown())
			return invoke_imported_action("review.panel.toggle");
		return false;
	};
	auto project = std::make_unique<pulp::view::TextEditor>();
	project->placeholder = "Project folder";
	project->set_access_role(AccessRole::group);
	project->set_access_label("Project folder");
	project->set_text(runtime_state_.project);
	project->on_change = [this](const std::string& value) { runtime_state_.project = value; };
	project_ = project.get();
	add_child(std::move(project));
	sync_imported_projects();

	auto choose_project = std::make_unique<PalotChromeButton>("+");
	choose_project->set_access_label("Choose project folder");
	choose_project->on_click = [this] { choose_project_folder(); };
	choose_project_ = choose_project.get();
	add_child(std::move(choose_project));

	auto session_editor = std::make_unique<pulp::view::TextEditor>();
	session_editor->placeholder = "Session ID";
	session_editor->set_access_role(AccessRole::group);
	session_editor->set_access_label("OpenCode session ID");
	session_editor->set_background_color(pulp::canvas::Color::rgba8(13, 13, 13));
	session_editor->set_border(pulp::canvas::Color::rgba8(13, 13, 13), 0.0f, 6.0f);
	session_editor->set_font_size(12.0f);
	session_editor->on_change = [this](const std::string& value) { runtime_state_.session = value; };
	session_editor_ = session_editor.get();
	add_child(std::move(session_editor));

	auto new_session = std::make_unique<PalotChromeButton>("+  New Session");
	new_session->set_access_label("Create a new OpenCode session");
	new_session->on_click = [this] {
		runtime_state_.create_session = true;
		runtime_state_.session.clear();
		session_editor_->set_text("");
		set_configuration_error("");
		request_repaint();
	};
	new_session_ = new_session.get();
	add_child(std::move(new_session));

	auto open_session = std::make_unique<PalotChromeButton>("Open");
	open_session->set_access_label("Open the entered OpenCode session");
	open_session->on_click = [this] {
		runtime_state_.create_session = false;
		set_configuration_error("");
		request_repaint();
	};
	open_session_ = open_session.get();
	add_child(std::move(open_session));

	auto provider = std::make_unique<pulp::view::TextEditor>();
	provider->placeholder = "Provider";
	provider->set_access_role(AccessRole::group);
	provider->set_access_label("OpenCode model provider");
	provider->set_text(runtime_state_.provider);
	provider->on_change = [this](const std::string& value) { runtime_state_.provider = value; };
	provider->set_background_color(pulp::canvas::Color::rgba8(29, 29, 29));
	provider->set_border(pulp::canvas::Color::rgba8(29, 29, 29), 0.0f, 4.0f);
	provider->set_font_size(11.0f);
	provider_ = provider.get();
	add_child(std::move(provider));

	auto model = std::make_unique<pulp::view::TextEditor>();
	model->placeholder = "Model";
	model->set_access_role(AccessRole::group);
	model->set_access_label("OpenCode model ID");
	model->set_text(runtime_state_.model);
	model->on_change = [this](const std::string& value) { runtime_state_.model = value; };
	model->set_background_color(pulp::canvas::Color::rgba8(29, 29, 29));
	model->set_border(pulp::canvas::Color::rgba8(29, 29, 29), 0.0f, 4.0f);
	model->set_font_size(11.0f);
	model_ = model.get();
	add_child(std::move(model));

	auto composer = std::make_unique<PalotComposer>();
	composer->placeholder = "Send a follow-up message…";
	composer->set_background_color(pulp::canvas::Color::rgba8(29, 29, 29));
	composer->set_border(pulp::canvas::Color::rgba8(52, 52, 52), 1.0f, 12.0f);
	composer->set_font_size(15.0f);
	composer->multi_line = true;
	composer->multi_line_return_behavior =
		pulp::view::TextEditor::MultiLineReturnBehavior::commit;
	composer->set_access_role(AccessRole::group);
	composer->set_access_label("Message composer");
	composer->on_change = [this](const std::string& value) { runtime_state_.composer_draft = value; };
	composer->on_return = [this](const std::string& text) {
		if (!text.empty()) send_prompt(text);
		else if (!last_prompt_.empty()) send_prompt(last_prompt_, true);
	};
	composer->on_escape = [this] {
		process_.cancel();
		status_ = "Cancelling…";
		request_repaint();
	};
	composer_ = composer.get();
	add_child(std::move(composer));

	auto send = std::make_unique<PalotChromeButton>("↑");
	send->set_access_label("Send message");
	send->on_click = [this] {
		if (!runtime_state_.composer_draft.empty()) send_prompt(runtime_state_.composer_draft);
		else if (!last_prompt_.empty()) send_prompt(last_prompt_, true);
	};
	send_ = send.get();
	add_child(std::move(send));

	auto cancel = std::make_unique<PalotChromeButton>("■");
	cancel->set_access_label("Cancel OpenCode response");
	cancel->on_click = [this] {
		process_.cancel();
		status_ = "Cancelling…";
		request_repaint();
	};
	cancel_ = cancel.get();
	add_child(std::move(cancel));

	auto transcript = std::make_unique<pulp::view::VirtualList>();
	transcript->set_access_label("Conversation transcript");
	transcript->set_selection_mode(pulp::view::VirtualList::SelectionMode::none);
	transcript->set_auto_follow(true);
	transcript->set_overscan(4);
	transcript->set_row_height(96.0f);
	transcript->set_row_factory([](std::size_t) {
		return std::make_unique<MessageRow>();
	});
	transcript->set_row_binder([this](pulp::view::View& row, std::size_t index) {
		if (index >= messages_.size()) return;
		static_cast<MessageRow&>(row).bind(messages_[index].role, messages_[index].text);
	});
	transcript_ = transcript.get();
	add_child(std::move(transcript));
	restore();
	sync_imported_projects();
	pulp::platform::FileDialog::install_native_backend();
	transcript_->set_row_count(messages_.size());
	for (std::size_t index = 0; index < messages_.size(); ++index)
		transcript_->set_row_height(index, message_height(index));
}

PalotView::~PalotView() {
	event_sink_->detach();
	process_.cancel();
	persist();
}

bool PalotView::source_observed_primary_tree() const noexcept {
	return imported_root_ && imported_root_->source_observed_primary_tree();
}

const std::vector<std::string>& PalotView::unattached_required_actions() const noexcept {
	static const std::vector<std::string> empty;
	return imported_root_ ? imported_root_->unattached_required_actions() : empty;
}

void PalotView::layout_children() {
	const auto b = local_bounds();
	imported_root_->set_bounds(b);
	imported_root_->layout_children();
	const float sidebar_width = b.width < 700.0f ? 0.0f : kSidebarWidth;
	project_->set_visible(false);
	const bool sidebar_visible = false;
	new_session_->set_visible(sidebar_visible);
	open_session_->set_visible(sidebar_visible);
	choose_project_->set_visible(sidebar_visible);
	session_editor_->set_visible(sidebar_visible);
	new_session_->set_bounds({12.0f, 42.0f, 156.0f, 34.0f});
	open_session_->set_bounds({210.0f, 202.0f, 54.0f, 28.0f});
	session_editor_->set_bounds({16.0f, 202.0f, 188.0f, 28.0f});
	choose_project_->set_bounds({238.0f, 476.0f, 30.0f, 30.0f});
	const float available = std::max(0.0f, b.width - sidebar_width - 32.0f);
	const float content_width = std::min(kContentMaxWidth, available);
	const float content_x = sidebar_width + std::max(16.0f,
		(b.width - sidebar_width - content_width) * 0.5f);
	const float composer_y = b.height - kComposerHeight - 53.0f;
	composer_->set_bounds({content_x, composer_y, std::max(0.0f, content_width), kComposerHeight});
	provider_->set_visible(false);
	model_->set_visible(false);
	composer_->set_visible(false);
	send_->set_visible(false);
	cancel_->set_visible(false);
	transcript_->set_visible(false);
	if (sidebar_visible) {
		provider_->set_bounds({16.0f, 620.0f, 112.0f, 24.0f});
		model_->set_bounds({16.0f, 650.0f, 190.0f, 24.0f});
	} else {
		provider_->set_bounds({content_x, composer_y - 28.0f, 112.0f, 24.0f});
		model_->set_bounds({content_x + 120.0f, composer_y - 28.0f, 190.0f, 24.0f});
	}
	send_->set_bounds({content_x + content_width - 44.0f, composer_y + 68.0f, 32.0f, 32.0f});
	cancel_->set_bounds({content_x + content_width - 82.0f, composer_y + 68.0f, 32.0f, 32.0f});
	transcript_->set_bounds({content_x, kTranscriptTop, content_width,
	                         std::max(0.0f, composer_y - kTranscriptTop - 20.0f)});
	transcript_->layout_children();
}

void PalotView::start_demo(std::string project, std::string prompt) {
	runtime_state_.project = std::move(project);
	project_->set_text(runtime_state_.project);
	sync_imported_projects();
	send_prompt(prompt);
}

bool PalotView::invoke_imported_action(std::string_view action) {
	return imported_root_ && imported_root_->invoke_bound_action(action);
}

void PalotView::flush_demo_projection() {
	if (transcript_updates_.flush()) sync_imported_transcript();
}

void PalotView::sync_imported_projects() {
	if (!imported_root_ || runtime_state_.project.empty()) return;
	const auto directory = std::filesystem::path(runtime_state_.project).lexically_normal();
	imported_root_->set_projects({{
		.key = directory.string(),
		.template_id = "project",
		.values = {{"id", directory.string()}, {"project.name", directory.filename().string()},
		           {"directory", directory.string()}, {"status", "active"}},
	}});
}

void PalotView::load_visual_parity_fixture() {
	transcript_->set_auto_follow(false);
	imported_root_->set_transcript_auto_follow(false);
	imported_root_->set_projects({
		{.key = "/fixture/palot", .template_id = "project",
		 .values = {{"id", "/fixture/palot"}, {"project.name", "palot"},
		            {"directory", "/fixture/palot"}, {"status", "active"}}},
		{.key = "/fixture/acme-api", .template_id = "project",
		 .values = {{"id", "/fixture/acme-api"}, {"project.name", "acme-api"},
		            {"directory", "/fixture/acme-api"}, {"status", "idle"}}},
		{.key = "/fixture/landing-page", .template_id = "project",
		 .values = {{"id", "/fixture/landing-page"}, {"project.name", "landing-page"},
		            {"directory", "/fixture/landing-page"}, {"status", "idle"}}},
	});
	messages_.clear();
	send_->set_visible(false);
	cancel_->set_visible(false);
	append_message("You",
	               "Add a dark mode toggle to the application settings page. It should persist the user's "
	               "preference to localStorage and apply the theme immediately without a page reload.", false,
	               "fixture-user-1", "user");
	message_identities_["fixture-assistant-1"] = {"assistant", "fixture-user-1"};
	upsert_reasoning(R"({"id":"fixture-reasoning-1","messageID":"fixture-assistant-1","type":"reasoning","text":"Inspecting the settings implementation.","state":{"time":{"start":0,"end":2000}}})");
	upsert_tool(R"({"id":"fixture-read-1","type":"tool","tool":"read","state":{"status":"running","input":{"path":"components/settings.tsx"},"time":{"start":0}}})", false);
	upsert_tool(R"({"id":"fixture-read-1","type":"tool","tool":"read","state":{"status":"completed","input":{"path":"components/settings.tsx"},"time":{"start":0,"end":3000}}})", false);
	upsert_tool(R"({"id":"fixture-edit-1","type":"tool","tool":"edit","state":{"status":"completed","input":{"path":"lib/theme.ts"},"time":{"start":0,"end":3000}}})", false);
	upsert_tool(R"({"id":"fixture-edit-2","type":"tool","tool":"edit","state":{"status":"completed","input":{"path":"components/settings.tsx"},"time":{"start":0,"end":3000}}})", false);
	append_message("OpenCode",
	               "I've added the dark mode toggle to the settings page. Here's what I did:\n\n"
	               "**Created `src/lib/theme.ts`** - Pure functions to resolve, apply, and persist the "
	               "theme. Supports `light`, `dark`, and `system` (which reads `prefers-color-scheme`).\n\n"
	               "**Updated `src/components/settings.tsx`** - Added a three-way toggle group so users "
	               "can pick light, dark, or match their OS.\n\n"
	               "The theme applies instantly via `data-theme` on the root element, no reload needed.\n\n"
	               "anthropic.claude-opus-4-6  ·  4m 58s  ·  $0.01", false,
	               "fixture-assistant-1", "assistant", "fixture-user-1");
	append_message("You",
	               "Great! Now also add system preference detection so it defaults to the user's OS "
	               "setting, and add a transition animation when switching themes.", false,
	               "fixture-user-2", "user");
	message_identities_["fixture-assistant-2"] = {"assistant", "fixture-user-2"};
	upsert_reasoning(R"({"id":"fixture-reasoning-2","messageID":"fixture-assistant-2","type":"reasoning","text":"Making edits...","state":{"time":{"start":0,"end":2000}}})");
	upsert_tool(R"({"id":"fixture-edit-running","type":"tool","tool":"edit","state":{"status":"running","input":{"path":"src/lib/theme.ts"}}})", false);
	transcript_->set_scroll_y(54.0f);
	imported_root_->set_transcript_scroll_y(0.0f);
	status_ = "Streaming";
	request_repaint();
	if (on_demo_complete) on_demo_complete();
}

void PalotView::paint(pulp::canvas::Canvas& canvas) {
	(void)canvas;
}

float PalotView::message_height(std::size_t index) const {
	if (index >= messages_.size()) return 96.0f;
	const auto& text = messages_[index].text;
	const float sidebar_width = local_bounds().width < 700.0f ? 0.0f : kSidebarWidth;
	const float width = std::min(kContentMaxWidth,
	                             std::max(240.0f, local_bounds().width - sidebar_width - 32.0f));
	const auto characters_per_line = std::max<std::size_t>(24, static_cast<std::size_t>(width / 8.0f));
	std::size_t lines = 1;
	std::size_t column = 0;
	for (const char character : text) {
		if (character == '\n') {
			++lines;
			column = 0;
		} else if (++column >= characters_per_line) {
			++lines;
			column = 0;
		}
	}
	const float line_height = 20.0f;
	return std::clamp(20.0f + static_cast<float>(lines) * line_height + kTranscriptGap,
	                  74.0f, 640.0f);
}

void PalotView::append_message(std::string role, std::string text, bool announce,
	                           std::string message_id, std::string message_role,
	                           std::string parent_message_id) {
	const std::string announcement = role + ": " + text;
	const auto key = message_id.empty() ? role + "-" + std::to_string(messages_.size()) : message_id;
	messages_.push_back({.key = key, .role = std::move(role), .text = std::move(text),
	                     .message_role = std::move(message_role),
	                     .message_id = std::move(message_id),
	                     .parent_message_id = std::move(parent_message_id)});
	const auto index = messages_.size() - 1;
	transcript_->set_row_count(messages_.size());
	transcript_->set_row_height(index, message_height(index));
	transcript_->refresh_rows();
	sync_imported_transcript();
	if (announce)
		pulp::view::announce_accessibility(announcement,
			pulp::view::AnnouncementPriority::Polite);
}

void PalotView::upsert_reasoning(std::string payload) {
	const auto part = nlohmann::json::parse(payload);
	if (!part.is_object() || part.value("type", "") != "reasoning")
		throw std::invalid_argument("OpenCode reasoning event is not a reasoning part");
	const auto id = first_string(part, {"id"});
	const auto message_id = first_string(part, {"messageID", "messageId"});
	if (id.empty()) throw std::invalid_argument("OpenCode reasoning part has no stable identity");
	std::string label = "Thought";
	const auto& state = part.contains("state") ? part.at("state") : nlohmann::json::object();
	const auto& time = state.is_object() && state.contains("time") ? state.at("time") :
	                   part.contains("time") ? part.at("time") : nlohmann::json::object();
	if (time.is_object() && time.contains("start") && time.contains("end") &&
	    time.at("start").is_number() && time.at("end").is_number()) {
		auto seconds = time.at("end").get<double>() - time.at("start").get<double>();
		if (seconds > 100.0) seconds /= 1000.0;
		label += " for " + std::to_string(std::max(0L, std::lround(seconds))) + " seconds";
	}
	auto found = std::ranges::find(messages_, id, &TranscriptEntry::key);
	const auto values = std::unordered_map<std::string, std::string>{
		{"reasoning.label", label}, {"reasoning.text", first_string(part, {"text"})}};
	if (found == messages_.end()) {
		messages_.push_back({.key = id, .role = "Reasoning", .text = std::move(payload),
		                     .template_id = "reasoning", .message_role = "part",
		                     .message_id = message_id, .values = values});
	} else {
		found->text = std::move(payload);
		found->template_id = "reasoning";
		found->values = values;
		found->message_role = "part";
		found->message_id = message_id;
	}
	transcript_->set_row_count(messages_.size());
	transcript_->refresh_rows();
	sync_imported_transcript();
}

void PalotView::upsert_tool(std::string payload, bool announce) {
	const auto part = nlohmann::json::parse(payload);
	const auto message_id = first_string(part, {"messageID", "messageId"});
	const auto projected = project_tool_part(payload);
	auto found = std::ranges::find(messages_, projected.id, &TranscriptEntry::key);
	const auto values = std::unordered_map<std::string, std::string>{
		{"tool.label", projected.label}, {"tool.subject", projected.subject},
		{"tool.duration", projected.duration}, {"tool.status", projected.status},
	};
	if (found == messages_.end()) {
		messages_.push_back({.key = projected.id, .role = "Tool", .text = std::move(payload),
		                     .template_id = projected.template_id, .message_role = "part",
		                     .message_id = message_id, .values = values});
	} else {
		found->text = std::move(payload);
		found->template_id = projected.template_id;
		found->values = values;
		found->message_role = "part";
		found->message_id = message_id;
	}
	transcript_->set_row_count(messages_.size());
	const auto index = static_cast<std::size_t>(std::distance(messages_.begin(),
		std::ranges::find(messages_, projected.id, &TranscriptEntry::key)));
	transcript_->set_row_height(index, message_height(index));
	transcript_->refresh_rows();
	sync_imported_transcript();
	if (announce)
		pulp::view::announce_accessibility(projected.label + " " + projected.subject,
		                                    pulp::view::AnnouncementPriority::Polite);
}

std::vector<pulp::view::ImportedListItem> PalotView::transcript_projection() const {
	std::vector<TranscriptProjectionRow> projected;
	projected.reserve(messages_.size());
	for (const auto& message : messages_) {
		auto parent = message.parent_message_id;
		if (parent.empty()) {
			if (const auto identity = message_identities_.find(message.message_id);
			    identity != message_identities_.end()) parent = identity->second.parent_message_id;
		}
		projected.push_back({.key = message.key,
		                     .template_id = !message.template_id.empty() ? message.template_id :
		                                    message.role == "You" ? "user" : "assistant",
		                     .message_role = message.message_role,
		                     .message_id = message.message_id,
		                     .parent_message_id = std::move(parent),
		                     .values = !message.values.empty() ? message.values :
		                               std::unordered_map<std::string, std::string>{{"message.text", message.text}}});
	}
	projected = project_transcript_turns(std::move(projected));
	std::vector<pulp::view::ImportedListItem> rows;
	rows.reserve(projected.size());
	for (auto& row : projected)
		rows.push_back({std::move(row.key), std::move(row.template_id), std::move(row.values)});
	return rows;
}

void PalotView::sync_imported_transcript() {
	if (!imported_root_) return;
	imported_root_->set_transcript(transcript_projection());
}

void PalotView::schedule_imported_transcript_sync() {
	if (!transcript_updates_.request()) return;
	event_sink_->schedule_transcript_sync();
}

void PalotView::send_prompt(const std::string& prompt, bool retry) {
	if (prompt.empty() || process_.running()) return;
	std::string validation_error;
	auto configuration = validate_project_configuration(
	    {.project_path = runtime_state_.project,
	     .provider_id = runtime_state_.provider,
	     .model_id = runtime_state_.model,
	     .create_session = runtime_state_.create_session,
	     .session_id = runtime_state_.session},
	    validation_error);
	if (!configuration) {
		set_configuration_error(std::move(validation_error));
		return;
	}
	set_configuration_error("");
	runtime_state_.project = configuration->canonical_project_path;
	project_->set_text(runtime_state_.project);
	const std::string prompt_value = prompt;
	const auto request = make_opencode_request(runtime_state_, configuration->canonical_project_path,
	                                          prompt_value, retry ? last_request_id_ : "");
	if (!process_.start(request,
	               event_sink_)) {
		set_configuration_error("Unable to start the OpenCode sidecar.");
		return;
	}
	last_prompt_ = prompt_value;
	append_message("You", prompt_value, false);
	runtime_state_.composer_draft.clear();
	runtime_state_.attachments.clear();
	if (imported_root_) imported_root_->set_text_binding_value("composer.draft", "");
	composer_->set_text("");
	status_ = "Streaming";
	request_repaint();
	last_request_id_ = std::to_string(process_.run_id()) + "-prompt";
}

void PalotView::handle_event(std::string type, std::string value) {
	if (type == "session") {
		runtime_state_.session = std::move(value);
		session_editor_->set_text(runtime_state_.session);
		runtime_state_.create_session = false;
	} else if (type == "message") {
		try {
			const auto info = nlohmann::json::parse(value);
			const auto id = first_string(info, {"id"});
			const auto role = first_string(info, {"role"});
			const auto parent = first_string(info, {"parentID", "parentId"});
			if (id.empty() || (role != "user" && role != "assistant"))
				throw std::invalid_argument("message identity is incomplete");
			message_identities_[id] = {role, parent};
			if (role == "user") {
				auto pending = std::ranges::find_if(messages_, [](const auto& entry) {
					return entry.role == "You" && entry.message_id.empty();
				});
				if (pending != messages_.end()) {
					pending->key = id;
					pending->message_id = id;
					pending->message_role = role;
				}
			}
			schedule_imported_transcript_sync();
		} catch (const std::exception& error) {
			set_configuration_error(std::string("Invalid OpenCode message identity: ") + error.what());
		}
	} else if (type == "session-action") {
		try {
			const auto result = nlohmann::json::parse(value);
			if (result.value("action", "") == "session.fork") {
				runtime_state_.session = result.at("value").value("id", "");
				if (runtime_state_.session.empty())
					throw std::invalid_argument("fork response has no session id");
				session_editor_->set_text(runtime_state_.session);
			}
			set_configuration_error("");
		} catch (const std::exception& error) {
			set_configuration_error(std::string("Invalid OpenCode session action response: ") + error.what());
		}
	} else if (type == "text" && !value.empty()) {
		if (on_stream_delta) on_stream_delta();
		try {
			const auto delta = nlohmann::json::parse(value);
			const auto message_id = first_string(delta, {"messageID", "messageId"});
			if (message_id.empty()) throw std::invalid_argument("text delta has no message identity");
			auto entry = std::ranges::find(messages_, message_id, &TranscriptEntry::message_id);
			if (entry != messages_.end() && entry->role == "OpenCode") {
				entry->text += delta.value("delta", "");
				const auto index = static_cast<std::size_t>(std::distance(messages_.begin(), entry));
				transcript_->set_row_height(index, message_height(index));
				transcript_->refresh_rows();
				schedule_imported_transcript_sync();
			} else {
				const auto identity = message_identities_.find(message_id);
				const auto parent = identity == message_identities_.end() ? std::string{} :
				                    identity->second.parent_message_id;
				append_message("OpenCode", delta.value("delta", ""), false, message_id,
				               "assistant", parent);
			}
		} catch (const std::exception& error) {
			set_configuration_error(std::string("Invalid OpenCode text event: ") + error.what());
		}
	} else if (type == "reasoning") {
		try {
			upsert_reasoning(std::move(value));
		} catch (const std::exception& error) {
			set_configuration_error(std::string("Invalid OpenCode reasoning event: ") + error.what());
		}
	} else if (type == "tool") {
		try {
			upsert_tool(std::move(value), true);
		} catch (const std::exception& error) {
			set_configuration_error(std::string("Invalid OpenCode tool event: ") + error.what());
		}
	} else if (type == "done") {
		status_ = "Ready";
		if (!messages_.empty() && messages_.back().role == "OpenCode")
			pulp::view::announce_accessibility(
			    "OpenCode: " + accessibility_summary(messages_.back().text),
			    pulp::view::AnnouncementPriority::Polite);
		persist();
		if (on_demo_complete) on_demo_complete();
	} else if (type == "error") {
		status_ = value == "cancelled" ? "Cancelled" : "Error: " + value.substr(0, 80);
		auto callback = std::move(on_demo_error);
		if (callback) callback();
	}
	request_repaint();
}

void PalotView::choose_project_folder() {
	auto selected = pulp::platform::FileDialog::choose_folder(
	    "Choose a Palot project", runtime_state_.project);
	if (!selected) return;
	std::string error;
	auto canonical_path = validate_project_directory(*selected, error);
	if (!canonical_path) {
		set_configuration_error(std::move(error));
		return;
	}
	runtime_state_.project = *canonical_path;
	project_->set_text(runtime_state_.project);
	set_configuration_error("");
	request_repaint();
}

void PalotView::set_configuration_error(std::string error) {
	configuration_error_ = std::move(error);
	set_access_value(configuration_error_.empty() ? "Configuration valid" : configuration_error_);
	if (!configuration_error_.empty())
		pulp::view::announce_accessibility(configuration_error_,
		    pulp::view::AnnouncementPriority::Assertive);
	request_repaint();
}

void PalotView::persist() const {
	const auto path = state_path();
	std::error_code error;
	std::filesystem::create_directories(path.parent_path(), error);
	if (error) return;
	std::vector<std::uint8_t> bytes(kStateMagic.begin(), kStateMagic.end());
	append_string(bytes, runtime_state_.session);
	append_string(bytes, runtime_state_.project);
	append_string(bytes, runtime_state_.provider);
	append_string(bytes, runtime_state_.model);
	const auto count = static_cast<std::uint32_t>(
		std::min<std::size_t>(messages_.size(), kMaxMessages));
	for (int shift = 0; shift < 32; shift += 8)
		bytes.push_back(static_cast<std::uint8_t>((count >> shift) & 0xff));
	for (std::size_t index = messages_.size() - count; index < messages_.size(); ++index) {
		append_string(bytes, messages_[index].role);
		append_string(bytes, messages_[index].text);
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
	std::string provider;
	std::string model;
	if (!read_string(bytes, cursor, runtime_state_.session) || !read_string(bytes, cursor, project) ||
	    !read_string(bytes, cursor, provider) || !read_string(bytes, cursor, model) ||
	    cursor + 4 > bytes.size()) return;
	if (!project.empty()) runtime_state_.project = project;
	if (!provider.empty()) runtime_state_.provider = provider;
	if (!model.empty()) runtime_state_.model = model;
	project_->set_text(runtime_state_.project);
	provider_->set_text(runtime_state_.provider);
	model_->set_text(runtime_state_.model);
	if (!runtime_state_.session.empty()) {
		session_editor_->set_text(runtime_state_.session);
		runtime_state_.create_session = false;
	}
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
		const auto key = role + "-restored-" + std::to_string(messages_.size());
		messages_.push_back({.key = key, .role = std::move(role), .text = std::move(text)});
		if (messages_.back().role == "Tool") {
			try {
				const auto tool = project_tool_part(messages_.back().text);
				messages_.back().key = tool.id;
				messages_.back().template_id = tool.template_id;
				messages_.back().values = {{"tool.label", tool.label}, {"tool.subject", tool.subject},
				                           {"tool.duration", tool.duration}, {"tool.status", tool.status}};
			} catch (const std::exception&) {
				messages_.pop_back();
				continue;
			}
		}
		if (messages_.back().role == "You") last_prompt_ = messages_.back().text;
	}
}
