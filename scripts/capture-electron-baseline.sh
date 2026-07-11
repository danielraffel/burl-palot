#!/bin/sh
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$root"

timestamp=$(date -u +%Y%m%dT%H%M%SZ)
out_dir=${PALOT_BASELINE_OUTPUT_DIR:-"$root/benchmarks/electron"}
mkdir -p "$out_dir"
out="$out_dir/$timestamp.json"

desktop_bytes=$(git ls-files -z apps/desktop | xargs -0 wc -c | awk 'END { print $1 }')
bundle=${PALOT_ELECTRON_APP:-apps/desktop/release/mac-arm64/Palot.app}
bundle_bytes=0
chromium_bytes=0
if [ -d "$bundle" ]; then
	bundle_bytes=$(du -sk "$bundle" | awk '{ print $1 * 1024 }')
	chromium="$bundle/Contents/Frameworks/Electron Framework.framework"
	if [ -d "$chromium" ]; then
		chromium_bytes=$(du -sk "$chromium" | awk '{ print $1 * 1024 }')
	fi
fi

cat >"$out" <<EOF
{
  "schemaVersion": 1,
  "capturedAt": "$timestamp",
  "gitRevision": "$(git rev-parse HEAD)",
  "platform": "$(uname -s)-$(uname -m)",
  "electronVersion": "40.2.1",
  "desktopSourceBytes": $desktop_bytes,
  "applicationBundle": "$bundle",
  "applicationBundleBytes": $bundle_bytes,
  "chromiumFrameworkBytes": $chromium_bytes
}
EOF

echo "$out"
