#include "imported_root_host.hpp"

#include <pulp/view/buttons.hpp>
#include <pulp/view/text_editor.hpp>

#include <algorithm>
#include <fstream>
#include <sstream>
#include <stdexcept>
#include <unordered_set>

#if defined(__APPLE__)
#include <mach-o/dyld.h>
#endif

namespace {

std::string read_text(const std::filesystem::path& path) {
	std::ifstream input(path, std::ios::binary);
	if (!input) throw std::runtime_error("required imported-root resource is unreadable: " + path.string());
	std::ostringstream bytes;
	bytes << input.rdbuf();
	return bytes.str();
}

bool effectively_visible(const pulp::view::View& view) {
	for (auto* current = &view; current; current = current->parent())
		if (!current->visible()) return false;
	return true;
}

bool has_error(const std::vector<pulp::view::ImportDiagnostic>& diagnostics) {
	return std::ranges::any_of(diagnostics, [](const auto& diagnostic) {
		return diagnostic.severity == pulp::view::ImportDiagnosticSeverity::error;
	});
}

std::string error_diagnostics(const std::vector<pulp::view::ImportDiagnostic>& diagnostics) {
	std::string message;
	for (const auto& diagnostic : diagnostics) {
		if (diagnostic.severity != pulp::view::ImportDiagnosticSeverity::error) continue;
		message += " [" + diagnostic.code + " " + diagnostic.path;
		if (diagnostic.property) message += " property=" + *diagnostic.property;
		message += ": " + diagnostic.message + "]";
	}
	return message;
}

}  // namespace

class ImportedRootHost::BindingContext final : public pulp::view::NativeImportBindingContext {
public:
	explicit BindingContext(ImportedRootHost& owner,
	                       std::unordered_map<std::string, ActionEndpoint>& endpoints,
	                       const pulp::view::ApplicationBindingManifest& manifest,
	                       const pulp::view::DesignIR& ir,
	                       pulp::view::ImportedRepeatedList*& transcript,
	                       pulp::view::ImportedRepeatedList*& projects)
		: owner_(owner), endpoints_(endpoints), manifest_(manifest), ir_(ir),
		  transcript_(transcript), projects_(projects) {}

	void bind_host_action(pulp::view::TextButton& button,
	                      const pulp::view::NativeImportHostActionDescriptor& descriptor) override {
		attach(button, descriptor);
	}

	void bind_application_action(pulp::view::View& view,
	                             const pulp::view::NativeImportHostActionDescriptor& descriptor) override {
		attach(view, descriptor);
	}
	void bind_text_editor(pulp::view::TextEditor& editor,
	                      const pulp::view::NativeImportTextBindingDescriptor& descriptor) override {
		if (descriptor.value_key.empty()) return;
		text_bindings_[std::string(descriptor.value_key)].push_back(&editor);
		if (descriptor.value_key != "composer.draft") return;
		editor.multi_line = true;
		editor.multi_line_return_behavior = pulp::view::TextEditor::MultiLineReturnBehavior::commit;
		editor.on_return = [this](const std::string& text) {
			invoke(text.empty() ? "prompt.retry" : "prompt.send", text);
		};
		editor.on_escape = [this] { invoke("prompt.cancel", ""); };
		attached_.insert("prompt.send");
		attached_.insert("prompt.retry");
		attached_.insert("prompt.cancel");
	}
	void bind_imported_collection(pulp::view::View& host,
	                             const pulp::view::NativeImportCollectionDescriptor& descriptor) override {
		(void)host;
		if (descriptor.collection_key != "messages" && descriptor.collection_key != "projects") return;
		if ((descriptor.collection_key == "messages" && transcript_ != nullptr) ||
		    (descriptor.collection_key == "projects" && projects_ != nullptr))
			throw std::runtime_error("duplicate imported collection slot");
		auto templates = pulp::view::extract_imported_collection_templates(ir_.root);
		if (!templates.contains("user") || !templates.contains("assistant") ||
		    !templates.contains("reasoning") || !templates.contains("tool.read") ||
		    !templates.contains("tool.edit") || !templates.contains("project"))
			throw std::runtime_error("source collection templates are incomplete");
		if (descriptor.collection_key == "messages") {
			std::unordered_map<std::string, pulp::view::IRNode> transcript_templates;
			for (const auto* id : {"user", "assistant", "reasoning", "tool.read", "tool.edit"})
				transcript_templates.emplace(id, templates.at(id));
			auto list = std::make_unique<pulp::view::ImportedRepeatedList>(
				std::move(transcript_templates), ir_.asset_manifest, this);
			action_views_.erase("composer.copy");
			action_view_instance_ids_.erase("composer.copy");
			payloads_.erase("composer.copy");
			attached_.insert("composer.copy");
			transcript_ = list.get();
			transcript_->flex().flex_grow = 1.0f;
			if (!pulp::view::mount_imported_collection_items(descriptor, std::move(list)))
				throw std::runtime_error("transcript collection mount was rejected");
			return;
		}
		auto list = std::make_unique<pulp::view::ImportedRepeatedList>(
			std::unordered_map<std::string, pulp::view::IRNode>{{"project", templates.at("project")}},
			ir_.asset_manifest, this);
		action_views_.erase("project.open");
		action_view_instance_ids_.erase("project.open");
		payloads_.erase("project.open");
		state_transitions_.erase("project.open");
		attached_.insert("project.open");
		projects_ = list.get();
		projects_->set_auto_follow(false);
		projects_->flex().flex_grow = 1.0f;
		if (!pulp::view::mount_imported_collection_items(descriptor, std::move(list)))
			throw std::runtime_error("project collection mount was rejected");
	}
	void unbind_imported_view(pulp::view::View& view) override {
		for (auto& [id, bound] : action_views_) {
			for (std::size_t index = bound.size(); index-- > 0;) {
				auto identities = action_view_instance_ids_.find(id);
				if (bound[index] != &view || identities == action_view_instance_ids_.end() ||
				    index >= identities->second.size() ||
				    identities->second[index] != view.import_binding_instance_id()) continue;
				bound.erase(bound.begin() + static_cast<std::ptrdiff_t>(index));
				identities->second.erase(identities->second.begin() + static_cast<std::ptrdiff_t>(index));
				auto payload = payloads_.find(id);
				if (payload != payloads_.end() && index < payload->second.size())
					payload->second.erase(payload->second.begin() + static_cast<std::ptrdiff_t>(index));
				auto state = state_transitions_.find(id);
				if (state != state_transitions_.end() && index < state->second.size())
					state->second.erase(state->second.begin() + static_cast<std::ptrdiff_t>(index));
			}
		}
		for (auto& [id, bound] : unattached_action_views_)
			std::erase(bound, &view);
	}
	void install_pending_collection() {
		if (transcript_ == nullptr || projects_ == nullptr)
			throw std::runtime_error("required imported collection slot was not bound");
	}

	[[nodiscard]] const std::unordered_set<std::string>& attached() const noexcept { return attached_; }
	[[nodiscard]] const std::unordered_set<std::string>& encountered_actions() const noexcept {
		return encountered_actions_;
	}
	[[nodiscard]] pulp::view::TextEditor* text_binding(std::string_view value_key) const noexcept {
		const auto found = text_bindings_.find(std::string(value_key));
		if (found == text_bindings_.end()) return nullptr;
		for (auto* editor : found->second)
			if (editor && effectively_visible(*editor)) return editor;
		return found->second.empty() ? nullptr : found->second.front();
	}
	[[nodiscard]] pulp::view::TextEditor* composer() const noexcept {
		return text_binding("composer.draft");
	}
	[[nodiscard]] std::optional<std::size_t> active_action_index(std::string_view id) const {
		const auto found = action_views_.find(std::string(id));
		if (found == action_views_.end() || found->second.empty()) return std::nullopt;
		for (std::size_t index = 0; index < found->second.size(); ++index)
			if (found->second[index] && effectively_visible(*found->second[index])) return index;
		return 0;
	}
	[[nodiscard]] std::optional<std::string> action_payload(std::string_view id) const {
		const auto key = std::string(id);
		const auto index = active_action_index(id);
		const auto found = payloads_.find(key);
		if (!index || found == payloads_.end() || *index >= found->second.size()) return std::nullopt;
		return pulp::view::resolve_imported_action_payload(
			found->second[*index], owner_.runtime_context_lookup_);
	}
	bool invoke_bound(std::string_view id) {
		const auto key = std::string(id);
		if (!attached_.contains(key)) return false;
		const auto index = active_action_index(id);
		if (!index) {
			const bool composer_action = id == "prompt.send" || id == "prompt.retry" ||
			                             id == "prompt.cancel";
			return composer_action && composer() != nullptr && invoke_with_state(id, "", "", "");
		}
		const auto payload = action_payload(id);
		if (!payload) return false;
		std::string state_key;
		std::string state_transition;
		if (const auto state = state_transitions_.find(key);
		    index && state != state_transitions_.end() && *index < state->second.size()) {
			state_key = state->second[*index].first;
			state_transition = state->second[*index].second;
		}
		return invoke_with_state(id, *payload, state_key, state_transition);
	}
	std::vector<pulp::view::View*> bound_views(std::string_view id) const {
		std::vector<pulp::view::View*> result;
		if (const auto found = action_views_.find(std::string(id)); found != action_views_.end())
			for (auto* view : found->second)
				if (view && effectively_visible(*view)) result.push_back(view);
		if (id == "prompt.send" || id == "prompt.retry" || id == "prompt.cancel")
			if (auto* active = composer()) result.push_back(active);
		return result;
	}
	std::vector<pulp::view::View*> unattached_views(std::string_view id) const {
		std::vector<pulp::view::View*> result;
		if (const auto found = unattached_action_views_.find(std::string(id));
		    found != unattached_action_views_.end())
			for (auto* view : found->second)
				if (view) result.push_back(view);
		return result;
	}
	std::vector<std::pair<std::string, std::string>> state_transitions(std::string_view id) const {
		if (const auto found = state_transitions_.find(std::string(id));
		    found != state_transitions_.end())
			return found->second;
		return {};
	}
	std::optional<std::pair<std::string, std::string>> active_state_transition(
	    std::string_view id) const {
		const auto index = active_action_index(id);
		const auto found = state_transitions_.find(std::string(id));
		if (!index || found == state_transitions_.end() || *index >= found->second.size())
			return std::nullopt;
		return found->second[*index];
	}

private:
	void attach(pulp::view::View& view,
	            const pulp::view::NativeImportHostActionDescriptor& descriptor) {
		if (descriptor.action.empty()) return;
		const auto id = std::string(descriptor.action);
		encountered_actions_.insert(id);
		auto endpoint = endpoints_.find(id);
		if (endpoint == endpoints_.end()) {
			view.set_enabled(false);
			view.set_hit_testable(false);
			auto& views = unattached_action_views_[id];
			if (std::ranges::find(views, &view) == views.end()) views.push_back(&view);
			return;
		}
		const auto* signature = pulp::view::find_application_action(manifest_, id);
		std::string payload(descriptor.payload_contract);
		if (payload.empty() && descriptor.application_state_transition.starts_with("set:") &&
		    signature && signature->fields.size() == 1 &&
		    signature->fields.front().required && signature->fields.front().type == "string") {
			// A captured state destination is sufficient evidence for the only
			// scalar action field. This preserves payloads across state-frontier
			// composition without guessing from product labels or action names.
			payload = descriptor.application_state_transition.substr(4);
		}
		std::vector<std::string_view> required_fields;
		if (signature)
			for (const auto& field : signature->fields)
				if (field.required) required_fields.push_back(field.name);
		if (!pulp::view::imported_action_payload_contract_covers_fields(
		        payload, required_fields)) {
			// Typed action admission is declarative: every required field must be
			// literal, captured, or mapped to invocation-time runtime context.
			// The callback below resolves mapped values again at dispatch and
			// therefore still fails closed when current context is unavailable.
			view.set_enabled(false);
			view.set_hit_testable(false);
			auto& views = unattached_action_views_[id];
			if (std::ranges::find(views, &view) == views.end()) views.push_back(&view);
			return;
		}
		const auto instance_id = view.import_binding_instance_id();
		if (const auto found = action_views_.find(id); found != action_views_.end()) {
			const auto identities = action_view_instance_ids_.find(id);
			for (std::size_t index = 0; index < found->second.size(); ++index)
				if (found->second[index] == &view && identities != action_view_instance_ids_.end() &&
				    index < identities->second.size() && identities->second[index] == instance_id) return;
		}
		const auto state_key = std::string(descriptor.application_state_key);
		const auto state_transition = std::string(descriptor.application_state_transition);
		auto callback = [this, endpoint = endpoint->second, payload] {
			const auto resolved = pulp::view::resolve_imported_action_payload(
				payload, owner_.runtime_context_lookup_);
			if (!resolved) return false;
			endpoint(*resolved);
			return true;
		};
		if (auto* button = dynamic_cast<pulp::view::TextButton*>(&view)) {
			auto imported_callback = std::move(button->on_click);
			button->on_click = [imported_callback = std::move(imported_callback),
			                    callback = std::move(callback)]() mutable {
				if (callback() && imported_callback) imported_callback();
			};
		} else {
			auto imported_callback = std::move(view.on_click);
			view.on_click = [imported_callback = std::move(imported_callback),
			                 callback = std::move(callback)]() mutable {
				if (callback() && imported_callback) imported_callback();
			};
		}
		attached_.insert(id);
		action_views_[id].push_back(&view);
		action_view_instance_ids_[id].push_back(instance_id);
		payloads_[id].push_back(payload);
		state_transitions_[id].emplace_back(state_key, state_transition);
	}
	bool invoke(std::string_view id, std::string_view payload) {
		auto endpoint = endpoints_.find(std::string(id));
		if (endpoint == endpoints_.end()) return false;
		auto callback = endpoint->second;
		callback(payload);
		return true;
	}
	bool invoke_with_state(std::string_view id, std::string_view payload,
	                       std::string_view state_key, std::string_view state_transition) {
		if (!invoke(id, payload)) return false;
		if (!state_key.empty() && !state_transition.empty())
			owner_.apply_application_state_transition(state_key, state_transition);
		return true;
	}

	ImportedRootHost& owner_;
	std::unordered_map<std::string, ActionEndpoint>& endpoints_;
	pulp::view::ApplicationBindingManifest manifest_;
	const pulp::view::DesignIR& ir_;
	pulp::view::ImportedRepeatedList*& transcript_;
	pulp::view::ImportedRepeatedList*& projects_;
	std::unordered_set<std::string> attached_;
	std::unordered_set<std::string> encountered_actions_;
	std::unordered_map<std::string, std::vector<pulp::view::View*>> action_views_;
	std::unordered_map<std::string, std::vector<pulp::view::View*>> unattached_action_views_;
	std::unordered_map<std::string, std::vector<std::uint64_t>> action_view_instance_ids_;
	std::unordered_map<std::string, std::vector<std::string>> payloads_;
	std::unordered_map<std::string, std::vector<std::pair<std::string, std::string>>> state_transitions_;
	std::unordered_map<std::string, std::vector<pulp::view::TextEditor*>> text_bindings_;
};

ImportedRootHost::ImportedRootHost() = default;
ImportedRootHost::~ImportedRootHost() {
	while (child_count()) remove_child(child_at(0));
	binding_context_.reset();
}

void ImportedRootHost::register_action(std::string id, ActionEndpoint endpoint) {
	if (id.empty() || !endpoint) throw std::invalid_argument("imported-root action endpoint is invalid");
	if (!endpoints_.emplace(std::move(id), std::move(endpoint)).second)
		throw std::invalid_argument("duplicate imported-root action endpoint");
}

void ImportedRootHost::set_runtime_context_lookup(RuntimeContextLookup lookup) {
	runtime_context_lookup_ = std::move(lookup);
}

void ImportedRootHost::load(const std::filesystem::path& design_ir_path,
	                          const std::filesystem::path& binding_manifest_path) {
	if (child_count() != 0) throw std::logic_error("imported root can only be loaded once");
	std::string manifest_error;
	auto manifest = pulp::view::parse_application_binding_manifest(
		read_text(binding_manifest_path), &manifest_error);
	if (!manifest) throw std::runtime_error("application binding manifest rejected: " + manifest_error);
	for (const auto& action : manifest->actions) {
		if (action.required && !endpoints_.contains(action.id))
			throw std::runtime_error("required application action has no consumer endpoint: " + action.id);
	}

	auto parsed = std::make_unique<pulp::view::DesignIR>(
		pulp::view::parse_design_ir_json(read_text(design_ir_path)));
	if (parsed->source_adapter != "observed-dom")
		throw std::runtime_error("primary tree is not source-observed DesignIR");
	std::vector<pulp::view::ImportDiagnostic> diagnostics;
	pulp::view::NativeMaterializeOptions options;
	options.diagnostics_out = &diagnostics;
	auto root = pulp::view::build_native_view_tree(*parsed, parsed->asset_manifest, options);
	if (!root || root->child_count() == 0 || has_error(diagnostics))
		throw std::runtime_error("source-observed primary tree failed native materialization" +
		                         error_diagnostics(diagnostics));

	binding_context_ = std::make_unique<BindingContext>(
		*this, endpoints_, *manifest, *parsed, transcript_, projects_);
	pulp::view::bind_native_view_tree(*root, *parsed, *binding_context_, {.diagnostics_out = &diagnostics});
	if (has_error(diagnostics)) throw std::runtime_error("source-observed primary tree binding failed");
	binding_context_->install_pending_collection();
	for (const auto& action : manifest->actions) {
		if (binding_context_->attached().contains(action.id)) continue;
		unattached_actions_.push_back(action.id);
		if (action.required) unattached_required_actions_.push_back(action.id);
	}
	for (const auto& action : binding_context_->encountered_actions()) {
		if (binding_context_->attached().contains(action) ||
		    std::ranges::find(unattached_actions_, action) != unattached_actions_.end())
			continue;
		unattached_actions_.push_back(action);
	}
	std::ranges::sort(unattached_actions_);
	attached_action_count_ = binding_context_->attached().size();
	ir_ = std::move(parsed);
	add_child(std::move(root));
	source_observed_primary_tree_ = true;
}

void ImportedRootHost::layout_children() {
	if (child_count() == 0) return;
	child_at(0)->set_bounds(local_bounds());
	child_at(0)->layout_children();
}

bool ImportedRootHost::source_observed_primary_tree() const noexcept {
	return source_observed_primary_tree_;
}

std::size_t ImportedRootHost::attached_action_count() const noexcept { return attached_action_count_; }

const std::vector<std::string>& ImportedRootHost::unattached_required_actions() const noexcept {
	return unattached_required_actions_;
}

bool ImportedRootHost::invoke_bound_action(std::string_view id) {
	return binding_context_ && binding_context_->invoke_bound(id);
}

bool ImportedRootHost::set_application_state(std::string_view key, std::string_view value) {
	return child_count() != 0 &&
	       pulp::view::set_imported_application_state(*child_at(0), key, value);
}

bool ImportedRootHost::clear_application_state(std::string_view key) {
	return child_count() != 0 &&
	       pulp::view::clear_imported_application_state(*child_at(0), key);
}

bool ImportedRootHost::apply_application_state_transition(std::string_view key,
	                                                        std::string_view transition) {
	return child_count() != 0 &&
	       pulp::view::apply_imported_application_state_transition(*child_at(0), key, transition);
}

std::vector<pulp::view::View*> ImportedRootHost::bound_action_views(std::string_view id) const {
	return binding_context_ ? binding_context_->bound_views(id) : std::vector<pulp::view::View*>{};
}

std::vector<std::pair<std::string, std::string>>
ImportedRootHost::bound_action_state_transitions(std::string_view id) const {
	return binding_context_
		       ? binding_context_->state_transitions(id)
		       : std::vector<std::pair<std::string, std::string>>{};
}

std::optional<std::pair<std::string, std::string>>
ImportedRootHost::active_action_state_transition(std::string_view id) const {
	return binding_context_ ? binding_context_->active_state_transition(id) : std::nullopt;
}

std::vector<pulp::view::View*> ImportedRootHost::unattached_action_views(std::string_view id) const {
	return binding_context_ ? binding_context_->unattached_views(id) : std::vector<pulp::view::View*>{};
}

const std::vector<std::string>& ImportedRootHost::unattached_actions() const noexcept {
	return unattached_actions_;
}

std::optional<std::string> ImportedRootHost::active_action_payload(std::string_view id) const {
	return binding_context_ ? binding_context_->action_payload(id) : std::nullopt;
}

pulp::view::TextEditor* ImportedRootHost::active_text_binding(std::string_view value_key) const noexcept {
	return binding_context_ ? binding_context_->text_binding(value_key) : nullptr;
}

std::optional<std::string> ImportedRootHost::text_binding_value(std::string_view value_key) const {
	if (auto* editor = active_text_binding(value_key)) return editor->text();
	return std::nullopt;
}

bool ImportedRootHost::set_text_binding_value(std::string_view value_key, std::string value) {
	if (auto* editor = active_text_binding(value_key)) {
		editor->set_text(std::move(value));
		return true;
	}
	return false;
}

pulp::view::TextEditor* ImportedRootHost::bound_composer() const noexcept {
	return active_text_binding("composer.draft");
}

void ImportedRootHost::set_transcript(std::vector<pulp::view::ImportedListItem> items) {
	if (!transcript_) throw std::logic_error("source transcript slot is not bound");
	transcript_->set_items(std::move(items));
}

void ImportedRootHost::set_transcript_auto_follow(bool enabled) {
	if (!transcript_) throw std::logic_error("source transcript slot is not bound");
	transcript_->set_auto_follow(enabled);
}

void ImportedRootHost::set_transcript_scroll_y(float y) {
	if (!transcript_) throw std::logic_error("source transcript slot is not bound");
	transcript_->set_scroll_y(y);
}

bool ImportedRootHost::scroll_transcript_to_item(std::string_view key) {
	return transcript_ && transcript_->scroll_to_item(key);
}

void ImportedRootHost::set_projects(std::vector<pulp::view::ImportedListItem> items) {
	if (!projects_) throw std::logic_error("imported projects collection is not installed");
	projects_->set_items(std::move(items));
}

std::filesystem::path palot_bundle_resource(std::string_view relative_path) {
#if defined(__APPLE__)
	std::uint32_t size = 0;
	_NSGetExecutablePath(nullptr, &size);
	std::string executable(size, '\0');
	if (_NSGetExecutablePath(executable.data(), &size) != 0)
		throw std::runtime_error("unable to resolve Palot executable path");
	executable.resize(std::char_traits<char>::length(executable.c_str()));
	const auto bundled = std::filesystem::weakly_canonical(
		std::filesystem::path(executable).parent_path() / "../Resources" / relative_path);
	if (std::filesystem::exists(bundled)) return bundled;
#if defined(PALOT_RESOURCE_SOURCE_ROOT)
	const auto source_root = std::filesystem::path(PALOT_RESOURCE_SOURCE_ROOT);
	const auto resource_candidate = source_root / relative_path;
	if (std::filesystem::exists(resource_candidate)) return resource_candidate;
	const auto consumer_candidate = source_root.parent_path() / relative_path;
	if (std::filesystem::exists(consumer_candidate)) return consumer_candidate;
	return resource_candidate;
#else
	return bundled;
#endif
#else
	return std::filesystem::path(PALOT_RESOURCE_SOURCE_ROOT) / relative_path;
#endif
}
