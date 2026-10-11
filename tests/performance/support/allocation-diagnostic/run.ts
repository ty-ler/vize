import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveTsgoBinary } from "../../../_helpers/realworld-typecheck.ts";
import { sha256 } from "../../../differential/sha256.ts";
import { assessMemoryArm, assessMemoryPair } from "./assessment.ts";
import { buildArm, rawGit } from "./build.ts";
import { command, json, successful } from "./command.ts";
import { FROZEN_SOURCE } from "./launch.ts";
import { qualifyAllocationCheckout, retainSourceBodies } from "./source.ts";

/** A single bounded pair; no retries, altered workload, added RPC or old binary identity. */
export async function runMemoryPair(driver: string, output: string): Promise<void> {
  assert.equal(process.platform, "linux");
  assert.equal(process.env.RAYON_NUM_THREADS, "4");
  assert.equal(process.env.VIZE_LSP_CURRENT_BASELINE, undefined);
  assert.equal(process.env.VIZE_DIAGNOSTIC_NATIVE_FACT_BUCKETS, undefined);
  assert.equal(process.env.VIZE_PERF_BUDGET_SCALE ?? "1", "1");
  assert(!fs.existsSync(output), "stale or repeated capture refused");
  fs.mkdirSync(output, { recursive: true });
  const qualification = qualifyAllocationCheckout(driver);
  assert(qualification, "finite full source qualification required before build or observation");
  retainSourceBodies(driver, path.join(output, "whole-source"));
  const source = path.join(output, "first-source");
  successful(
    await command(
      path.join(output, "worktree-command"),
      "git",
      ["--no-replace-objects", "worktree", "add", "--detach", source, FROZEN_SOURCE],
      driver,
      process.env,
    ),
  );
  fs.symlinkSync(
    fs.realpathSync(path.join(driver, "node_modules")),
    path.join(source, "node_modules"),
    "dir",
  );
  assert.equal(rawGit(source, "rev-parse", "HEAD").toString().trim(), FROZEN_SOURCE);
  const backend = fs.realpathSync(resolveTsgoBinary());
  const base = {
    ...process.env,
    CARGO_TARGET_DIR: path.join(driver, "target"),
    CORSA_PATH: backend,
    VIZE_TEST_TSGO: backend,
    VIZE_TEST_REQUIRE_TSGO: "1",
    VIZE_LSP_REQUIRE_SOURCE_BUILD: "1",
    VIZE_PERF_BUDGET_SCALE: "1",
  };
  for (const key of [
    "VIZE_LSP_ALLOCATION_DIAGNOSTIC",
    "VIZE_TRACE_EDITOR_PREPARATION",
    "VIZE_LSP_MEMORY_BINDING",
  ])
    delete base[key];
  json(path.join(output, "campaign.json"), {
    schema: "vize.lsp.allocation.bounded.pair",
    version: 1,
    qualification,
    originalSource: FROZEN_SOURCE,
    diagnosticSource: rawGit(driver, "rev-parse", "HEAD").toString().trim(),
    historicalExecutable:
      "unavailable; first arm rebuilds the exact frozen source and evidenced CI+legacy recipe",
    backend: { path: backend, sha256: sha256(fs.readFileSync(backend)) },
    originalCycles: 40,
    originalRssFences: 63,
    originalServerCapMiB: 128,
    driverObservation: "passive-wire-and-smaps-can-affect-scheduling-and-timing",
    dynamicBoundary: "one-initialize-processId-equals-authenticated-owner-parentPid",
    cache: "shared dependency build cache, fresh server per arm; no cold-cache claim",
    acceptanceCredit: "none",
  });
  const results = [];
  for (const [role, root, label] of [
    ["first-original-ci", source, "first"],
    ["second-allocation-diagnostic", driver, "second"],
  ] as const) {
    const armRoot = path.join(output, label);
    const binding = await buildArm(driver, root, armRoot, role, backend, base);
    const bindingFile = path.join(armRoot, "binding.json");
    json(bindingFile, binding);
    const env = {
      ...base,
      VIZE_LSP_BIN: path.join(root, "target/ci/vize"),
      VIZE_LSP_MEMORY_BINDING: bindingFile,
      VIZE_LSP_BUILD_RECIPE:
        role === "first-original-ci"
          ? "cargo build --profile ci -p vize --features legacy"
          : "cargo build --profile ci -p vize --features legacy,allocation-diagnostic",
    };
    if (role === "second-allocation-diagnostic")
      Object.assign(env, {
        VIZE_LSP_ALLOCATION_DIAGNOSTIC: "1",
        VIZE_TRACE_EDITOR_PREPARATION: "1",
      });
    const original = await command(
      path.join(armRoot, "original-command"),
      process.execPath,
      ["--test", "--test-concurrency=1", "tests/performance/lsp-churn-stress.test.ts"],
      driver,
      env,
      330_000,
    );
    // A complete original cap failure remains nonzero but does not discard the second diagnostic arm.
    assert.equal(original.failure, null);
    assert.equal(original.signal, null);
    const observed = assessMemoryArm(binding.outputRoot);
    assert.equal(original.code, observed.originalStatus === "passed" ? 0 : 1);
    json(path.join(armRoot, "assessment.json"), { ...observed, originalCommand: original });
    results.push({ observed, original });
  }
  let pair: unknown;
  let refusal: string | null = null;
  try {
    pair = assessMemoryPair(
      path.join(output, "first/session"),
      path.join(output, "second/session"),
    );
  } catch (error) {
    refusal = error instanceof Error ? (error.stack ?? error.message) : String(error);
  }
  json(path.join(output, "pair-assessment.json"), {
    pair: pair ?? null,
    refusal,
    results,
    acceptanceCredit: "none",
  });
  assert.equal(refusal, null, "complete vector comparison refused; original arm packets retained");
  assert(
    results.every((result) => result.original.code === 0),
    "original cap/gate remains RED; diagnosis grants no repair credit",
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert.equal(process.argv.length, 3);
  await runMemoryPair(process.cwd(), path.resolve(process.argv[2]));
}
