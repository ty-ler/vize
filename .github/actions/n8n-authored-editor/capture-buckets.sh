#!/usr/bin/env bash
# The second original workload is diagnostic; preserve the first acceptance result.
set -euo pipefail

vp node --test .github/actions/n8n-authored-editor/owned-process.test.mjs .github/actions/n8n-authored-editor/bucket-observations.test.mjs
[[ "${VIZE_DIAGNOSTIC_NATIVE_FACT_BUCKETS:-}" == 1 ]]
output=$(realpath -m "${1:?diagnostic output directory is required}")
first="$(dirname "$output")/authored-registry"
for file in source-inputs-before.json source-inputs-after.json complete.json stderr.txt; do
  test -s "$first/$file"
done
mkdir -p "$output"
git rev-parse HEAD > "$output/checkout.txt"
sha256sum "$VIZE_LSP_BIN" > "$output/source-binary.sha256"
sha256sum Cargo.lock pnpm-lock.yaml > "$output/source-locks.sha256"
date --iso-8601=ns > "$output/started-at.txt"
printf '%s\n' 'VIZE_DIAGNOSTIC_NATIVE_FACT_BUCKETS=1' \
  'vp node tests/tooling/support/n8n-authored-registry-acceptance.ts' \
  "$output/consumer" > "$output/consumer-command.txt"

consumer_pid=""
cleanup() {
  if [[ -n "$consumer_pid" ]] && kill -0 "$consumer_pid" 2>/dev/null; then
    kill -TERM "$consumer_pid" 2>/dev/null || true
  fi
  if [[ -f "$output/owned-process.json" ]]; then
    if vp node .github/actions/n8n-authored-editor/owned-process.mjs --stop "$output" \
      > "$output/cleanup.stdout" 2> "$output/cleanup.stderr"; then
      printf '0\n' > "$output/cleanup-status.txt"
    else
      printf '%s\n' "$?" > "$output/cleanup-status.txt"
    fi
  fi
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

vp node tests/tooling/support/n8n-authored-registry-acceptance.ts "$output/consumer" \
  > "$output/consumer.stdout" 2> "$output/consumer.stderr" &
consumer_pid=$!
started=$SECONDS
while [[ ! -f "$output/consumer/process.json" ]]; do
  if ! kill -0 "$consumer_pid" 2>/dev/null || (( SECONDS - started > 60 )); then
    printf '%s\n' 'The original provider did not publish an owned process.' >&2
    exit 1
  fi
  sleep 0.1
done
vp node .github/actions/n8n-authored-editor/owned-process.mjs "$output" "$VIZE_LSP_BIN" \
  > "$output/processing-pid.txt"

while kill -0 "$consumer_pid" 2>/dev/null; do
  if (( SECONDS - started > 660 )); then
    printf '%s\n' 'The separate diagnostic process exceeded 660 seconds.' >&2
    exit 1
  fi
  sleep 1
done
if wait "$consumer_pid"; then consumer_status=0; else consumer_status=$?; fi
consumer_pid=""
printf 'consumer_exit=%s\nacceptance_credit=none\n' "$consumer_status" > "$output/status.txt"
vp node --input-type=module -e 'import { clockReceipt } from "./.github/actions/n8n-authored-editor/owned-process.mjs"; process.stdout.write(JSON.stringify(clockReceipt()))' \
  > "$output/finished-clock.json"
vp node .github/actions/n8n-authored-editor/bucket-observations.mjs "$output"
sha256sum --check "$output/source-binary.sha256"
sha256sum --check "$output/source-locks.sha256"
date --iso-8601=ns > "$output/finished-at.txt"
printf '%s\n' 'Bucket capture finished; the original first campaign status remains separate.'
