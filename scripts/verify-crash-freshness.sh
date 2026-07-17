#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 2 ]]; then
  echo "usage: $0 RECEIPT_JSON APP_BINARY [APP_ARGS...]" >&2
  exit 2
fi

receipt=$1
binary=$2
shift 2
report_dir=${PALOT_DIAGNOSTIC_REPORT_DIR:-"$HOME/Library/Logs/DiagnosticReports"}
settle_seconds=${PALOT_CRASH_SETTLE_SECONDS:-4}
start_epoch=$(date +%s)
latest_before=$(find "$report_dir" -maxdepth 1 -type f \
  \( -name 'Palot*.ips' -o -name 'Palot*.crash' \) -exec stat -f '%m %N' {} + 2>/dev/null \
  | sort -nr | head -1 || true)

"$binary" "$@" >/tmp/palot-crash-freshness.stdout 2>/tmp/palot-crash-freshness.stderr &
pid=$!
sleep "$settle_seconds"
if ! kill -0 "$pid" 2>/dev/null; then
  wait "$pid"
  echo "Palot exited before the responsiveness interval completed" >&2
  exit 3
fi
kill -TERM "$pid"
wait "$pid" 2>/dev/null || true
sleep 2

new_reports=()
while IFS= read -r record; do
  [[ -z "$record" ]] && continue
  epoch=${record%% *}
  path=${record#* }
  if (( epoch >= start_epoch )); then new_reports+=("$path"); fi
done < <(find "$report_dir" -maxdepth 1 -type f \
  \( -name 'Palot*.ips' -o -name 'Palot*.crash' \) -exec stat -f '%m %N' {} + 2>/dev/null \
  | sort -nr)

mkdir -p "$(dirname "$receipt")"
jq -n \
  --arg schema "burl-palot-crash-freshness-v1" \
  --arg binary "$binary" \
  --argjson startedAtEpoch "$start_epoch" \
  --arg latestBefore "$latest_before" \
  --argjson settleSeconds "$settle_seconds" \
  --argjson newCrashReports "$(printf '%s\n' "${new_reports[@]:-}" | jq -Rsc 'split("\n") | map(select(length > 0))')" \
  '{schema:$schema,binary:$binary,startedAtEpoch:$startedAtEpoch,latestBefore:$latestBefore,
    settleSeconds:$settleSeconds,newCrashReports:$newCrashReports,passed:($newCrashReports|length==0)}' \
  > "$receipt"

if (( ${#new_reports[@]} != 0 )); then
  printf 'new Palot crash report: %s\n' "${new_reports[@]}" >&2
  exit 4
fi
echo "crash freshness: PASS ($receipt)"
