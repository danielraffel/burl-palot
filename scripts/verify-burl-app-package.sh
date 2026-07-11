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
checksum="$app/Contents/Resources/palot-opencode-sidecar.sha256"
provenance="$app/Contents/Resources/palot-opencode-sidecar.provenance.json"

test -f "$sidecar"
test -x "$sidecar"
test -f "$manifest"
test -f "$license_dir/Palot-LICENSE"
test -f "$license_dir/THIRD-PARTY-NOTICES.md"
test -f "$license_dir/SIDECAR-NOTICES.md"
test -f "$license_dir/OpenCode-SDK-LICENSE"
test -f "$checksum"
test -f "$provenance"
grep -Eq '"(source|builder|release|commit)"[[:space:]]*:' "$provenance"

(cd "$app/Contents/Resources/bin" && shasum -a 256 -c "../palot-opencode-sidecar.sha256") >/dev/null
grep -Fq '"packageManager": "bun@1.3.8"' "$manifest"
grep -Fq '"version": "1.2.1"' "$manifest"
grep -Fq 'sha512-K5e15mIXTyAykBw0GX+8O28IJHlPMw1jI/m3SDu+hgUHjmg2refqLPqyuqv8hE2nRcuGi8HajhpDJjkO7H2S0A==' "$manifest"
grep -Fq '93c62cee7f48333e3b52ff4468b1095691f250e0bd58067ddb23c1ecdff1bbf7' "$manifest"
test "$(shasum -a 256 "$license_dir/OpenCode-SDK-LICENSE" | awk '{print $1}')" = \
	"625f0f619133f89bbbb2abe37369613dfa1885eba1e50d02170deb62bb42cb6b"

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
