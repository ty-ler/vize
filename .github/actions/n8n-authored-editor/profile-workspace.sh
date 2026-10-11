#!/usr/bin/env bash
# Separate diagnostic process; its wall time is never acceptance evidence.
set -euo pipefail

output=$(realpath -m "${1:?diagnostic output directory is required}")
mkdir -p "$output"
git rev-parse HEAD > "$output/checkout.txt"
sha256sum "$VIZE_LSP_BIN" > "$output/source-binary.sha256"
sha256sum Cargo.lock pnpm-lock.yaml > "$output/source-locks.sha256"
date --iso-8601=ns > "$output/started-at.txt"
printf '%s\n' 'vp node tests/tooling/support/n8n-authored-registry-acceptance.ts' \
  "$output/consumer" > "$output/consumer-command.txt"
uname -a > "$output/kernel.txt"

perf_executable=""
while IFS= read -r candidate; do
  if [[ -x "$candidate" ]] && "$candidate" --version > "$output/perf-version.txt" 2>&1; then
    perf_executable="$candidate"
    break
  fi
done < <(rg --files /usr/lib/linux-tools | sort | while IFS= read -r candidate; do
  [[ "$candidate" == */perf ]] && printf '%s\n' "$candidate"
done)
test -n "$perf_executable"
strace --version > "$output/strace-version.txt"

consumer_pid=""
process_pid=""
perf_pid=""
strace_pid=""
cleanup() {
  for observer in "$perf_pid" "$strace_pid"; do
    if [[ -n "$observer" ]]; then sudo -n kill -INT "$observer" 2>/dev/null || true; fi
  done
  if [[ -n "$consumer_pid" ]] && kill -0 "$consumer_pid" 2>/dev/null; then
    kill -TERM "$consumer_pid" 2>/dev/null || true
  fi
  if [[ -n "$process_pid" ]] && kill -0 "$process_pid" 2>/dev/null; then
    kill -TERM "$process_pid" 2>/dev/null || true
  fi
  sudo -n chown -R "$(id -u):$(id -g)" "$output" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

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
process_pid=$(vp node --input-type=module - "$output" "$VIZE_LSP_BIN" <<'NODE'
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const [output, binary] = process.argv.slice(2);
const process = JSON.parse(fs.readFileSync(path.join(output, 'consumer/process.json')));
const checkout = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
assert.equal(process.checkout, checkout);
assert.ok(Number.isSafeInteger(process.pid) && process.pid > 0);
const executable = fs.realpathSync(`/proc/${process.pid}/exe`);
assert.equal(executable, fs.realpathSync(binary));
const stat = fs.readFileSync(`/proc/${process.pid}/stat`, 'utf8');
fs.writeFileSync(path.join(output, 'owned-process.json'), `${JSON.stringify({
  checkout, pid: process.pid, executable, stat, observedAt: new Date().toISOString(),
}, null, 2)}\n`);
globalThis.process.stdout.write(String(process.pid));
NODE
)

printf '%s\n' "$perf_executable record -e cpu-clock -F 49 --call-graph dwarf,4096 -p $process_pid" \
  > "$output/perf-command.txt"
printf '%s\n' "strace -f -c -p $process_pid" > "$output/strace-command.txt"
sudo -n "$perf_executable" record -e cpu-clock -F 49 --call-graph dwarf,4096 \
  -p "$process_pid" -o "$output/perf.data" \
  > "$output/perf.stdout" 2> "$output/perf.stderr" &
perf_pid=$!
sudo -n strace -f -c -p "$process_pid" -o "$output/syscalls.txt" \
  > "$output/strace.stdout" 2> "$output/strace.stderr" &
strace_pid=$!

while kill -0 "$consumer_pid" 2>/dev/null; do
  if (( SECONDS - started > 660 )); then
    printf '%s\n' 'The diagnostic observer exceeded 660 seconds.' >&2
    exit 1
  fi
  sleep 1
done
if wait "$consumer_pid"; then consumer_status=0; else consumer_status=$?; fi
consumer_pid=""
for observer in "$perf_pid" "$strace_pid"; do
  sudo -n kill -INT "$observer" 2>/dev/null || true
done
if wait "$perf_pid"; then perf_status=0; else perf_status=$?; fi
if wait "$strace_pid"; then strace_status=0; else strace_status=$?; fi
perf_pid=""
strace_pid=""
sudo -n chown -R "$(id -u):$(id -g)" "$output"
printf 'consumer_exit=%s\nperf_exit=%s\nstrace_exit=%s\n' \
  "$consumer_status" "$perf_status" "$strace_status" > "$output/status.txt"
if [[ -s "$output/perf.data" ]]; then
  "$perf_executable" report --stdio --header -i "$output/perf.data" \
    > "$output/cpu-report.txt" 2> "$output/cpu-report.stderr"
  "$perf_executable" script -i "$output/perf.data" \
    > "$output/cpu-stacks.txt" 2> "$output/cpu-stacks.stderr"
fi
sha256sum --check "$output/source-binary.sha256"
sha256sum --check "$output/source-locks.sha256"
date --iso-8601=ns > "$output/finished-at.txt"
test "$perf_status" -eq 0
test "$strace_status" -eq 0
test -s "$output/cpu-report.txt"
test -s "$output/syscalls.txt"
printf '%s\n' 'Profile capture finished; original campaign status remains separate.'
