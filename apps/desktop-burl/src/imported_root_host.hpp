#pragma once

#include <pulp/view/application_binding_manifest.hpp>
#include <pulp/view/design_import.hpp>
#include <pulp/view/design_import_dynamic.hpp>
#include <pulp/view/view.hpp>

#include <filesystem>
#include <functional>
#include <memory>
#include <string>
#include <string_view>
#include <unordered_map>
#include <vector>

class ImportedRootHost final : public pulp::view::View {
public:
	using ActionEndpoint = std::function<void(std::string_view)>;
	ImportedRootHost();
	~ImportedRootHost() override;

	void register_action(std::string id, ActionEndpoint endpoint);
	void load(const std::filesystem::path& design_ir_path,
	          const std::filesystem::path& binding_manifest_path);
	void layout_children() override;

	[[nodiscard]] bool source_observed_primary_tree() const noexcept;
	[[nodiscard]] std::size_t attached_action_count() const noexcept;
	[[nodiscard]] const std::vector<std::string>& unattached_required_actions() const noexcept;
	bool invoke_bound_action(std::string_view id);
	[[nodiscard]] std::vector<pulp::view::View*> bound_action_views(std::string_view id) const;
	[[nodiscard]] const std::vector<std::string>& unattached_actions() const noexcept;
	pulp::view::TextEditor* bound_composer() const noexcept;
	void set_transcript(std::vector<pulp::view::ImportedListItem> items);
	void set_projects(std::vector<pulp::view::ImportedListItem> items);

private:
	class BindingContext;
	std::unordered_map<std::string, ActionEndpoint> endpoints_;
	std::unique_ptr<BindingContext> binding_context_;
	std::unique_ptr<pulp::view::DesignIR> ir_;
	std::vector<std::string> unattached_required_actions_;
	std::vector<std::string> unattached_actions_;
	bool source_observed_primary_tree_ = false;
	std::size_t attached_action_count_ = 0;
	pulp::view::ImportedRepeatedList* transcript_ = nullptr;
	pulp::view::ImportedRepeatedList* projects_ = nullptr;
};

std::filesystem::path palot_bundle_resource(std::string_view relative_path);
