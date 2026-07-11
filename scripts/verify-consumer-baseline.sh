#!/bin/sh
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$root"

test "$(git rev-list --max-parents=0 HEAD | head -1)" = "$(git rev-list --max-parents=0 palot-upstream/main | head -1)"
test "$(git remote get-url palot-upstream)" = "git@github.com:ItsWendell/palot.git"
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

cmake -S apps/desktop-burl -B /tmp/burl-palot-boundary \
	-DBURL_PALOT_ENABLE_FRAMEWORK=OFF -DCMAKE_BUILD_TYPE=Release >/dev/null
cmake --build /tmp/burl-palot-boundary --parallel 2 >/dev/null
echo "consumer baseline verified: Palot history, notices, Electron reference, immutable Burl pin"
