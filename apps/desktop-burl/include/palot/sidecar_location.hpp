#pragma once

#include <string_view>

namespace palot::sidecar {

// Resolve this path relative to the platform bundle Resources directory.
// Never resolve it against the process working directory.
inline constexpr std::string_view kResourceRelativePath = "bin/palot-opencode-sidecar";

// Fallback for a native executable located at Palot.app/Contents/MacOS/Palot.
inline constexpr std::string_view kExecutableRelativePath =
    "../Resources/bin/palot-opencode-sidecar";

}  // namespace palot::sidecar
