import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const repo = process.env.GITHUB_WORKSPACE;
const driver = path.dirname(fileURLToPath(import.meta.url));
const output = path.join(process.env.RUNNER_TEMP, "lsp-rss-pair");
const heads = {
  before: "9d3af553f36d0c22bab3fee07531babe31edff5e",
  after: "5a2883fe669ea8c9db590d72df765b320254b999",
};
assert.equal(process.platform, "linux");
assert.equal(process.env.VIZE_PERF_BUDGET_SCALE, "1");
assert(!fs.existsSync(output), "fresh evidence directory is required");
fs.mkdirSync(output);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const write = (file, value) =>
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n", { flag: "wx" });
const git = (...args) => {
  const result = spawnSync("git", args, { cwd: repo, encoding: "utf8", timeout: 120000 });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
};
const run = async (command, args, cwd, label, env = process.env, deadlineMs = 900000) => {
  const stdout = fs.openSync(path.join(output, `${label}.stdout`), "wx");
  const stderr = fs.openSync(path.join(output, `${label}.stderr`), "wx");
  const started = process.hrtime.bigint();
  const child = spawn(command, args, { cwd, env, stdio: ["ignore", stdout, stderr] });
  let error = null;
  child.once("error", (failure) => {
    error = failure.message;
  });
  const timeout = setTimeout(() => {
    error = "finite original process cleanup deadline exceeded";
    child.kill("SIGKILL");
  }, deadlineMs);
  const status = await new Promise((resolve) =>
    child.once("close", (code, signal) => resolve({ code, signal })),
  );
  clearTimeout(timeout);
  fs.closeSync(stdout);
  fs.closeSync(stderr);
  const result = {
    command,
    args,
    ...status,
    error,
    elapsedMs: Number(process.hrtime.bigint() - started) / 1e6,
  };
  write(path.join(output, `${label}.process.json`), result);
  return result;
};
const requireSuccess = (result, label) => {
  assert.equal(result.code, 0, `${label}: ${JSON.stringify(result)}`);
  assert.equal(result.signal, null);
  assert.equal(result.error, null);
};
const originalFiles = git("ls-tree", "-r", "--name-only", heads.before).split("\n");
const sourceFiles = originalFiles.filter(
  (file) =>
    file.endsWith(".rs") ||
    file.startsWith("tests/") ||
    [
      "Cargo.toml",
      "Cargo.lock",
      "rust-toolchain.toml",
      "package.json",
      "pnpm-lock.yaml",
      ".cargo/config.toml",
    ].includes(file),
);
const changed = git("diff", "--name-only", heads.before, heads.after).split("\n");
assert.deepEqual(
  changed.sort(),
  [
    "crates/vize_maestro/src/ide/workspace_symbols.rs",
    "crates/vize_maestro/src/ide/workspace_symbols/sources.rs",
    "crates/vize_maestro/src/ide/workspace_symbols/tests.rs",
    "crates/vize_maestro/src/ide/workspace_symbols/tests/borrowed_descriptor.rs",
  ].sort(),
);
write(path.join(output, "campaign.json"), {
  heads,
  changed,
  sourceFiles,
  hardware: {
    cpus: os.cpus().length,
    model: os.cpus()[0]?.model,
    memoryBytes: os.totalmem(),
    kernel: os.release(),
  },
  controls: {
    RAYON_NUM_THREADS: process.env.RAYON_NUM_THREADS,
    GOMAXPROCS: process.env.GOMAXPROCS ?? null,
    node: process.version,
    VIZE_PERF_BUDGET_SCALE: "1",
  },
  originalHarnessChanges: 0,
  originalOrder: ["before", "after", "after", "before"],
  instrumentation:
    "existing strict source receipt and raw-wire capture plus a passive separate 50ms /proc sampler; original workload, cycles, budgets and publishers unchanged",
});
const receipts = {};
for (const [role, head] of Object.entries(heads)) {
  git("checkout", "--detach", head);
  assert.equal(git("status", "--porcelain", "--untracked-files=no"), "");
  fs.writeFileSync(path.join(output, `${role}.source-tree.txt`), git("ls-tree", "-r", head) + "\n");
  requireSuccess(
    await run(
      "cargo",
      ["build", "--profile", "ci", "-p", "vize", "--features", "legacy"],
      repo,
      `${role}-build`,
    ),
    `${role} source build`,
  );
  requireSuccess(
    await run(
      process.execPath,
      ["tests/differential/build-receipt.ts", "--legacy"],
      repo,
      `${role}-receipt`,
    ),
    `${role} receipt`,
  );
  const binary = path.join(repo, "target/ci/vize");
  receipts[role] = JSON.parse(fs.readFileSync(`${binary}.differential-build.json`, "utf8"));
  assert.equal(receipts[role].sourceRevision, head);
  assert.equal(receipts[role].binarySha256, hash(fs.readFileSync(binary)));
  fs.copyFileSync(binary, path.join(output, `${role}.vize`));
  fs.copyFileSync(
    `${binary}.differential-build.json`,
    path.join(output, `${role}.build-receipt.json`),
  );
}
requireSuccess(
  await run(
    "cargo",
    [
      "test",
      "--locked",
      "--profile",
      "ci",
      "-p",
      "vize_maestro",
      "--lib",
      "workspace_symbols",
      "--",
      "--nocapture",
    ],
    repo,
    "after-original-symbol-tests",
  ),
  "all original and new symbol tests",
);
requireSuccess(await run("cargo", ["fmt", "--check", "--all"], repo, "after-fmt"), "source format");
const backend = fs.realpathSync(
  path.join(repo, "node_modules/@typescript/typescript-linux-x64/lib/tsc"),
);
write(path.join(output, "backend.json"), {
  path: backend,
  sha256: hash(fs.readFileSync(backend)),
  version: spawnSync(backend, ["--version"], { encoding: "utf8", timeout: 10000 }).stdout.trim(),
});
const common = {
  ...process.env,
  VIZE_LSP_BIN: path.join(repo, "target/ci/vize"),
  VIZE_LSP_REQUIRE_SOURCE_BUILD: "1",
  VIZE_LSP_BUILD_RECIPE: "cargo build --profile ci -p vize --features legacy",
  VIZE_PERF_BUDGET_SCALE: "1",
  VIZE_TEST_TSGO: backend,
  CORSA_PATH: backend,
  VIZE_CORSA_DEV_PATHS: "0",
};
delete common.VIZE_LSP_CURRENT_BASELINE;
const results = [];
for (const [index, role] of ["before", "after", "after", "before"].entries()) {
  git("checkout", "--detach", heads[role]);
  fs.copyFileSync(path.join(output, `${role}.vize`), path.join(repo, "target/ci/vize"));
  fs.chmodSync(path.join(repo, "target/ci/vize"), 0o755);
  fs.copyFileSync(
    path.join(output, `${role}.build-receipt.json`),
    path.join(repo, "target/ci/vize.differential-build.json"),
  );
  const label = `${index + 1}-${role}`;
  const custody = path.join(repo, "target/differential/lsp-sessions");
  fs.rmSync(custody, { recursive: true, force: true });
  const metrics = path.join(repo, "target/vize-tests/metrics/misskey-lsp-churn");
  fs.rmSync(metrics, { recursive: true, force: true });
  const sampler = spawn(
    "python3",
    [path.join(driver, "sample.py"), common.VIZE_LSP_BIN, path.join(output, `${label}.rss.jsonl`)],
    { stdio: ["pipe", "ignore", "pipe"] },
  );
  let samplerError = "";
  sampler.stderr.on("data", (bytes) => {
    samplerError += bytes;
  });
  const stopped = new Promise((resolve) =>
    sampler.once("close", (code, signal) => resolve({ code, signal })),
  );
  const result = await run(
    process.execPath,
    ["--test", "--test-concurrency=1", "tests/performance/lsp-churn-stress.test.ts"],
    repo,
    label,
    common,
    350000,
  );
  sampler.stdin.end("stop\n");
  const observed = await stopped;
  assert.equal(observed.code, 0, samplerError);
  assert.equal(observed.signal, null);
  assert.equal(git("status", "--porcelain", "--untracked-files=no"), "");
  assert.equal(hash(fs.readFileSync(common.VIZE_LSP_BIN)), receipts[role].binarySha256);
  fs.cpSync(custody, path.join(output, `${label}.custody`), { recursive: true });
  fs.cpSync(metrics, path.join(output, `${label}.metrics`), { recursive: true });
  const measured = JSON.parse(fs.readFileSync(path.join(metrics, "metrics.json"), "utf8"));
  assert.equal(measured.commit, heads[role]);
  assert.equal(measured.budget.scale, 1);
  assert.equal(measured.budget.maxPeakRssMiB, 128);
  assert.equal(measured.budget.maxPeakProcessTreeRssMiB, 384);
  results.push({
    label,
    role,
    ...result,
    status: measured.status,
    failure: measured.failure,
    peakRssKiB: measured.peakRssKiB,
    peakProcessTreeRssKiB: measured.peakProcessTreeRssKiB,
    publishes: measured.publishes,
    cycleStats: measured.cycleStats,
  });
}
for (const role of ["before", "after"]) {
  git("checkout", "--detach", heads[role]);
  fs.copyFileSync(path.join(output, `${role}.vize`), common.VIZE_LSP_BIN);
  fs.chmodSync(common.VIZE_LSP_BIN, 0o755);
  fs.copyFileSync(
    path.join(output, `${role}.build-receipt.json`),
    `${common.VIZE_LSP_BIN}.differential-build.json`,
  );
  fs.rmSync(path.join(repo, "target/differential/lsp-sessions"), { recursive: true, force: true });
  requireSuccess(
    await run(
      process.execPath,
      [path.join(driver, "symbols.mjs"), repo, path.join(output, `${role}.symbols`)],
      repo,
      `${role}-symbols`,
      common,
      350000,
    ),
    `${role} whole symbol campaign`,
  );
  fs.cpSync(
    path.join(repo, "target/differential/lsp-sessions"),
    path.join(output, `${role}.symbols/custody`),
    { recursive: true },
  );
}
write(path.join(output, "measurements.json"), {
  results,
  interpretation:
    "Before failures remain failures; after must pass every original gate. Sampled gains are not causal allocation attribution, cold-cache, startup p95 or a 10x result.",
});
requireSuccess(
  await run(process.execPath, [path.join(driver, "verify.mjs"), output], repo, "whole-equivalence"),
  "whole packet equivalence",
);
for (const result of results.filter((result) => result.role === "after"))
  requireSuccess(result, result.label);
console.log(JSON.stringify(results, null, 2));
