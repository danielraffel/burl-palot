#!/bin/sh
set -eu

app_bundle=${1:-${PALOT_APP_BUNDLE:-}}
if [ -z "$app_bundle" ]; then
	echo "usage: bun run package:app-resources -- /path/to/Palot.app" >&2
	exit 64
fi
if [ ! -d "$app_bundle/Contents/Resources" ]; then
	echo "not a macOS application bundle: $app_bundle" >&2
	exit 66
fi

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
package_dir=$(dirname -- "$script_dir")
cd "$package_dir"
bun run build
install -d -m 755 "$app_bundle/Contents/Resources/bin"
install -m 755 dist/palot-opencode-sidecar \
	"$app_bundle/Contents/Resources/bin/palot-opencode-sidecar"
