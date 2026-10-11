import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { authenticateProcess } from "./owned-process.mjs";

const checkout = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const helper = fileURLToPath(new URL("./owned-process.mjs", import.meta.url));

function workspace(t, receipt) {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), "vize-owned-profile-process-"));
  t.after(() => fs.rmSync(output, { recursive: true, force: true }));
  fs.mkdirSync(path.join(output, "consumer"));
  fs.writeFileSync(path.join(output, "consumer/process.json"), JSON.stringify(receipt));
  return output;
}

test("the actual receipt refuses a different checkout before any process observation", (t) => {
  const output = workspace(t, { checkout: "different-checkout", pid: process.pid });
  assert.throws(() => authenticateProcess(output, process.execPath), assert.AssertionError);
  assert.equal(fs.existsSync(path.join(output, "owned-process.json")), false);
});

test("the actual receipt refuses unsafe or nonpositive process IDs", (t) => {
  for (const pid of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, "123"]) {
    const output = workspace(t, { checkout, pid });
    assert.throws(() => authenticateProcess(output, process.execPath), assert.AssertionError);
    assert.equal(fs.existsSync(path.join(output, "owned-process.json")), false);
  }
});

test(
  "the actual Linux child retains its executable, checkout and complete process stat",
  {
    skip: process.platform !== "linux",
  },
  async (t) => {
    const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
      stdio: "ignore",
    });
    t.after(() => child.kill());
    await new Promise((resolve, reject) => {
      child.once("spawn", resolve);
      child.once("error", reject);
    });
    const output = workspace(t, { checkout, pid: child.pid });
    const stdout = execFileSync(process.execPath, [helper, output, process.execPath], {
      encoding: "utf8",
    });
    assert.equal(stdout, String(child.pid));
    const owned = JSON.parse(fs.readFileSync(path.join(output, "owned-process.json")));
    assert.equal(owned.checkout, checkout);
    assert.equal(owned.pid, child.pid);
    assert.equal(owned.executable, fs.realpathSync(`/proc/${child.pid}/exe`));
    assert.equal(owned.executable, fs.realpathSync(process.execPath));
    assert.ok(owned.stat.startsWith(`${child.pid} (`));
    assert.ok(Number.isFinite(Date.parse(owned.observedAt)));
  },
);

test(
  "the actual Linux process refuses a different executable without recording ownership",
  {
    skip: process.platform !== "linux",
  },
  (t) => {
    const output = workspace(t, { checkout, pid: process.pid });
    assert.throws(() => authenticateProcess(output, "/bin/sh"), assert.AssertionError);
    assert.equal(fs.existsSync(path.join(output, "owned-process.json")), false);
  },
);
