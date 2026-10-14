import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  openSync,
  closeSync,
  opendirSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  type Dir,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { commandPhase, processChannels } from "./support/pty-evidence.ts";

void test("PTY phases identify Git transport stages without retaining argument values", () => {
  const phases = [
    ["git", "-C", "/private/credential", "pull", "origin", "main"],
    ["git", "fetch", "https://credential@private.invalid/index"],
    ["git", "remote-https", "origin", "https://credential@private.invalid/index"],
    ["/usr/lib/git-core/git-remote-https", "origin", "private-value"],
    ["ssh", "private-host", "private-command"],
    ["/private/unknown-credential", "private-value"],
    ["moon", "update"],
    ["git", "unknown-operation"],
  ].map(commandPhase);
  assert.deepEqual(phases, [
    "git:pull",
    "git:fetch",
    "git:remote-https",
    "git-remote-https",
    "ssh",
    "other",
    "moon:update",
    "git",
  ]);
  assert.doesNotMatch(JSON.stringify(phases), /private|credential@|unknown-operation/);
});

void test("PTY Git phases distinguish global option values from the actual subcommand", () => {
  const phases = [
    ["git", "config", "credential.helper", "pull"],
    ["git", "-C", "fetch", "status"],
    ["git", "-C", "fetch", "config", "credential.helper", "pull"],
    ["git", "-c", "credential.helper=fetch", "config", "credential.helper", "pull"],
    ["git", "-Cprivate", "-ccredential.helper=fetch", "--no-pager", "pull"],
    ["git", "--git-dir=fetch", "--work-tree", "pull", "remote-https"],
    ["git", "--namespace=fetch", "--config-env=credential.helper=PRIVATE_VALUE", "config"],
    ["git", "-C", "", "-C", "private", "fetch"],
    ["git", "-C"],
    ["git", "-c", ""],
    ["git", "--config-env=fetch", "pull"],
    ["git", "--unknown", "private", "pull"],
    ["git", "--", "fetch"],
    ["git", "unknown-operation", "fetch"],
    ["moon", "run", "update"],
  ].map(commandPhase);
  assert.deepEqual(phases, [
    "git:config",
    "git",
    "git:config",
    "git:config",
    "git:pull",
    "git:remote-https",
    "git:config",
    "git:fetch",
    "git",
    "git",
    "git",
    "git",
    "git",
    "git",
    "moon:run",
  ]);
  assert.doesNotMatch(JSON.stringify(phases), /private|credential|PRIVATE_VALUE|unknown/);
});

void test("PTY channel scans close their directory at both entry and emitted-channel bounds", () => {
  const observations = [false, true].map((anonymous) => {
    const root = mkdtempSync(path.join(tmpdir(), "vize-pty-channels-"));
    try {
      mkdirSync(path.join(root, "fd"));
      for (let index = 0; index < 300; index += 1) {
        const target = anonymous ? `pipe:[${index}]` : `/private/credential-${index}`;
        symlinkSync(target, path.join(root, "fd", String(index)));
      }
      const count = { examined: 0, closed: false };
      const observed = (directory: string): Pick<Dir, "readSync" | "closeSync"> => {
        const entries = opendirSync(directory);
        return {
          readSync: () => {
            const entry = entries.readSync();
            if (entry !== null) count.examined += 1;
            return entry;
          },
          closeSync: () => {
            entries.closeSync();
            count.closed = true;
          },
        };
      };
      const channels = processChannels(root, observed);
      return { ...count, channels: channels.size };
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  assert.deepEqual(observations, [
    { examined: 256, closed: true, channels: 0 },
    { examined: 64, closed: true, channels: 64 },
  ]);
});

function childrenOf(parent: number): number[] {
  return readdirSync("/proc")
    .filter((name) => /^\d+$/u.test(name))
    .filter((name) => {
      try {
        const stat = readFileSync(`/proc/${name}/stat`, "latin1");
        return (
          Number(
            stat
              .slice(stat.lastIndexOf(")") + 1)
              .trim()
              .split(/\s+/u)[1],
          ) === parent
        );
      } catch {
        return false;
      }
    })
    .map(Number);
}

void test(
  "PTY Linux evidence relates anonymous pipe and socket owners while excluding file paths",
  { skip: process.platform !== "linux" },
  async () => {
    const root = mkdtempSync(path.join(tmpdir(), "vize-pty-owners-"));
    const privateFile = openSync(path.join(root, "private-credential-file"), "w");
    // Writer and reader share one anonymous pipe; the reader's stdout is a
    // socket to this process; every process also holds a private file as fd 3.
    const shell = spawn("/bin/sh", ["-c", "sleep 30 | sleep 30"], {
      stdio: ["ignore", "pipe", "ignore", privateFile],
    });
    try {
      let sleepers: number[] = [];
      for (let attempt = 0; attempt < 100 && sleepers.length < 2; attempt += 1) {
        await sleep(20);
        sleepers = childrenOf(shell.pid ?? -1);
      }
      assert.equal(sleepers.length, 2);
      const channels = sleepers.map((pid) => processChannels(`/proc/${pid}`));
      const writer = channels.find((owned) => owned.get("1")?.startsWith("pipe:["));
      const reader = channels.find((owned) => owned.get("0")?.startsWith("pipe:["));
      assert.ok(writer !== undefined && reader !== undefined);
      assert.match(writer.get("1") ?? "", /^pipe:\[\d+\]$/u);
      assert.equal(writer.get("1"), reader.get("0"));
      assert.match(reader.get("1") ?? "", /^socket:\[\d+\]$/u);
      for (const owned of channels) assert.equal(owned.has("3"), false);
      const serialized = JSON.stringify(channels.map((owned) => [...owned]));
      assert.doesNotMatch(serialized, /private|credential|\/tmp\//u);
    } finally {
      for (const pid of childrenOf(shell.pid ?? -1)) process.kill(pid, "SIGKILL");
      shell.kill("SIGKILL");
      closeSync(privateFile);
      rmSync(root, { recursive: true, force: true });
    }
  },
);
