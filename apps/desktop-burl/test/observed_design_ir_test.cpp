#include <pulp/view/design_import.hpp>
#include <pulp/view/design_import_dynamic.hpp>
#include <pulp/view/design_ir.hpp>
#include <pulp/view/view.hpp>

#include <filesystem>
#include <fstream>
#include <iostream>
#include <sstream>

namespace {

std::size_t count_nodes(const pulp::view::IRNode& node) {
	std::size_t count = 1;
	for (const auto& child : node.children) count += count_nodes(child);
	return count;
}

std::size_t count_type(const pulp::view::IRNode& node, std::string_view type) {
	std::size_t count = node.type == type ? 1 : 0;
	for (const auto& child : node.children) count += count_type(child, type);
	return count;
}

struct ImportContractCounts {
	std::size_t responsive_nodes = 0;
	std::size_t responsive_transitions = 0;
	std::size_t collection_templates = 0;
};

void collect_import_contract(const pulp::view::IRNode& node, ImportContractCounts& counts) {
	if (node.responsive) {
		++counts.responsive_nodes;
		for (const auto& visibility : node.responsive->visibility)
			if (visibility.transition_to_next) ++counts.responsive_transitions;
		for (const auto& variant : node.responsive->layout_variants)
			if (variant.transition_to_next) ++counts.responsive_transitions;
	}
	if (node.attributes.contains("pulpCollectionTemplate"))
		++counts.collection_templates;
	for (const auto& child : node.children) collect_import_contract(child, counts);
}

}

int main(int argc, char** argv) {
	if (argc != 2) return 2;
	std::ifstream input{std::filesystem::path(argv[1])};
	if (!input) return 3;
	std::ostringstream bytes;
	bytes << input.rdbuf();
	const auto ir = pulp::view::parse_design_ir_json(bytes.str());
	if (ir.source_adapter != "observed-dom" || count_nodes(ir.root) < 250) return 4;
	if (count_type(ir.root, "button") < 20 || count_type(ir.root, "text_editor") < 1) return 5;
	ImportContractCounts counts;
	collect_import_contract(ir.root, counts);
	// Canonical 15-width source capture baseline. These floors make a
	// single-viewport regeneration fail closed instead of silently erasing the
	// responsive contract while allowing additive importer improvements.
	if (counts.responsive_nodes < 251 || counts.responsive_transitions < 112 ||
	    counts.collection_templates != 6) return 7;
	const auto templates = pulp::view::extract_imported_collection_templates(ir.root);
	const auto assistant = templates.find("assistant");
	auto contains_anchor_fragment = [&](const auto& self, const pulp::view::IRNode& node,
	                                   std::string_view fragment) -> bool {
		if ((node.stable_anchor_id && node.stable_anchor_id->find(fragment) != std::string::npos) ||
		    node.name.find(fragment) != std::string::npos) return true;
		for (const auto& child : node.children)
			if (self(self, child, fragment)) return true;
		return false;
	};
	if (assistant == templates.end() ||
	    !contains_anchor_fragment(contains_anchor_fragment, assistant->second, "5d2d28cb")) {
		std::cerr << "assistant template lost source-owned trailing action row\n";
		return 8;
	}
	const auto user = templates.find("user");
	if (user == templates.end() || user->second.layout.width_mode != pulp::view::SizingMode::fill ||
	    user->second.style.width_dimension != "100%" ||
	    user->second.layout.margin_left_dimension != "auto") {
		std::cerr << "user template did not retain direct-sample stretch and auto-margin semantics\n";
		return 11;
	}
	pulp::view::ImportedRepeatedList user_list(
		{{"user", user->second}}, ir.asset_manifest);
	user_list.set_bounds({0.0f, 0.0f, 875.0f, 200.0f});
	user_list.set_items({{"user-1", "user", {{"message.text", "A sufficiently long imported user message"}}}});
	user_list.layout_children();
	auto* virtual_list = user_list.child_at(0);
	auto* row_host = virtual_list && virtual_list->child_count() ? virtual_list->child_at(0) : nullptr;
	auto* user_root = row_host && row_host->child_count() ? row_host->child_at(0) : nullptr;
	auto* user_bubble = user_root && user_root->child_count() ? user_root->child_at(0) : nullptr;
	if (!user_root || user_root->bounds().width < 830.0f || user_root->bounds().right() < 874.0f) {
		if (user_root) std::cerr << "realized user template geometry=" << user_root->bounds().x << ','
		                         << user_root->bounds().width << " row=" << row_host->bounds().x << ','
		                         << row_host->bounds().width << " virtual=" << virtual_list->bounds().x << ','
		                         << virtual_list->bounds().width << " width="
		                         << user_root->flex().dim_width.value << ':'
		                         << static_cast<int>(user_root->flex().dim_width.unit) << " max="
		                         << user_root->flex().dim_max_width.value << ':'
		                         << static_cast<int>(user_root->flex().dim_max_width.unit) << " ml="
		                         << user_root->flex().dim_margin_left.value << ':'
		                         << static_cast<int>(user_root->flex().dim_margin_left.unit) << '\n';
		return 9;
	}
	if (!user_bubble || user_bubble->bounds().x > 1.0f || user_bubble->bounds().width < 830.0f) {
		if (user_bubble) std::cerr << "realized user bubble geometry=" << user_bubble->bounds().x << ','
		                           << user_bubble->bounds().width << " width="
		                           << user_bubble->flex().dim_width.value << ':'
		                           << static_cast<int>(user_bubble->flex().dim_width.unit) << " ml="
		                           << user_bubble->flex().dim_margin_left.value << ':'
		                           << static_cast<int>(user_bubble->flex().dim_margin_left.unit) << '\n';
		return 10;
	}
	std::vector<pulp::view::ImportDiagnostic> diagnostics;
	pulp::view::NativeMaterializeOptions options;
	options.diagnostics_out = &diagnostics;
	auto root = pulp::view::build_native_view_tree(ir, ir.asset_manifest, options);
	if (!root || root->child_count() == 0) {
		for (const auto& diagnostic : diagnostics)
			std::cerr << diagnostic.code << ": " << diagnostic.message << '\n';
		return 6;
	}
	root->set_bounds({0.0f, 0.0f, 1200.0f, 800.0f});
	root->layout_children();
	std::cout << "observed DesignIR nodes=" << count_nodes(ir.root)
	          << " diagnostics=" << diagnostics.size() << '\n';
	return 0;
}
