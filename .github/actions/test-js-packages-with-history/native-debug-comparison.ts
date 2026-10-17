// Diagnostic branch only. The original builders workload and reports own all
// product qualification; this records sizes and an independent debugger check.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { validateNativeHistoryProfile } from "../../../npm/native/scripts/formatter-history-build.mjs";

const directory = path.resolve("target/native-debug-comparison");
fs.mkdirSync(directory, { recursive: true });
const source = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const comparison = process.env.VIZE_NATIVE_CI_DEBUG_COMPARISON;
const receipt: Record<string, unknown> = {
  source,
  comparison,
  runId: process.env.GITHUB_RUN_ID,
  runAttempt: process.env.GITHUB_RUN_ATTEMPT,
  observedAt: new Date().toISOString(),
};
async function hashFile(file: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}
try {
  assert.equal(source, process.env.GITHUB_SHA);
  assert.equal(execFileSync("git", ["diff", "--binary", "HEAD"]).length, 0);
  const history = path.resolve("npm/native/.artifacts/native/formatter-history");
  const build = JSON.parse(fs.readFileSync(path.join(history, "build-receipt.json"), "utf8"));
  assert.equal(build.source.head, source);
  validateNativeHistoryProfile(build.emitted.cargo.profile);
  receipt.profile = build.emitted.cargo.profile;
  receipt.command = build.process.command;
  receipt.toolchain = build.toolchain;
  receipt.features = build.emitted.cargo.features;
  const addon = path.join(history, "formatter-observe.node");
  const before = await hashFile(addon);
  assert.equal(before, build.frozen.sha256);
  receipt.addon = { bytes: fs.statSync(addon).size, sha256: before };
  const reports = [];
  for (const [file, expectedPasses] of [
    ["public-native-report.json", 25],
    ["public-vite-report.json", 27],
  ] as const) {
    const report = JSON.parse(fs.readFileSync(path.join(history, file), "utf8")) as {
      rows: { id: string; state: string; passes: unknown[] }[];
    };
    const rows = report.rows.map((row) => ({
      id: row.id,
      state: row.state,
      passes: row.passes.length,
    }));
    const passes = rows.reduce((sum, row) => sum + row.passes, 0);
    reports.push({ file, sha256: await hashFile(path.join(history, file)), rows, passes });
    receipt.reports = reports;
    assert.equal(rows.length, 9);
    assert.equal(passes, expectedPasses);
    assert(rows.every((row) => row.state === "matched-reference"));
  }
  const gdbVersion = spawnSync("gdb", ["--version"], { encoding: "utf8" });
  if (gdbVersion.status !== 0) {
    receipt.gdb = { available: false, error: gdbVersion.error?.message ?? gdbVersion.stderr };
  } else {
    const tokenSource = "crates/vize_vitrine/src/napi/build_token.rs";
    const lines = fs.readFileSync(tokenSource, "utf8").split("\n");
    const line =
      lines.findIndex((value) => value.includes('option_env!("VIZE_NATIVE_BUILD_TOKEN")')) + 1;
    assert(line > 0);
    const target = `${path.resolve(tokenSource)}:${line}`;
    const command = [
      "--batch",
      "-nx",
      "-iex",
      "set auto-load off",
      "-iex",
      "set debuginfod enabled off",
      "-ex",
      "set pagination off",
      "-ex",
      "set disable-randomization off",
      "-ex",
      "set print frame-arguments none",
      "-ex",
      "set print entry-values no",
      "-ex",
      "set breakpoint pending on",
      "-ex",
      `tbreak ${target}`,
      "-ex",
      "run",
      "-ex",
      "echo VIZE_NATIVE_LINE_FRAME_BEGIN\\n",
      "-ex",
      "bt 8",
      "-ex",
      "echo VIZE_NATIVE_LINE_FRAME_END\\n",
      "-ex",
      "continue",
      "--args",
      process.execPath,
      "-e",
      "const token = require(process.argv[1]).getNativeBuildToken(); if (!/^[0-9a-f]{32}$/.test(token)) process.exit(1);",
      addon,
    ];
    const started = performance.now();
    const result = spawnSync("gdb", command, {
      encoding: "utf8",
      timeout: 60_000,
      maxBuffer: 8 * 1024 * 1024,
    });
    fs.writeFileSync(path.join(directory, "gdb.stdout.txt"), result.stdout ?? "");
    fs.writeFileSync(path.join(directory, "gdb.stderr.txt"), result.stderr ?? "");
    receipt.gdb = {
      available: true,
      version: gdbVersion.stdout,
      command: ["gdb", ...command],
      source: tokenSource,
      line,
      status: result.status,
      signal: result.signal,
      error: result.error?.message ?? null,
      seconds: (performance.now() - started) / 1000,
    };
    assert.equal(result.status, 0);
    assert.equal(result.signal, null);
    assert.match(result.stdout, /Temporary breakpoint \d+,/);
    const frame = result.stdout
      .split("VIZE_NATIVE_LINE_FRAME_BEGIN\n")[1]
      ?.split("VIZE_NATIVE_LINE_FRAME_END")[0];
    assert(frame);
    assert.match(frame, /build_token\.rs:\d+/);
    assert.match(result.stdout, /exited normally/);
    assert.equal(await hashFile(addon), before, "debugger changed the qualified artifact");
  }
} catch (error) {
  receipt.error =
    error instanceof Error ? { name: error.name, message: error.message } : String(error);
  process.exitCode = 1;
} finally {
  fs.writeFileSync(
    path.join(directory, "observation.json"),
    JSON.stringify(receipt, null, 2) + "\n",
  );
  console.log(JSON.stringify(receipt, null, 2));
}
