import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { sha256 } from "../../../differential/sha256.ts";

export const json = (file: string, value: unknown) =>
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });

/** Retain whole command streams and the actual exit; never translate an original RED to GREEN. */
export async function command(
  directory: string,
  executable: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  timeoutMs = 1_200_000,
) {
  assert(!fs.existsSync(directory), "stale command receipt refused");
  fs.mkdirSync(directory, { recursive: true });
  const streams = { stdout: 0, stderr: 0 };
  for (const stream of Object.keys(streams))
    fs.writeFileSync(path.join(directory, `${stream}.bin`), "", { flag: "wx" });
  const startedNs = process.hrtime.bigint().toString();
  const child = spawn(executable, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
  let failure: string | null = null;
  const stop = (reason: string) => {
    failure ??= reason;
    child.kill("SIGTERM");
  };
  const timer = setTimeout(
    () => stop(`owned command exceeds explicit ${timeoutMs}ms orchestration bound`),
    timeoutMs,
  );
  for (const stream of ["stdout", "stderr"] as const)
    child[stream].on("data", (bytes: Buffer) => {
      if (streams[stream] + bytes.length > 64 * 1024 * 1024) {
        stop("whole command stream exceeds explicit64MiB bound");
        return;
      }
      fs.appendFileSync(path.join(directory, `${stream}.bin`), bytes);
      streams[stream] += bytes.length;
    });
  child.on("error", (error) => {
    failure ??= error.message;
  });
  const result = await new Promise<{ code: number | null; signal: string | null }>((resolve) =>
    child.once("close", (code, signal) => resolve({ code, signal })),
  );
  clearTimeout(timer);
  const receipt = {
    executable,
    args,
    cwd,
    actualPid: child.pid ?? null,
    startedNs,
    endedNs: process.hrtime.bigint().toString(),
    ...result,
    failure,
    environment: Object.fromEntries(
      [
        "CARGO_TARGET_DIR",
        "RAYON_NUM_THREADS",
        "VIZE_LSP_BUILD_RECIPE",
        "VIZE_PERF_BUDGET_SCALE",
        "VIZE_LSP_MEMORY_BINDING",
        "VIZE_LSP_ALLOCATION_DIAGNOSTIC",
        "VIZE_TRACE_EDITOR_PREPARATION",
        "CORSA_PATH",
        "VIZE_TEST_TSGO",
      ].map((key) => [key, env[key] ?? null]),
    ),
    streams: Object.fromEntries(
      Object.entries(streams).map(([stream, bytes]) => [
        stream,
        { bytes, sha256: sha256(fs.readFileSync(path.join(directory, `${stream}.bin`))) },
      ]),
    ),
    acceptanceCredit: "none",
  };
  json(path.join(directory, "receipt.json"), receipt);
  return receipt;
}

export function successful(result: Awaited<ReturnType<typeof command>>): void {
  assert.equal(result.failure, null);
  assert.equal(result.signal, null);
  assert.equal(result.code, 0, "actual prerequisite command failed; whole raw receipt retained");
}
