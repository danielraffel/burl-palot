#include "imported_root_host.hpp"

#include <pulp/view/buttons.hpp>

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

}  // namespace

class ImportedRootHost::BindingContext final : public pulp::view::NativeImportBindingContext {
public:
	explicit BindingContext(std::unordered_map<std::string, ActionEndpoint>& endpoints)
		: endpoints_(endpoints) {}

	void bind_host_action(pulp::view::TextButton& button,
	                      const pulp::view::NativeImportHostActionDescriptor& descriptor) override {
		attach(button, descriptor);
	}

	void bind_application_action(pulp::view::View& view,
	                             const pulp::view::NativeImportHostActionDescriptor& descriptor) override {
		if (auto* button = dynamic_cast<pulp::view::TextButton*>(&view)) attach(*button, descriptor);
	}

	[[nodiscard]] const std::unordered_set<std::string>& attached() const noexcept { return attached_; }

private:
	void attach(pulp::view::TextButton& button,
	            const pulp::view::NativeImportHostActionDescriptor& descriptor) {
		auto endpoint = endpoints_.find(std::string(descriptor.action));
		if (endpoint == endpoints_.end()) return;
		const auto id = std::string(descriptor.action);
		const auto payload = std::string(descriptor.payload_contract);
		button.on_click = [callback = endpoint->second, payload] { callback(payload); };
		attached_.insert(id);
	}

	std::unordered_map<std::string, ActionEndpoint>& endpoints_;
	std::unordered_set<std::string> attached_;
};

ImportedRootHost::ImportedRootHost() = default;
ImportedRootHost::~ImportedRootHost() = default;

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
		throw std::runtime_error("source-observed primary tree failed native materialization");

	binding_context_ = std::make_unique<BindingContext>(endpoints_);
	pulp::view::bind_native_view_tree(*root, *parsed, *binding_context_, {.diagnostics_out = &diagnostics});
	if (has_error(diagnostics)) throw std::runtime_error("source-observed primary tree binding failed");
	for (const auto& action : manifest->actions) {
		if (action.required && !binding_context_->attached().contains(action.id))
			unattached_required_actions_.push_back(action.id);
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

std::filesystem::path palot_bundle_resource(std::string_view relative_path) {
#if defined(__APPLE__)
	std::uint32_t size = 0;
	_NSGetExecutablePath(nullptr, &size);
	std::string executable(size, '\0');
	if (_NSGetExecutablePath(executable.data(), &size) != 0)
		throw std::runtime_error("unable to resolve Palot executable path");
	executable.resize(std::char_traits<char>::length(executable.c_str()));
	return std::filesystem::weakly_canonical(std::filesystem::path(executable).parent_path() /
		"../Resources" / relative_path);
#else
	return std::filesystem::path(PALOT_RESOURCE_SOURCE_ROOT) / relative_path;
#endif
}
