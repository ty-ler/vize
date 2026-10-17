import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { parse } from "yaml";

import {
  retainIntegrationProducer,
  retainMeasuredProducer,
  retainNativeLog,
} from "../../tools/support/compat/github/run-lsp-config-diagnostics.ts";
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
  const symlinkControls = steps.findIndex(
    (step) => step.name === "Observe the original six symlink workspace layouts",
  );
  const unionControls = steps.findIndex(
    (step) => step.name === "Verify real union ownership and reverse open-order regressions",
  );
  assert.ok(unionControls > controls);
  assert.ok(symlinkControls > unionControls);
  assert.equal(
    steps[unionControls].run,
    "cargo test --locked --profile ci -p vize_canon --features legacy --lib corsa_bridge::vue_document_package_tests::symlink_workspace::\n" +
      "cargo test --locked --profile ci -p vize_canon --features legacy --lib batch::virtual_project::tests::editor_union_alias_transition::\n" +
      "cargo test --locked --profile ci -p vize_canon --features legacy --lib corsa_bridge::vue_dependencies_alias::context::cache::tests::\n" +
      "cargo clippy --locked --profile ci -p vize_canon --features legacy --lib -- -D warnings\n",
  );
  assert.equal(
    steps[symlinkControls].run,
    "set +e\n" +
      "cargo test --locked --profile ci -p vize --features legacy --message-format=json --test lsp_symlink_workspace_staging_cli original_include_and_open_order_controls_keep_all_authored_bytes -- --nocapture > target/vize-tests/lsp-config-diagnostics/symlink.stdout 2> target/vize-tests/lsp-config-diagnostics/symlink.stderr\n" +
      "status=$?\nset -e\n" +
      "printf '%s\\n' \"$status\" > target/vize-tests/lsp-config-diagnostics/symlink.status\n" +
      "node tools/support/compat/github/run-lsp-config-diagnostics.ts --retain-symlink-producer\n" +
      "cat target/vize-tests/lsp-config-diagnostics/symlink.stdout\n" +
      'cat target/vize-tests/lsp-config-diagnostics/symlink.stderr >&2\nexit "$status"\n',
  );
  const allCanonTargets = steps.findIndex(
    (step) => step.name === "Check all Canon targets after the measured and integration gates",
  );
  assert.ok(allCanonTargets > symlinkControls);
  assert.equal(
    steps[allCanonTargets].run,
    "cargo clippy --locked --profile ci -p vize_canon --features legacy --all-targets -- -D warnings",
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

test("post-measurement Cargo relinking cannot replace the measured producer evidence", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "vize-measured-producer-"));
  try {
    const binary = path.join(directory, "vize");
    const receipt = path.join(directory, "vize.differential-build.json");
    const original = Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0xff, 0, 3]);
    const originalReceipt = Buffer.from(
      JSON.stringify({ binarySha256: createHash("sha256").update(original).digest("hex") }),
    );
    fs.writeFileSync(binary, original);
    fs.writeFileSync(receipt, originalReceipt);
    const retained = retainMeasuredProducer(binary, receipt, directory);
    fs.writeFileSync(binary, "integration test relink with dev dependencies");
    fs.writeFileSync(receipt, "subsequent producer receipt");
    assert.deepEqual(fs.readFileSync(path.join(directory, retained.retainedBinary)), original);
    assert.deepEqual(
      fs.readFileSync(path.join(directory, retained.retainedBuildReceipt)),
      originalReceipt,
    );
    assert.throws(() =>
      retainMeasuredProducer(
        binary,
        path.join(directory, retained.retainedBuildReceipt),
        directory,
      ),
    );
    assert.deepEqual(fs.readFileSync(path.join(directory, retained.retainedBinary)), original);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("the six-layout CLI receipt uses the Cargo-reported integration producer", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "vize-symlink-producer-"));
  try {
    const executable = path.join(directory, "test-cli");
    const log = path.join(directory, "cargo.stdout");
    const bytes = Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0, 0xff, 9]);
    fs.writeFileSync(executable, bytes);
    const producer = {
      reason: "compiler-artifact",
      target: { name: "vize", kind: ["bin"] },
      executable,
    };
    fs.writeFileSync(log, `original test output\n${JSON.stringify(producer)}\n`);
    const metadata = retainIntegrationProducer(log, directory);
    assert.equal(metadata.executable, executable);
    assert.equal(metadata.binarySha256, createHash("sha256").update(bytes).digest("hex"));
    assert.deepEqual(metadata.cargoArtifact, producer);
    assert.deepEqual(fs.readFileSync(path.join(directory, "symlink-test-vize")), bytes);
    assert.deepEqual(
      JSON.parse(fs.readFileSync(path.join(directory, "symlink-test-producer.json"), "utf8")),
      metadata,
    );
    for (const messages of [
      [],
      [{ ...producer, target: { name: "vize_canon", kind: ["lib"] } }],
      [producer, producer],
    ]) {
      fs.writeFileSync(log, messages.map((message) => JSON.stringify(message)).join("\n"));
      assert.throws(() => retainIntegrationProducer(log, directory), /exactly one real test CLI/);
      assert.deepEqual(fs.readFileSync(path.join(directory, "symlink-test-vize")), bytes);
    }
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
