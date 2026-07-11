#!/bin/sh
set -eu

app=${1:-}
if [ -z "$app" ] || [ ! -d "$app/Contents/MacOS" ] || [ ! -d "$app/Contents/Resources" ]; then
	echo "usage: $0 /path/to/Palot.app" >&2
	exit 64
fi

sidecar="$app/Contents/Resources/bin/palot-opencode-sidecar"
manifest="$app/Contents/Resources/sidecar-manifest.json"
license_dir="$app/Contents/Resources/licenses"

test -f "$sidecar"
test -x "$sidecar"
test -f "$manifest"
test -f "$license_dir/Palot-LICENSE"
test -f "$license_dir/THIRD-PARTY-NOTICES.md"
test -f "$license_dir/SIDECAR-NOTICES.md"

handshake=$(printf '%s\n' '{"version":1,"type":"shutdown","id":"package-audit"}' | "$sidecar")
printf '%s\n' "$handshake" | grep -Eq '"type":"ready"'
printf '%s\n' "$handshake" | grep -Fq '"type":"shutdown","id":"package-audit"'

for forbidden in Electron Chromium WebKit WebView app.asar; do
	if find "$app" -iname "*$forbidden*" -print -quit | grep -q .; then
		echo "forbidden browser runtime artifact in bundle: $forbidden" >&2
		exit 1
	fi
done

if command -v otool >/dev/null 2>&1; then
	for executable in "$app/Contents/MacOS"/* "$sidecar"; do
		test -f "$executable" || continue
		if otool -L "$executable" 2>/dev/null | grep -Eiq 'Electron|Chromium|WebKit|WebView'; then
			echo "forbidden browser runtime linkage: $executable" >&2
			exit 1
		fi
	done
fi

echo "browserless Palot package verified: $app"
