import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { parse } from "yaml";
import {
  toolingMemoryObservation,
  toolingTestObservation,
} from "../../tools/support/compat/github/run-tooling-tests.mjs";

const listing = "tests/tooling/empty-vue-star-listing-source.test.mjs";
const command = ["--test", "--test-concurrency=1", listing, "tests/tooling/other.test.mjs"];

void test("only the existing selected listing source file enables hosted observation", () => {
  const env = Object.freeze({
    GITHUB_ACTIONS: "true",
    RUNNER_TEMP: "/tmp/example",
    NODE_TEST_CONTEXT: "child-v8",
  });
  for (const disabled of [{}, { ...env, GITHUB_ACTIONS: "false" }, { ...env, RUNNER_TEMP: "" }])
    assert.equal(toolingTestObservation(command, disabled), null);
  assert.equal(toolingTestObservation(command.slice(0, 2), env), null);
  assert.equal(
    toolingTestObservation(["--test", "--test-concurrency=1", "unknown.mjs"], env),
    null,
  );
  const observed = toolingTestObservation(command, env);
  assert.deepEqual(observed.args.slice(0, 2), command.slice(0, 2));
  assert.deepEqual(observed.args.slice(6), command.slice(2), "identical complete selected vector");
  assert.deepEqual(observed.args.slice(2, 6), [
    "--test-reporter=spec",
    "--test-reporter-destination=stdout",
    "--test-reporter=tap",
    "--test-reporter-destination=/tmp/example/tooling-listing-diagnostics/tests.tap",
  ]);
  assert.equal(env.NODE_TEST_CONTEXT, "child-v8", "observation does not repair inherited context");
});

void test("the original Node backend retains a child signal in TAP and still fails the whole command", () => {
  const temporary = mkdtempSync(join(tmpdir(), "vize-listing-tap-control-"));
  try {
    const observed = toolingTestObservation(command, {
      GITHUB_ACTIONS: "true",
      RUNNER_TEMP: temporary,
    });
    mkdirSync(observed.directory);
    const fixture = join(temporary, "terminated.test.mjs");
    writeFileSync(fixture, "process.kill(process.pid, 'SIGTERM');\n");
    // This controlled fixture starts an independent runner, rather than recursively
    // calling --test from this test file. Production observation preserves its env.
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    const result = spawnSync(process.execPath, [...observed.args.slice(0, 6), fixture], {
      encoding: "utf8",
      env,
    });
    assert.equal(result.status, 1, result.stderr);
    assert.equal(result.signal, null, "outer failure differs from the actual file child signal");
    const tap = readFileSync(join(observed.directory, "tests.tap"), "utf8");
    assert.match(tap, /signal: ['"]?SIGTERM/u);
    assert.match(tap, /failureType:/u);
    assert.match(result.stdout, /test failed/u, "spec output is retained");
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

void test("always-retained observations use their own run/head/attempt/job/shard artifact", () => {
  const action = parse(
    readFileSync(
      new URL(
        "../../.github/actions/upload-formatter-api-corpus-evidence/action.yml",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const original = action.runs.steps[0],
    observation = action.runs.steps[1];
  assert.equal(
    original.with.name,
    "formatter-api-corpus-${{ github.run_id }}-${{ github.run_attempt }}-${{ github.job }}-${{ inputs.shard }}",
  );
  assert.equal(observation.if, "${{ always() }}");
  assert.equal(observation.uses, original.uses);
  assert.equal(
    observation.with.name,
    "tooling-listing-diagnostics-${{ github.sha }}-${{ github.run_id }}-${{ github.run_attempt }}-${{ github.job }}-${{ inputs.shard }}",
  );
  assert.equal(observation.with.path, "${{ runner.temp }}/tooling-listing-diagnostics/");
  assert.equal(observation.with["if-no-files-found"], "warn");
  assert.equal(observation.run, undefined);
});

void test("memory observation retains whole kernel counters and missing-path errors without a verdict", () => {
  const observed = toolingMemoryObservation((file) => {
    if (file.endsWith("memory.events")) return "low 0\nhigh 0\nmax 7\noom 2\noom_kill 1\n";
    throw Object.assign(new Error("controlled missing cgroup"), { code: "ENOENT" });
  });
  assert.equal(
    observed["/sys/fs/cgroup/memory.events"].wholeUtf8,
    "low 0\nhigh 0\nmax 7\noom 2\noom_kill 1\n",
  );
  assert.equal(observed["/sys/fs/cgroup/memory.events.local"].error.code, "ENOENT");
  assert.equal(observed.oomVerdict, undefined, "job counters alone do not attribute a file kill");
});
