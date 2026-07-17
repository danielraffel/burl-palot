#include <pulp/view/buttons.hpp>
#include <pulp/view/design_import.hpp>
#include <pulp/view/screenshot.hpp>
#include <pulp/view/text_editor.hpp>
#include <pulp/view/ui_components.hpp>
#include <pulp/view/widgets.hpp>

#include <nlohmann/json.hpp>

#include <algorithm>
#include <cmath>
#include <fstream>
#include <iostream>
#include <sstream>
#include <string>

using namespace pulp::view;

template <class T> T* find_view(View& view) {
    if (auto* result = dynamic_cast<T*>(&view)) return result;
    for (std::size_t i = 0; i < view.child_count(); ++i)
        if (auto* result = find_view<T>(*view.child_at(i))) return result;
    return nullptr;
}

const char* severity_name(ImportDiagnosticSeverity severity) {
    switch (severity) {
        case ImportDiagnosticSeverity::info: return "info";
        case ImportDiagnosticSeverity::warning: return "warning";
        case ImportDiagnosticSeverity::error: return "error";
    }
    return "unknown";
}

nlohmann::json diagnostics_json(const std::vector<ImportDiagnostic>& diagnostics) {
    auto out = nlohmann::json::array();
    for (const auto& diagnostic : diagnostics) {
        out.push_back({{"code", diagnostic.code},
                       {"severity", severity_name(diagnostic.severity)},
                       {"path", diagnostic.path},
                       {"property", diagnostic.property.value_or("")},
                       {"message", diagnostic.message}});
    }
    return out;
}

int main(int argc, char** argv) {
    if (argc != 7) {
        std::cerr << "usage: renderer <ir> <png> <pixel-width> <pixel-height> <dpr> <interaction>\n";
        return 2;
    }
    std::ifstream input(argv[1]);
    std::stringstream bytes;
    bytes << input.rdbuf();
    auto ir = parse_design_ir_json(bytes.str());
    std::vector<ImportDiagnostic> materialize_diagnostics;
    auto view = build_native_view_tree(ir, ir.asset_manifest,
        {.diagnostics_out = &materialize_diagnostics});
    if (!view) return 3;

    const auto pixel_width = static_cast<unsigned>(std::stoul(argv[3]));
    const auto pixel_height = static_cast<unsigned>(std::stoul(argv[4]));
    const auto dpr = std::stof(argv[5]);
    const auto logical_width = static_cast<unsigned>(std::ceil(pixel_width / dpr));
    const auto logical_height = static_cast<unsigned>(std::ceil(pixel_height / dpr));
    view->set_bounds({0, 0, static_cast<float>(logical_width), static_cast<float>(logical_height)});
    view->layout_children();

    const std::string interaction = argv[6];
    bool visual_state_precondition_pass = true;
    if (interaction == "text-input") {
        auto* editor = find_view<TextEditor>(*view);
        visual_state_precondition_pass = editor != nullptr && editor->text().empty();
    }
    // The parity image is always the declared source state. Interaction is
    // exercised only after capture so semantic mutation cannot contaminate it.
    const bool rendered = render_to_file(*view, logical_width, logical_height, argv[2], dpr,
                                         ScreenshotBackend::skia);

    bool interaction_supported = true;
    bool post_action_pass = true;
    if (interaction == "activate") {
        if (auto* button = find_view<TextButton>(*view)) {
            int count = 0;
            button->on_click = [&] { ++count; };
            button->on_mouse_down({2, 2});
            button->on_mouse_up({2, 2});
            post_action_pass = count == 1;
        } else interaction_supported = false;
    } else if (interaction == "selected-row") {
        if (auto* toggle = find_view<ToggleButton>(*view)) {
            toggle->set_on(true);
            toggle->on_mouse_down({2, 2});
            toggle->on_mouse_up({2, 2});
            post_action_pass = toggle->is_on();
        } else interaction_supported = false;
    } else if (interaction == "text-input") {
        if (auto* editor = find_view<TextEditor>(*view)) {
            editor->set_focus(true);
            editor->on_text_input(TextInputEvent{"native component gate"});
            post_action_pass = editor->text() == "native component gate";
        } else interaction_supported = false;
    }

    const bool ir_errors = std::any_of(ir.diagnostics.begin(), ir.diagnostics.end(), [](const auto& d) {
        return d.severity == ImportDiagnosticSeverity::error;
    });
    const bool materialize_errors = std::any_of(materialize_diagnostics.begin(), materialize_diagnostics.end(), [](const auto& d) {
        return d.severity == ImportDiagnosticSeverity::error;
    });
    nlohmann::json result{{"rendered", rendered}, {"irErrors", ir_errors},
        {"irDiagnostics", diagnostics_json(ir.diagnostics)},
        {"materializeErrors", materialize_errors},
        {"materializeDiagnostics", diagnostics_json(materialize_diagnostics)},
        {"capturePhase", "pre-interaction"},
        {"visualStatePreconditionPass", visual_state_precondition_pass},
        {"interactionSupported", interaction_supported},
        {"postActionPass", post_action_pass}, {"logicalWidth", logical_width},
        {"logicalHeight", logical_height}, {"backend", "skia"}, {"dpr", dpr}};
    std::cout << result.dump() << '\n';
    return rendered ? 0 : 4;
}
