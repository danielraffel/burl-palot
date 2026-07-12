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
	explicit BindingContext(std::unordered_map<std::string, ActionEndpoint>& endpoints,
	                       const pulp::view::DesignIR& ir,
	                       pulp::view::ImportedRepeatedList*& transcript,
	                       pulp::view::ImportedRepeatedList*& projects)
		: endpoints_(endpoints), ir_(ir), transcript_(transcript), projects_(projects) {}

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
		if (descriptor.value_key != "composer.draft") return;
		composer_ = &editor;
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
		if (descriptor.collection_key != "messages" && descriptor.collection_key != "projects") return;
		if (!pending_hosts_.emplace(std::string(descriptor.collection_key), &host).second)
			throw std::runtime_error("duplicate imported collection slot");
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
			}
		}
	}
	void install_pending_collection() {
		if (!pending_hosts_.contains("messages") || !pending_hosts_.contains("projects"))
			throw std::runtime_error("required imported collection slot was not bound");
		auto templates = pulp::view::extract_imported_collection_templates(ir_.root);
		if (!templates.contains("user") || !templates.contains("assistant") || !templates.contains("tool") ||
		    !templates.contains("project")) throw std::runtime_error("source collection templates are incomplete");
		std::unordered_map<std::string, pulp::view::IRNode> transcript_templates;
		for (const auto* id : {"user", "assistant", "tool"}) transcript_templates.emplace(id, templates.at(id));
		auto list = std::make_unique<pulp::view::ImportedRepeatedList>(std::move(transcript_templates), ir_.asset_manifest, this);
		auto* transcript_host = pending_hosts_.at("messages");
		while (transcript_host->child_count()) transcript_host->remove_child(transcript_host->child_at(0));
		transcript_host->flex().direction = pulp::view::FlexDirection::column;
		transcript_host->flex().flex_shrink = 1.0f;
		transcript_host->flex().min_height = 0.0f;
		transcript_host->flex().dim_min_height = {0.0f, pulp::view::DimensionUnit::px};
		action_views_.erase("composer.copy");
		action_view_instance_ids_.erase("composer.copy");
		payloads_.erase("composer.copy");
		transcript_ = list.get();
		transcript_->flex().flex_grow = 1.0f;
		transcript_host->add_child(std::move(list));
		auto project_list = std::make_unique<pulp::view::ImportedRepeatedList>(
			std::unordered_map<std::string, pulp::view::IRNode>{{"project", templates.at("project")}}, ir_.asset_manifest, this);
		auto* project_host = pending_hosts_.at("projects");
		action_views_.erase("project.open");
		action_view_instance_ids_.erase("project.open");
		payloads_.erase("project.open");
		while (project_host->child_count()) project_host->remove_child(project_host->child_at(0));
		projects_ = project_list.get();
		projects_->set_auto_follow(false);
		projects_->flex().flex_grow = 1.0f;
		project_host->add_child(std::move(project_list));
	}

	[[nodiscard]] const std::unordered_set<std::string>& attached() const noexcept { return attached_; }
	[[nodiscard]] pulp::view::TextEditor* composer() const noexcept { return composer_; }
	bool invoke_bound(std::string_view id) {
		const auto key = std::string(id);
		if (!attached_.contains(key)) return false;
		const auto payload = payloads_.find(key);
		return invoke(id, payload == payloads_.end() || payload->second.empty()
			? std::string_view{} : std::string_view(payload->second.front()));
	}
	std::vector<pulp::view::View*> bound_views(std::string_view id) const {
		std::vector<pulp::view::View*> result;
		if (const auto found = action_views_.find(std::string(id)); found != action_views_.end())
			result.assign(found->second.begin(), found->second.end());
		if (id == "prompt.send" || id == "prompt.retry" || id == "prompt.cancel")
			if (composer_) result.push_back(composer_);
		return result;
	}

private:
	void attach(pulp::view::View& view,
	            const pulp::view::NativeImportHostActionDescriptor& descriptor) {
		auto endpoint = endpoints_.find(std::string(descriptor.action));
		if (endpoint == endpoints_.end()) return;
		const auto id = std::string(descriptor.action);
		const auto instance_id = view.import_binding_instance_id();
		if (const auto found = action_views_.find(id); found != action_views_.end()) {
			const auto identities = action_view_instance_ids_.find(id);
			for (std::size_t index = 0; index < found->second.size(); ++index)
				if (found->second[index] == &view && identities != action_view_instance_ids_.end() &&
				    index < identities->second.size() && identities->second[index] == instance_id) return;
		}
		const auto payload = std::string(descriptor.payload_contract);
		auto callback = [endpoint = endpoint->second, payload] { endpoint(payload); };
		if (auto* button = dynamic_cast<pulp::view::TextButton*>(&view)) button->on_click = callback;
		else view.on_click = std::move(callback);
		attached_.insert(id);
		action_views_[id].push_back(&view);
		action_view_instance_ids_[id].push_back(instance_id);
		payloads_[id].push_back(payload);
	}
	bool invoke(std::string_view id, std::string_view payload) {
		auto endpoint = endpoints_.find(std::string(id));
		if (endpoint == endpoints_.end()) return false;
		auto callback = endpoint->second;
		callback(payload);
		return true;
	}

	std::unordered_map<std::string, ActionEndpoint>& endpoints_;
	const pulp::view::DesignIR& ir_;
	pulp::view::ImportedRepeatedList*& transcript_;
	pulp::view::ImportedRepeatedList*& projects_;
	std::unordered_map<std::string, pulp::view::View*> pending_hosts_;
	std::unordered_set<std::string> attached_;
	std::unordered_map<std::string, std::vector<pulp::view::View*>> action_views_;
	std::unordered_map<std::string, std::vector<std::uint64_t>> action_view_instance_ids_;
	std::unordered_map<std::string, std::vector<std::string>> payloads_;
	pulp::view::TextEditor* composer_ = nullptr;
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

	binding_context_ = std::make_unique<BindingContext>(endpoints_, *parsed, transcript_, projects_);
	pulp::view::bind_native_view_tree(*root, *parsed, *binding_context_, {.diagnostics_out = &diagnostics});
	if (has_error(diagnostics)) throw std::runtime_error("source-observed primary tree binding failed");
	binding_context_->install_pending_collection();
	for (const auto& action : manifest->actions) {
		if (binding_context_->attached().contains(action.id)) continue;
		unattached_actions_.push_back(action.id);
		if (action.required) unattached_required_actions_.push_back(action.id);
	}
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

std::vector<pulp::view::View*> ImportedRootHost::bound_action_views(std::string_view id) const {
	return binding_context_ ? binding_context_->bound_views(id) : std::vector<pulp::view::View*>{};
}

const std::vector<std::string>& ImportedRootHost::unattached_actions() const noexcept {
	return unattached_actions_;
}

pulp::view::TextEditor* ImportedRootHost::bound_composer() const noexcept {
	return binding_context_ ? binding_context_->composer() : nullptr;
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
