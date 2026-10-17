import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import { parse } from "yaml";

const workflow = parse(
  fs.readFileSync(
    new URL("../../.github/workflows/lsp-current-baseline.yml", import.meta.url),
    "utf8",
  ),
);
const job = workflow.jobs["ordinary-rename"];
const testCase =
  "library_refusal::original_emit_string_keeps_atomic_owned_updates_and_unsafe_name_refusals_without_file_writes";
const recipe = `cargo test --locked --profile ci -p vize --features profiling --message-format=json --test lsp_component_attribute_authority_cli ${testCase} -- --exact --nocapture`;

test("diagnostic carrier selects exactly the two reviewed sources with independent statuses", () => {
  assert.deepEqual(Object.keys(workflow.jobs), ["ordinary-rename"]);
  assert.deepEqual(Object.keys(workflow.on), ["workflow_dispatch"]);
  assert.equal(job.strategy["fail-fast"], false);
  assert.equal(job["timeout-minutes"], 40);
  assert.deepEqual(job.strategy.matrix.include, [
    {
      case: "before-06a",
      producer: "006db2c6daa9c65df920864ab3838bd106d2b217",
      product: "06a51573858160eca1dfe4d54a06f90812f0f6b9",
    },
    {
      case: "after-574",
      producer: "4ab561447b51886f7ca9e29c81ed19aee0e89aaf",
      product: "574da6d432febac6056840e450e2fd422ac2ec16",
    },
  ]);
  assert.equal(job.steps[0].with.ref, "${{ matrix.producer }}");
  assert.equal(job.env.VIZE_DIAGNOSTIC_CARRIER, "${{ inputs.source_sha }}");
  assert.equal(workflow.concurrency["cancel-in-progress"], false);
  for (const step of job.steps) assert.equal(step["continue-on-error"], undefined);
  const upload = job.steps.find((step: any) => step.uses?.startsWith("actions/upload-artifact@"));
  assert.equal(upload.if, "always()");
  assert.equal(upload.with["if-no-files-found"], "error");
  assert.ok(upload.with.name.includes("${{ matrix.case }}-${{ matrix.producer }}"));
});

test("ordinary recipe retains default glyph maestro profiling without legacy or extra tests", () => {
  const step = job.steps.find((step: any) => step.name?.startsWith("Run the exact ordinary"));
  const lines = step.run.split("\n").filter((line: string) => line.startsWith("cargo test "));
  assert.equal(lines.length, 1);
  assert.ok(lines[0].startsWith(`${recipe} > `));
  assert.ok(!step.run.includes("--features legacy"));
  assert.equal(job.env.VIZE_TEST_CASE, testCase);
  assert.equal(job.env.RUST_LOG, "info");
  assert.equal(job.env.VIZE_TRACE_CANONICAL_RENAME, "1");
  assert.equal(job.env.SOURCE_SHA, "${{ matrix.producer }}");
  assert.equal(job.env.VIZE_LSP_PASSIVE_EVIDENCE, "${{ runner.temp }}/ordinary-rename/processes");
  assert.match(step.run, /assert\.equal\(artifacts\.length, 1,/);
  assert.match(
    step.run,
    /assert\.deepEqual\(\[\.\.\.artifact\.features\]\.sort\(\), \['default', 'glyph', 'maestro', 'profiling'\]\)/,
  );
  assert.match(step.run, /test_status=\$\?/);
  assert.match(step.run, /exit "\$test_status"/);
  assert.match(step.run, /runningExactlyOne/);
  assert.match(step.run, /stdout\.includes\(process\.env\.VIZE_TEST_CASE\)/);
  assert.match(step.run, /7f454c46/);
  assert.match(step.run, /fs\.copyFileSync\(actual, frozen\)/);
  assert.match(step.run, /cargo\.stdout\.jsonl/);
  assert.match(step.run, /cargo\.stderr\.log/);
});

test("passive complete bytes authenticate against the unchanged bounded manifest", () => {
  const run = job.steps.find((step: any) => step.name?.startsWith("Run the exact ordinary")).run;
  assert.match(run, /complete-evidence\.json/);
  assert.match(run, /assert\.equal\(hash\(complete\), manifest\.originalSha256\)/);
  assert.match(run, /assert\.equal\(hash\(bounded\), manifest\.persistedSha256\)/);
  assert.match(run, /assert\.deepEqual\(bounded, complete\.subarray\(0, bounded\.length\)\)/);
  assert.match(run, /extraIdentityProbe, false/);
  assert.match(run, /stdoutReaderJoined, true/);
  assert.match(run, /stderrReaderJoined, true/);
  assert.match(run, /native\.stderr\.log/);
  assert.match(run, /testSourceHashes, processes, repositoryLog/);
  assert.match(run, /harnessSha: process\.env\.GITHUB_SHA/);
  assert.match(run, /productSha: process\.env\.VIZE_PRODUCT_SOURCE/);
});
