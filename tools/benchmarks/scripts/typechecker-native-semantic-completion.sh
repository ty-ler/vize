#!/usr/bin/env bash
# Whole original parser handoff and observed native teardown, on the existing target.
set -euo pipefail
[[ "${VIZE_TEST_REQUIRE_TSGO:-}" == 1 ]]
[[ -n "${SOURCE_SHA:-}" && -n "${RUNNER_TEMP:-}" ]]
[[ "$(git rev-parse HEAD)" == "$SOURCE_SHA" ]]
[[ -x "${VIZE_TEST_TSGO_PATH:-}" ]]
unset VIZE_TEST_DISABLE_TSGO VIZE_NESTED_BATCH_CAPTURE_DIR
export CORSA_PATH="$VIZE_TEST_TSGO_PATH"
export VIZE_SEMANTIC_COMPLETION_CAPTURE_DIR="$RUNNER_TEMP/native-semantic-completion"
mkdir "$VIZE_SEMANTIC_COMPLETION_CAPTURE_DIR"
printf '%s\n' "$SOURCE_SHA" > "$VIZE_SEMANTIC_COMPLETION_CAPTURE_DIR/source-sha.txt"
options=(--locked --profile ci-opt --config 'profile.ci-opt.inherits="release"' --config 'profile.ci-opt.lto="thin"' --config 'profile.ci-opt.codegen-units=16')
# The already source-built libtest and CLI targets share profile, features and cache.
factory_status=0
cargo test "${options[@]}" -p vize_canon --lib native_semantic_completion -- --nocapture --test-threads=1 \
  > >(tee "$VIZE_SEMANTIC_COMPLETION_CAPTURE_DIR/factory.stdout.bin") \
  2> >(tee "$VIZE_SEMANTIC_COMPLETION_CAPTURE_DIR/factory.stderr.bin" >&2) || factory_status=$?
cli_status=0
cargo test "${options[@]}" -p vize --test check_canon_native_completion_cli --config 'profile.ci-opt.package.vize.strip="symbols"' -- --nocapture --test-threads=1 \
  > >(tee "$VIZE_SEMANTIC_COMPLETION_CAPTURE_DIR/cli-test.stdout.bin") \
  2> >(tee "$VIZE_SEMANTIC_COMPLETION_CAPTURE_DIR/cli-test.stderr.bin" >&2) || cli_status=$?
wait
printf 'factory=%s\ncli=%s\n' "$factory_status" "$cli_status" > "$VIZE_SEMANTIC_COMPLETION_CAPTURE_DIR/test-status.txt"
[[ "$factory_status" == 0 && "$cli_status" == 0 ]]
rg -q -F 'test result: ok. 1 passed; 0 failed;' "$VIZE_SEMANTIC_COMPLETION_CAPTURE_DIR/factory.stdout.bin"
rg -q -F 'test result: ok. 1 passed; 0 failed;' "$VIZE_SEMANTIC_COMPLETION_CAPTURE_DIR/cli-test.stdout.bin"
