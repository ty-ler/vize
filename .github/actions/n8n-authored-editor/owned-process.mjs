import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
      { checkout, pid: receipt.pid, executable, stat, observedAt: new Date().toISOString() },
      null,
      2,
    )}\n`,
  );
  return receipt.pid;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const [output, binary] = process.argv.slice(2);
  assert.ok(output && binary, "output directory and source binary are required");
  process.stdout.write(String(authenticateProcess(output, binary)));
}
