#pragma once

#include <pulp/view/application_binding_manifest.hpp>
#include <pulp/view/design_import.hpp>
#include <pulp/view/design_import_dynamic.hpp>
#include <pulp/view/view.hpp>

#include <filesystem>
#include <functional>
#include <memory>
#include <optional>
#include <string>
#include <string_view>
#include <unordered_map>
#include <vector>

class ImportedRootHost final : public pulp::view::View {
public:
	using ActionEndpoint = std::function<void(std::string_view)>;
	using RuntimeContextLookup = pulp::view::NativeImportRuntimeContextLookup;
	ImportedRootHost();
	~ImportedRootHost() override;

	void register_action(std::string id, ActionEndpoint endpoint);
	void set_runtime_context_lookup(RuntimeContextLookup lookup);
	void load(const std::filesystem::path& design_ir_path,
	          const std::filesystem::path& binding_manifest_path);
	void layout_children() override;

	[[nodiscard]] bool source_observed_primary_tree() const noexcept;
	[[nodiscard]] std::size_t attached_action_count() const noexcept;
	[[nodiscard]] const std::vector<std::string>& unattached_required_actions() const noexcept;
	bool invoke_bound_action(std::string_view id);
	bool set_application_state(std::string_view key, std::string_view value);
	bool clear_application_state(std::string_view key);
	bool apply_application_state_transition(std::string_view key, std::string_view transition);
	[[nodiscard]] std::vector<pulp::view::View*> bound_action_views(std::string_view id) const;
	[[nodiscard]] std::vector<std::pair<std::string, std::string>>
	bound_action_state_transitions(std::string_view id) const;
	[[nodiscard]] std::optional<std::pair<std::string, std::string>>
	active_action_state_transition(std::string_view id) const;
	[[nodiscard]] std::vector<pulp::view::View*> unattached_action_views(std::string_view id) const;
	[[nodiscard]] const std::vector<std::string>& unattached_actions() const noexcept;
	[[nodiscard]] std::optional<std::string> active_action_payload(std::string_view id) const;
	pulp::view::TextEditor* active_text_binding(std::string_view value_key) const noexcept;
	[[nodiscard]] std::optional<std::string> text_binding_value(std::string_view value_key) const;
	bool set_text_binding_value(std::string_view value_key, std::string value);
	pulp::view::TextEditor* bound_composer() const noexcept;
	void set_transcript(std::vector<pulp::view::ImportedListItem> items);
	void set_transcript_auto_follow(bool enabled);
	void set_transcript_scroll_y(float y);
	bool scroll_transcript_to_item(std::string_view key);
	void set_projects(std::vector<pulp::view::ImportedListItem> items);

private:
	class BindingContext;
	std::unordered_map<std::string, ActionEndpoint> endpoints_;
	RuntimeContextLookup runtime_context_lookup_;
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
