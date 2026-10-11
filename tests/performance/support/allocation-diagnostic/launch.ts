import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { expectedBuildIdentity, LEGACY_BUILD_RECIPE } from "../../../differential/build-receipt.ts";
import type { VerifiedLspLaunch } from "../../../tooling/support/lsp/launch.ts";
import { sha256 } from "../../../differential/sha256.ts";

export const FROZEN_SOURCE = "e7ec9790a0ec5586588f97d21b8e5913ad01861c";
export const DIAGNOSTIC_RECIPE =
  "cargo build --profile ci -p vize --features legacy,allocation-diagnostic";
const INPUTS = [
  "tests/performance/lsp-churn-stress.test.ts",
  "tests/performance/support/file-lifecycle-churn.ts",
  "tests/performance/support/churn-oracle.ts",
  "tests/performance/support/lsp-oracle.ts",
  "tests/_fixtures/vue-ecosystem-fixtures.json",
  "tests/_helpers/realworld-patch.ts",
  "tests/_helpers/realworld-typecheck.ts",
  "tests/tooling/support/lsp/session.ts",
  "tests/performance/support/current-baseline/cycles.ts",
  "Cargo.toml",
  "Cargo.lock",
  ".cargo/config.toml",
  "rust-toolchain.toml",
  "pnpm-lock.yaml",
];

export type MemoryBinding = {
  role: "first-original-ci" | "second-allocation-diagnostic";
  sourceRoot: string;
  outputRoot: string;
  sourceRevision: string;
  binarySha256: string;
  receiptSha256: string;
  backendPath: string;
  backendSha256: string;
  featureManifests?: Record<
    string,
    { originalSha256: string; diagnosticSha256: string; sourceSha256: string }
  >;
};

/** Only these two whole Cargo bodies may extend the existing opt-in feature. */
export function diagnosticFeatureBody(relative: string, original: Buffer): Buffer {
  const [before, after] =
    relative === "crates/vize/Cargo.toml"
      ? [
          "profiling = []\n",
          'profiling = []\nallocation-diagnostic = ["profiling", "vize_canon/allocation-diagnostic"]\n',
        ]
      : relative === "crates/vize_canon/Cargo.toml"
        ? ['default = ["native"]\n', 'default = ["native"]\nallocation-diagnostic = []\n']
        : assert.fail("unknown diagnostic feature producer");
  const text = original.toString("utf8");
  assert.equal(text.split(before).length, 2, "whole original feature clause required exactly once");
  return Buffer.from(text.replace(before, after));
}

const git = (root: string, ...args: string[]) =>
  execFileSync("git", ["--no-replace-objects", ...args], { cwd: root, encoding: "utf8" }).trim();

export function memoryBinding(driverRoot: string): MemoryBinding | undefined {
  const file = process.env.VIZE_LSP_MEMORY_BINDING;
  if (!file) return undefined;
  assert.equal(process.platform, "linux");
  assert.equal(process.env.VIZE_LSP_REQUIRE_SOURCE_BUILD, "1");
  assert.equal(process.env.VIZE_TEST_REQUIRE_TSGO, "1");
  assert.equal(process.env.VIZE_LSP_CURRENT_BASELINE, undefined, "no extra completion queries");
  assert.equal(process.env.VIZE_PERF_BUDGET_SCALE ?? "1", "1");
  assert.equal(process.env.VIZE_DIAGNOSTIC_NATIVE_FACT_BUCKETS, undefined, "no occupancy campaign");
  const binding = JSON.parse(fs.readFileSync(file, "utf8")) as MemoryBinding;
  assert(["first-original-ci", "second-allocation-diagnostic"].includes(binding.role));
  for (const value of [binding.binarySha256, binding.receiptSha256, binding.backendSha256])
    assert.match(value, /^[a-f0-9]{64}$/);
  assert.match(binding.sourceRevision, /^[a-f0-9]{40}$/);
  binding.sourceRoot = fs.realpathSync(binding.sourceRoot);
  binding.backendPath = fs.realpathSync(binding.backendPath);
  assert.equal(git(binding.sourceRoot, "rev-parse", "HEAD"), binding.sourceRevision);
  assert.equal(git(binding.sourceRoot, "status", "--porcelain", "--untracked-files=no"), "");
  assert.equal(sha256(fs.readFileSync(binding.backendPath)), binding.backendSha256);
  assert.equal(fs.realpathSync(process.env.CORSA_PATH!), binding.backendPath);
  assert.equal(fs.realpathSync(process.env.VIZE_TEST_TSGO!), binding.backendPath);
  for (const relative of INPUTS) {
    const frozen = execFileSync(
      "git",
      ["--no-replace-objects", "show", `${FROZEN_SOURCE}:${relative}`],
      {
        cwd: driverRoot,
      },
    );
    assert.deepEqual(
      fs.readFileSync(path.join(driverRoot, relative)),
      frozen,
      `original whole input changed: ${relative}`,
    );
    assert.deepEqual(fs.readFileSync(path.join(binding.sourceRoot, relative)), frozen);
  }
  const first = binding.role === "first-original-ci";
  binding.featureManifests = Object.fromEntries(
    ["crates/vize/Cargo.toml", "crates/vize_canon/Cargo.toml"].map((relative) => {
      const original = execFileSync(
        "git",
        ["--no-replace-objects", "show", `${FROZEN_SOURCE}:${relative}`],
        {
          cwd: driverRoot,
        },
      );
      const diagnostic = diagnosticFeatureBody(relative, original);
      const source = fs.readFileSync(path.join(binding.sourceRoot, relative));
      assert.deepEqual(fs.readFileSync(path.join(driverRoot, relative)), diagnostic);
      assert.deepEqual(source, first ? original : diagnostic);
      return [
        relative,
        {
          originalSha256: sha256(original),
          diagnosticSha256: sha256(diagnostic),
          sourceSha256: sha256(source),
        },
      ];
    }),
  );
  if (first) {
    assert.equal(binding.sourceRevision, FROZEN_SOURCE);
    assert.equal(process.env.VIZE_LSP_ALLOCATION_DIAGNOSTIC, undefined);
    assert.equal(process.env.VIZE_TRACE_EDITOR_PREPARATION, undefined);
  } else {
    assert.notEqual(binding.sourceRevision, FROZEN_SOURCE);
    assert.equal(process.env.VIZE_LSP_ALLOCATION_DIAGNOSTIC, "1");
    assert.equal(process.env.VIZE_TRACE_EDITOR_PREPARATION, "1");
  }
  assert.equal(process.env.VIZE_LSP_BUILD_RECIPE, first ? LEGACY_BUILD_RECIPE : DIAGNOSTIC_RECIPE);
  return binding;
}

/** The SECOND receipt is separate and cannot qualify an ordinary source build. */
export function diagnosticLaunch(
  binding: MemoryBinding,
  binary: string | undefined,
): VerifiedLspLaunch | undefined {
  if (binding.role === "first-original-ci") return undefined;
  const expected = expectedBuildIdentity(binding.sourceRoot);
  assert.equal(expected.sourceRevision, binding.sourceRevision);
  assert.equal(expected.binarySha256, binding.binarySha256);
  assert.equal(
    fs.realpathSync(binary!),
    fs.realpathSync(path.join(binding.sourceRoot, expected.binaryPath)),
  );
  const raw = fs.readFileSync(`${binary}.allocation-build.json`);
  assert.equal(sha256(raw), binding.receiptSha256);
  const receipt = JSON.parse(raw.toString()) as Record<string, unknown>;
  assert.equal(receipt.schema, "vize.lsp.allocation.diagnostic.build");
  assert.equal(receipt.version, 1);
  assert.equal(receipt.recipe, DIAGNOSTIC_RECIPE);
  assert.equal(receipt.acceptanceCredit, "none");
  for (const [key, value] of Object.entries(expected)) assert.equal(receipt[key], value);
  const probe = spawnSync(binary!, ["--version"], { cwd: binding.sourceRoot, timeout: 10000 });
  assert.equal(probe.status, 0);
  assert.equal(probe.signal, null);
  assert.equal(probe.error, undefined);
  assert.equal(probe.stdout.toString().trim(), expected.cliVersion);
  return {
    binary: binary!,
    expected,
    receipt,
    buildRecipe: DIAGNOSTIC_RECIPE,
    versionProbe: {
      exitStatus: probe.status,
      signal: probe.signal,
      stdoutBase64: probe.stdout.toString("base64"),
      stderrBase64: probe.stderr.toString("base64"),
      processError: null,
    },
  };
}
