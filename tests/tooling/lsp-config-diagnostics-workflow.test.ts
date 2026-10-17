import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { parse } from "yaml";

import { retainNativeLog } from "../../tools/support/compat/github/run-lsp-config-diagnostics.ts";
import { readRepoFile } from "./support/github-workflows.ts";

type Step = {
  name?: string;
  uses?: string;
  run?: string;
  if?: string;
  with?: Record<string, unknown>;
};

test("startup diagnostics retain the production producer and unchanged scale-one oracle", () => {
  const workflow = parse(readRepoFile(".github/workflows/lsp-config-diagnostics.yml"));
  assert.deepEqual(Object.keys(workflow.on), ["pull_request"]);
  assert.deepEqual(workflow.on.pull_request.paths, [
    ".github/workflows/lsp-config-diagnostics.yml",
    "tools/support/compat/github/run-lsp-config-diagnostics.ts",
    "tests/tooling/lsp-config-diagnostics-workflow.test.ts",
  ]);
  assert.deepEqual(workflow.permissions, { contents: "read" });
  assert.equal(workflow.jobs["vben-startup"]["runs-on"], "blacksmith-32vcpu-ubuntu-2404");
  assert.equal(workflow.env.RAYON_NUM_THREADS, "4");
  assert.equal(workflow.env.VIZE_PERF_BUDGET_SCALE, "1");
  assert.equal(workflow.env.VIZE_TRACE_EDITOR_PREPARATION, "1");
  const steps: Step[] = workflow.jobs["vben-startup"].steps;
  const checkout = steps.find((step) => step.uses?.startsWith("actions/checkout@"))!;
  assert.deepEqual(checkout.with, {
    ref: "${{ github.event.pull_request.head.sha }}",
    "persist-credentials": false,
  });
  const build = steps.find(
    (step) => step.name === "Build and receipt the same Vue parity producer",
  )!;
  assert.equal(
    build.run,
    "cargo build --profile ci -p vize --features legacy\nnode tests/differential/build-receipt.ts --legacy\n",
  );
  assert.equal(
    steps.find((step) => step.name === "Hydrate only the original pinned Vben fixture")?.run,
    "git submodule update --init --depth 1 tests/_fixtures/_git/vue-vben-admin",
  );
  const controls = steps.findIndex(
    (step) => step.name === "Verify native preparation and request freshness laws",
  );
  const measurement = steps.findIndex(
    (step) => step.name === "Run the unchanged original performance case with native phase tracing",
  );
  assert.ok(measurement > steps.indexOf(build));
  assert.ok(controls > measurement);
  assert.equal(
    steps[controls].run,
    "cargo test --locked --profile ci -p vize_maestro --features legacy --lib server::initial_diagnostics::\n" +
      "cargo test --locked --profile ci -p vize_maestro --features legacy --lib server::native_requests::\n" +
      "cargo clippy --locked --profile ci -p vize_maestro --features legacy --all-targets -- -D warnings\n",
  );
  const upload = steps.find((step) => step.uses?.startsWith("actions/upload-artifact@"))!;
  assert.equal(upload.if, "always()");
  for (const evidence of [
    "target/ci/vize",
    "target/ci/vize.differential-build.json",
    "node_modules/.vize/lsp.log",
    "target/vize-tests/metrics/vben-lsp-incremental/",
  ]) {
    assert.ok(String(upload.with?.path).split("\n").includes(evidence));
  }
  assert.equal(upload.with?.["include-hidden-files"], true);
  for (const step of steps) {
    assert.equal("continue-on-error" in step, false);
    assert.doesNotMatch(step.run ?? "", /warmup|budget.scale|\|\| true/);
  }
});

test("native phase logs retain all raw bytes after the mutable fixture is removed", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "vize-startup-log-custody-"));
  try {
    const fixture = path.join(directory, "mutable-fixture");
    const native = path.join(directory, "node_modules/.vize/lsp.log");
    const artifact = path.join(directory, "native-lsp.log");
    fs.mkdirSync(fixture);
    fs.mkdirSync(path.dirname(native), { recursive: true });
    const original = Buffer.from(
      "2026-10-17T01:18:34Z INFO phase=alias_build\r\nelapsed_ms=147.25\n\0raw\n",
    );
    fs.writeFileSync(native, original);
    fs.rmSync(fixture, { recursive: true });
    assert.equal(retainNativeLog(native, artifact), true);
    assert.deepEqual(fs.readFileSync(native), original);
    assert.deepEqual(fs.readFileSync(artifact), original);
    fs.rmSync(native);
    assert.equal(retainNativeLog(native, path.join(directory, "missing.log")), false);
    assert.equal(fs.existsSync(path.join(directory, "missing.log")), false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
