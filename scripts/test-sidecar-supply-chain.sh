#!/bin/sh
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT HUP INT TERM

cp /bin/echo "$tmp/sidecar"
sha=$(shasum -a 256 "$tmp/sidecar" | awk '{print $1}')
printf '%s\n' '{"source":"positive-test"}' > "$tmp/provenance.json"

"$root/scripts/verify-sidecar-artifact.sh" "$tmp/sidecar" "$sha" arm64 "$tmp/provenance.json" >/dev/null

if "$root/scripts/verify-sidecar-artifact.sh" "$tmp/sidecar" "${sha%?}0" arm64 "$tmp/provenance.json" >/dev/null 2>&1; then
	echo "tampered SHA-256 was accepted" >&2
	exit 1
fi
if "$root/scripts/verify-sidecar-artifact.sh" "$tmp/sidecar" "$sha" mips "$tmp/provenance.json" >/dev/null 2>&1; then
	echo "wrong architecture was accepted" >&2
	exit 1
fi
printf '%s\n' '{}' > "$tmp/empty-provenance.json"
if "$root/scripts/verify-sidecar-artifact.sh" "$tmp/sidecar" "$sha" arm64 "$tmp/empty-provenance.json" >/dev/null 2>&1; then
	echo "empty provenance was accepted" >&2
	exit 1
fi

grep -Fq '"version": "1.2.1"' "$root/apps/desktop-burl/resources/sidecar-manifest.json"
grep -Fq '93c62cee7f48333e3b52ff4468b1095691f250e0bd58067ddb23c1ecdff1bbf7' "$root/apps/desktop-burl/resources/sidecar-manifest.json"
test "$(shasum -a 256 "$root/apps/desktop-burl/resources/licenses/OpenCode-SDK-LICENSE" | awk '{print $1}')" = "625f0f619133f89bbbb2abe37369613dfa1885eba1e50d02170deb62bb42cb6b"

app="$tmp/Palot.app"
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources/bin" "$app/Contents/Resources/licenses"
printf '%s\n' '#!/bin/sh' 'exit 0' > "$app/Contents/MacOS/Palot"
printf '%s\n' '#!/bin/sh' \
	'echo '\''{"version":1,"type":"ready"}'\''' \
	'echo '\''{"version":1,"type":"shutdown","id":"package-audit"}'\''' \
	> "$app/Contents/Resources/bin/palot-opencode-sidecar"
chmod +x "$app/Contents/MacOS/Palot" "$app/Contents/Resources/bin/palot-opencode-sidecar"
cp "$root/apps/desktop-burl/resources/sidecar-manifest.json" "$app/Contents/Resources/sidecar-manifest.json"
cp "$root/LICENSE" "$app/Contents/Resources/licenses/Palot-LICENSE"
cp "$root/THIRD-PARTY-NOTICES.md" "$app/Contents/Resources/licenses/THIRD-PARTY-NOTICES.md"
cp "$root/apps/opencode-sidecar/THIRD-PARTY-NOTICES.md" "$app/Contents/Resources/licenses/SIDECAR-NOTICES.md"
cp "$root/apps/desktop-burl/resources/licenses/OpenCode-SDK-LICENSE" "$app/Contents/Resources/licenses/OpenCode-SDK-LICENSE"
printf '%s\n' '{"builder":"positive-test"}' > "$app/Contents/Resources/palot-opencode-sidecar.provenance.json"
(cd "$app/Contents/Resources/bin" && shasum -a 256 palot-opencode-sidecar) > "$app/Contents/Resources/palot-opencode-sidecar.sha256"
"$root/scripts/verify-burl-app-package.sh" "$app" >/dev/null
printf '%s\n' '# tampered' >> "$app/Contents/Resources/bin/palot-opencode-sidecar"
if "$root/scripts/verify-burl-app-package.sh" "$app" >/dev/null 2>&1; then
	echo "tampered packaged sidecar was accepted" >&2
	exit 1
fi

echo "sidecar supply-chain tests passed"
