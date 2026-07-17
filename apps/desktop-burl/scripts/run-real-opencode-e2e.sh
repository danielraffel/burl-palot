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
export PALOT_OPENCODE_VERSION=$(/opt/homebrew/bin/opencode --version)
export PALOT_SIDECAR_SHA256=$(shasum -a 256 "$sidecar" | awk '{print $1}')
python3 - "$build_dir/palot-real-opencode-e2e" "$sidecar" "$project_dir" "$evidence" <<'PY'
import subprocess, sys
try:
    result = subprocess.run(sys.argv[1:], timeout=420)
except subprocess.TimeoutExpired:
    print("real OpenCode E2E exceeded 420 seconds", file=sys.stderr)
    raise SystemExit(124)
raise SystemExit(result.returncode)
PY
