import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { sha256 } from "../../../differential/sha256.ts";

export type ProcessIdentity = {
  pid: number;
  parentPid: number;
  startTicks: string;
  executable: string;
  executableSha256: string;
  executableDev: string;
  executableIno: string;
  executableSize: string;
  executableMtimeNs: string;
};

function stat(pid: number, procRoot: string) {
  assert(Number.isSafeInteger(pid) && pid > 0);
  const text = fs.readFileSync(path.join(procRoot, String(pid), "stat"), "utf8");
  assert.equal(Number(text.slice(0, text.indexOf(" "))), pid);
  const fields = text
    .slice(text.lastIndexOf(")") + 2)
    .trim()
    .split(/\s+/);
  assert.match(fields[19] ?? "", /^\d+$/);
  assert(Number.isSafeInteger(Number(fields[1])));
  return { parentPid: Number(fields[1]), startTicks: fields[19] };
}

/** Both stat reads bind the executable hash to this actual process birth. */
export function identity(
  pid: number,
  procRoot = "/proc",
  expected?: ProcessIdentity,
): ProcessIdentity {
  const before = stat(pid, procRoot);
  const file = path.join(procRoot, String(pid), "exe");
  const executable = fs.realpathSync(file);
  const metadata = fs.statSync(file, { bigint: true });
  const dimensions = {
    executableDev: String(metadata.dev),
    executableIno: String(metadata.ino),
    executableSize: String(metadata.size),
    executableMtimeNs: String(metadata.mtimeNs),
  };
  if (expected) {
    assert.equal(executable, expected.executable);
    for (const [key, value] of Object.entries(dimensions))
      assert.equal(value, expected[key as keyof ProcessIdentity]);
  }
  const executableSha256 = expected?.executableSha256 ?? sha256(fs.readFileSync(file));
  assert.deepEqual(stat(pid, procRoot), before, "process identity changed during authentication");
  return { pid, ...before, executable, executableSha256, ...dimensions };
}

export function assertIdentity(actual: ProcessIdentity, expected: ProcessIdentity): void {
  assert.deepEqual(actual, expected, "PID reuse, parent or executable mismatch");
}

/** Missing processes are an explicit failed observation, never zero RSS. */
export function smaps(expected: ProcessIdentity, procRoot = "/proc"): Buffer {
  assertIdentity(identity(expected.pid, procRoot, expected), expected);
  const file = path.join(procRoot, String(expected.pid), "smaps");
  const bytes = fs.readFileSync(file);
  assert(bytes.length > 0 && bytes.length <= 4 * 1024 * 1024, "bounded complete smaps required");
  assert.match(bytes.toString("utf8"), /^Rss:\s+\d+\s+kB$/m);
  assertIdentity(identity(expected.pid, procRoot, expected), expected);
  return bytes;
}

export function disappeared(error: unknown): boolean {
  return (
    error instanceof Error &&
    ["ENOENT", "ESRCH"].includes(String((error as NodeJS.ErrnoException).code))
  );
}
