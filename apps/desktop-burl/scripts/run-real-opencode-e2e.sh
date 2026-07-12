#!/bin/sh
set -eu

if [ "$#" -ne 3 ]; then
  echo "usage: $0 BUILD_DIR PROJECT_DIR EVIDENCE_JSON" >&2
  exit 2
fi
build_dir=$1
project_dir=$2
evidence=$3
test -x /opt/homebrew/bin/opencode
test -d "$project_dir"
sidecar="$build_dir/Palot.app/Contents/Resources/bin/palot-opencode-sidecar"
test -x "$sidecar"
PALOT_OPENCODE_VERSION=$(/opt/homebrew/bin/opencode --version) \
PALOT_SIDECAR_SHA256=$(shasum -a 256 "$sidecar" | awk '{print $1}') \
  "$build_dir/palot-real-opencode-e2e" "$sidecar" "$project_dir" "$evidence"
