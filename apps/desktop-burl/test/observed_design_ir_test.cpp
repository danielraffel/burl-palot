#include <pulp/view/design_import.hpp>
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
	if (counts.responsive_nodes < 274 || counts.responsive_transitions < 267 ||
	    counts.collection_templates != 3) return 7;
	std::vector<pulp::view::ImportDiagnostic> diagnostics;
	pulp::view::NativeMaterializeOptions options;
	options.diagnostics_out = &diagnostics;
	auto root = pulp::view::build_native_view_tree(ir, ir.asset_manifest, options);
	if (!root || root->child_count() == 0) return 6;
	root->set_bounds({0.0f, 0.0f, 1200.0f, 800.0f});
	root->layout_children();
	std::cout << "observed DesignIR nodes=" << count_nodes(ir.root)
	          << " diagnostics=" << diagnostics.size() << '\n';
	return 0;
}
