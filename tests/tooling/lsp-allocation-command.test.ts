import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { command, successful } from "../performance/support/allocation-diagnostic/command.ts";
import { sha256 } from "../differential/sha256.ts";

test("a genuine owned command retains complete failed stdout/stderr and cannot turn exit17 green", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vize-allocation-command-law-"));
  try {
    const directory = path.join(root, "command");
    const result = await command(
      directory,
      process.execPath,
      [
        "-e",
        'process.stdout.write("whole output\\n");process.stderr.write("whole refusal\\n");process.exitCode=17',
      ],
      root,
      process.env,
    );
    assert.equal(result.code, 17);
    assert.equal(result.signal, null);
    assert.equal(result.failure, null);
    assert.equal(result.acceptanceCredit, "none");
    assert(result.actualPid && result.actualPid > 0);
    assert(BigInt(result.endedNs) >= BigInt(result.startedNs));
    for (const [name, expected] of [
      ["stdout", "whole output\n"],
      ["stderr", "whole refusal\n"],
    ] as const) {
      const bytes = fs.readFileSync(path.join(directory, `${name}.bin`));
      assert.equal(bytes.toString(), expected);
      assert.equal(result.streams[name].sha256, sha256(bytes));
    }
    assert.throws(() => successful(result));
    await assert.rejects(
      () => command(directory, process.execPath, ["-e", "process.exit(0)"], root, process.env),
      /stale command receipt/,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("orchestration timeout preserves the actual owned-child termination and explicit incompleteness", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vize-allocation-timeout-law-"));
  try {
    const result = await command(
      path.join(root, "command"),
      process.execPath,
      ["-e", "setInterval(()=>{},1000)"],
      root,
      process.env,
      50,
    );
    assert.match(result.failure!, /50ms orchestration bound/);
    assert.equal(result.code, null);
    assert.equal(result.signal, "SIGTERM");
    assert.throws(() => successful(result));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test(
  "an actual owned child ignoring SIGTERM is finitely killed and reaped with its full refusal",
  { timeout: 10_000 },
  async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "vize-allocation-kill-law-"));
    try {
      const directory = path.join(root, "command");
      const result = await command(
        directory,
        process.execPath,
        [
          "-e",
          'process.on("SIGTERM",()=>process.stderr.write("owned SIGTERM ignored\\n"));process.stdout.write("owned ready\\n");setInterval(()=>{},1000)',
        ],
        root,
        process.env,
        250,
      );
      assert.equal(fs.readFileSync(path.join(directory, "stdout.bin"), "utf8"), "owned ready\n");
      assert.equal(
        fs.readFileSync(path.join(directory, "stderr.bin"), "utf8"),
        "owned SIGTERM ignored\n",
      );
      assert.equal(result.code, null);
      assert.equal(result.signal, "SIGKILL");
      assert.match(result.failure!, /250ms orchestration bound/);
      assert.throws(() => successful(result));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  },
);
