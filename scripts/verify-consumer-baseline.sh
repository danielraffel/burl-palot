#!/bin/sh
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$root"

expected_root=01e4d1ea197b9a50b413e7d848a71b1321fcc617
test "$(git rev-list --max-parents=0 HEAD | head -1)" = "$expected_root"
upstream_head=$(git ls-remote https://github.com/ItsWendell/palot.git refs/heads/main | awk '{print $1}')
test -n "$upstream_head"
test -f LICENSE
test -f THIRD-PARTY-NOTICES.md
test -f apps/desktop/package.json
test -f apps/desktop-burl/CMakeLists.txt

revision=$(sed -n 's/.*"revision": "\([0-9a-f]*\)".*/\1/p' apps/desktop-burl/burl.lock.json)
case "$revision" in
	????????????????????????????????????????) ;;
	*) echo "Burl revision is not a full immutable commit" >&2; exit 1 ;;
esac

if grep -R -E 'BURL_(SOURCE_DIR|ROOT).*(/Users/|\.\./)' \
	apps/desktop-burl --exclude=CMakeLists.txt --exclude=README.md >/dev/null; then
	echo "committed mutable Burl path found" >&2
	exit 1
fi

build_dir="${TMPDIR:-/tmp}/burl-palot-boundary-$$"
trap 'cmake -E remove_directory "$build_dir"' EXIT HUP INT TERM

cmake -S apps/desktop-burl -B "$build_dir" \
	-DBURL_PALOT_ENABLE_FRAMEWORK=OFF -DCMAKE_BUILD_TYPE=Release >/dev/null
cmake --build "$build_dir" --parallel 2 >/dev/null
echo "consumer baseline verified: Palot history, notices, Electron reference, immutable Burl pin"
