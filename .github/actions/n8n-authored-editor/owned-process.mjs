import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Bracket the real-time sample with the same monotonic clock used by perf. */
export function clockReceipt() {
  const beforeNs = process.hrtime.bigint();
  const wallTimeMs = Date.now();
  const afterNs = process.hrtime.bigint();
  return { beforeNs: String(beforeNs), wallTimeMs, afterNs: String(afterNs) };
}

/** Authenticate the actual provider process before attaching observers. */
export function authenticateProcess(output, binary) {
  const receipt = JSON.parse(fs.readFileSync(path.join(output, "consumer/process.json")));
  const checkout = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  assert.equal(receipt.checkout, checkout);
  assert.ok(Number.isSafeInteger(receipt.pid) && receipt.pid > 0);
  const executable = fs.realpathSync(`/proc/${receipt.pid}/exe`);
  assert.equal(executable, fs.realpathSync(binary));
  const stat = fs.readFileSync(`/proc/${receipt.pid}/stat`, "utf8");
  fs.writeFileSync(
    path.join(output, "owned-process.json"),
    `${JSON.stringify(
      {
        checkout,
        pid: receipt.pid,
        executable,
        stat,
        observedAt: new Date().toISOString(),
        clock: clockReceipt(),
      },
      null,
      2,
    )}\n`,
  );
  return receipt.pid;
}

/** A Linux birth identity survives CPU/stat changes and refuses PID reuse. */
export function processBirthIdentity(stat) {
  const closing = stat.lastIndexOf(") ");
  assert.ok(closing > 0);
  const pid = stat.slice(0, stat.indexOf(" "));
  const fields = stat
    .slice(closing + 2)
    .trim()
    .split(/\s+/u);
  assert.match(pid, /^[1-9][0-9]*$/u);
  assert.ok(fields.length >= 20);
  assert.match(fields[19], /^[0-9]+$/u);
  return [pid, fields[19]];
}

/** Stop only the same authenticated provider when the collector itself exits. */
export function stopAuthenticatedProcess(output) {
  const receipt = JSON.parse(fs.readFileSync(path.join(output, "owned-process.json"), "utf8"));
  assert.ok(Number.isSafeInteger(receipt.pid) && receipt.pid > 0);
  let stat;
  try {
    stat = fs.readFileSync(`/proc/${receipt.pid}/stat`, "utf8");
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "ESRCH") return false;
    throw error;
  }
  assert.deepEqual(processBirthIdentity(stat), processBirthIdentity(receipt.stat));
  try {
    assert.equal(fs.realpathSync(`/proc/${receipt.pid}/exe`), receipt.executable);
    process.kill(receipt.pid, "SIGTERM");
  } catch (error) {
    // Exit can remove /proc or race the signal after the complete stat read.
    // Other errors and a different live owner/executable remain refusals.
    if (error.code === "ENOENT" || error.code === "ESRCH") return false;
    throw error;
  }
  fs.writeFileSync(
    path.join(output, "owned-process-stop.json"),
    `${JSON.stringify(
      {
        pid: receipt.pid,
        birth: processBirthIdentity(stat),
        signal: "SIGTERM",
        requested: true,
        clock: clockReceipt(),
      },
      null,
      2,
    )}\n`,
  );
  return true;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  if (process.argv[2] === "--stop") {
    assert.ok(process.argv[3], "owned output directory is required");
    process.stdout.write(String(stopAuthenticatedProcess(process.argv[3])));
  } else {
    const [output, binary] = process.argv.slice(2);
    assert.ok(output && binary, "output directory and source binary are required");
    process.stdout.write(String(authenticateProcess(output, binary)));
  }
}
