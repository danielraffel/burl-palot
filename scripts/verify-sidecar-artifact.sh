#!/bin/sh
set -eu

artifact=${1:-}
expected_sha256=${2:-}
expected_arch=${3:-}
provenance=${4:-}

if [ ! -f "$artifact" ] || [ -z "$expected_sha256" ] || [ -z "$expected_arch" ] ||
	[ ! -f "$provenance" ]; then
	echo "usage: $0 ARTIFACT EXPECTED_SHA256 EXPECTED_ARCH PROVENANCE" >&2
	exit 64
fi

actual_sha256=$(shasum -a 256 "$artifact" | awk '{print $1}')
if [ "$actual_sha256" != "$expected_sha256" ]; then
	echo "sidecar SHA-256 mismatch: expected $expected_sha256, got $actual_sha256" >&2
	exit 1
fi

case "$(file "$artifact")" in
	*"$expected_arch"*) ;;
	*) echo "sidecar architecture mismatch: expected $expected_arch" >&2; exit 1 ;;
esac

grep -Eq '"(source|builder|release|commit)"[[:space:]]*:' "$provenance" || {
	echo "sidecar provenance lacks a source, builder, release, or commit identity" >&2
	exit 1
}

echo "sidecar artifact verified: $actual_sha256 $expected_arch"
