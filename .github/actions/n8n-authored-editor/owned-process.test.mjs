import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  authenticateProcess,
  clockReceipt,
  processBirthIdentity,
  stopAuthenticatedProcess,
} from "./owned-process.mjs";

const checkout = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const helper = fileURLToPath(new URL("./owned-process.mjs", import.meta.url));

function workspace(t, receipt) {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), "vize-owned-profile-process-"));
  t.after(() => fs.rmSync(output, { recursive: true, force: true }));
  fs.mkdirSync(path.join(output, "consumer"));
  fs.writeFileSync(path.join(output, "consumer/process.json"), JSON.stringify(receipt));
  return output;
}

test("actual clock receipts bracket UTC with increasing monotonic samples", () => {
  const before = process.hrtime.bigint();
  const first = clockReceipt();
  const second = clockReceipt();
  const after = process.hrtime.bigint();
  assert.ok(before <= BigInt(first.beforeNs));
  assert.ok(BigInt(first.beforeNs) <= BigInt(first.afterNs));
  assert.ok(BigInt(first.afterNs) <= BigInt(second.beforeNs));
  assert.ok(BigInt(second.beforeNs) <= BigInt(second.afterNs));
  assert.ok(BigInt(second.afterNs) <= after);
  for (const receipt of [first, second]) {
    assert.ok(Number.isSafeInteger(receipt.wallTimeMs));
    assert.ok(Math.abs(Date.now() - receipt.wallTimeMs) < 1000);
  }
});

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

test("Linux birth parsing retains starttime beyond process names with closing parentheses", () => {
  const stat = `42 (name ) has spaces) S ${Array.from({ length: 19 }, (_, n) => n + 1).join(" ")} 999`;
  assert.deepEqual(processBirthIdentity(stat), ["42", "19"]);
  assert.throws(() => processBirthIdentity("invalid"), assert.AssertionError);
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
    assert.ok(BigInt(owned.clock.beforeNs) <= BigInt(owned.clock.afterNs));
    assert.ok(Number.isSafeInteger(owned.clock.wallTimeMs));
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

test(
  "Linux cleanup refuses a changed birth and signals only the authenticated child",
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
    authenticateProcess(output, process.execPath);
    const receiptFile = path.join(output, "owned-process.json");
    const receipt = JSON.parse(fs.readFileSync(receiptFile, "utf8"));
    const closing = receipt.stat.lastIndexOf(") ");
    const fields = receipt.stat
      .slice(closing + 2)
      .trim()
      .split(/\s+/u);
    fields[19] = String(BigInt(fields[19]) + 1n);
    fs.writeFileSync(
      receiptFile,
      JSON.stringify({
        ...receipt,
        stat: `${receipt.stat.slice(0, closing + 2)}${fields.join(" ")}`,
      }),
    );
    assert.throws(() => stopAuthenticatedProcess(output), assert.AssertionError);
    assert.equal(fs.existsSync(path.join(output, "owned-process-stop.json")), false);
    process.kill(child.pid, 0);
    fs.writeFileSync(receiptFile, JSON.stringify(receipt));
    const exited = new Promise((resolve) => child.once("exit", resolve));
    assert.equal(stopAuthenticatedProcess(output), true);
    await exited;
    const stopped = JSON.parse(
      fs.readFileSync(path.join(output, "owned-process-stop.json"), "utf8"),
    );
    assert.deepEqual(stopped.birth, processBirthIdentity(receipt.stat));
    assert.equal(stopped.signal, "SIGTERM");
    assert.equal(stopped.requested, true);
    assert.equal(stopAuthenticatedProcess(output), false);
  },
);

test(
  "Linux post-stat disappearance accepts only exact ENOENT/ESRCH and preserves mismatches",
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
    authenticateProcess(output, process.execPath);
    const receipt = JSON.parse(fs.readFileSync(path.join(output, "owned-process.json"), "utf8"));
    for (const operation of ["exe", "signal"]) {
      for (const code of ["ENOENT", "ESRCH", "EACCES", "EPERM"]) {
        const failure = Object.assign(new Error(`whole post-stat ${operation} ${code}`), { code });
        let signals = 0;
        t.mock.method(fs, "realpathSync", () => {
          if (operation === "exe") throw failure;
          return receipt.executable;
        });
        t.mock.method(process, "kill", () => {
          signals += 1;
          throw failure;
        });
        if (code === "ENOENT" || code === "ESRCH")
          assert.equal(stopAuthenticatedProcess(output), false);
        else
          assert.throws(
            () => stopAuthenticatedProcess(output),
            (error) => error === failure,
          );
        assert.equal(signals, operation === "exe" ? 0 : 1);
        assert.equal(fs.existsSync(path.join(output, "owned-process-stop.json")), false);
        t.mock.restoreAll();
      }
    }
    let signals = 0;
    t.mock.method(fs, "realpathSync", () => `${receipt.executable}.different`);
    t.mock.method(process, "kill", () => {
      signals += 1;
    });
    assert.throws(() => stopAuthenticatedProcess(output), assert.AssertionError);
    assert.equal(signals, 0);
    assert.equal(fs.existsSync(path.join(output, "owned-process-stop.json")), false);
    t.mock.restoreAll();
    process.kill(child.pid, 0);
  },
);
