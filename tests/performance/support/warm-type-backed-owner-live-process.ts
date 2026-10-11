import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { NativeProcessWitness } from "./warm-type-backed-owner-syscalls.ts";
import { sha256 } from "./warm-type-backed-source.ts";

export function tracerWitness(pid: number) {
  const resolved = spawnSync("sudo", ["-n", "readlink", "-f", `/proc/${pid}/exe`], {
    encoding: "utf8",
  });
  assert.equal(resolved.status, 0, "the independent root observer executable must be observed");
  const executable = resolved.stdout.trim();
  assert.equal(path.basename(executable), "strace");
  const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
  const fields = stat
    .slice(stat.lastIndexOf(")") + 2)
    .trim()
    .split(/\s+/u);
  return {
    pid,
    ppid: Number(fields[1]),
    birthTicks: Number(fields[19]),
    executable,
    executableSHA256: sha256(fs.readFileSync(executable)),
  };
}

export function processWitness(pid: number): NativeProcessWitness {
  const directory = `/proc/${pid}`;
  const stat = fs.readFileSync(path.join(directory, "stat"), "utf8");
  const fields = stat
    .slice(stat.lastIndexOf(")") + 2)
    .trim()
    .split(/\s+/u);
  const executable = fs.realpathSync(path.join(directory, "exe"));
  const descriptors = fs.readdirSync(path.join(directory, "fd")).flatMap((fd) => {
    try {
      return [fs.readlinkSync(path.join(directory, "fd", fd))];
    } catch {
      return [];
    }
  });
  const sockets = fs
    .readFileSync("/proc/net/unix", "utf8")
    .split("\n")
    .map((line) => line.trim().split(/\s+/u))
    .filter(
      (line) =>
        line.length === 8 &&
        line[7].startsWith("/tmp/tsgo-api-") &&
        descriptors.includes(`socket:[${line[6]}]`),
    )
    .map((line) => ({ pipe: line[7], inode: line[6] }));
  return {
    pid,
    ppid: Number(fields[1]),
    birthTicks: Number(fields[19]),
    executable,
    executableSHA256: sha256(fs.readFileSync(executable)),
    threads: fs
      .readdirSync(path.join(directory, "task"))
      .map(Number)
      .toSorted((a, b) => a - b),
    stdin: fs.readlinkSync(path.join(directory, "fd", "0")),
    stdout: fs.readlinkSync(path.join(directory, "fd", "1")),
    sockets,
  };
}

export type ElfIdentity = {
  device: string;
  inode: string;
  size: string;
  mtimeNs: string;
  ctimeNs: string;
  sha256: string;
  elf: boolean;
};

function fileIdentity(fd: number) {
  const value = fs.fstatSync(fd, { bigint: true });
  assert.ok(value.isFile(), "an executable authority must be an actual regular file handle");
  return {
    device: String(value.dev),
    inode: String(value.ino),
    size: String(value.size),
    mtimeNs: String(value.mtimeNs),
    ctimeNs: String(value.ctimeNs),
  };
}

/** Hold the actual executable inode; a path or basename never grants native authority. */
export class ElfHandles {
  private readonly handles = new Map<string, { fd: number; identity: ElfIdentity }>();

  read(file: string): ElfIdentity {
    const fd = fs.openSync(file, fs.constants.O_RDONLY);
    let retained = false;
    try {
      const before = fileIdentity(fd);
      for (const retained of this.handles.values())
        assert.deepEqual(
          fileIdentity(retained.fd),
          {
            device: retained.identity.device,
            inode: retained.identity.inode,
            size: retained.identity.size,
            mtimeNs: retained.identity.mtimeNs,
            ctimeNs: retained.identity.ctimeNs,
          },
          "a retained executable must remain immutable",
        );
      const key = JSON.stringify(before);
      const prior = this.handles.get(key);
      const bytes = fs.readFileSync(fd);
      assert.equal(
        BigInt(bytes.length),
        BigInt(before.size),
        "the complete executable size changed",
      );
      assert.deepEqual(
        fileIdentity(fd),
        before,
        "an executable cannot change during its whole hash",
      );
      const identity = {
        ...before,
        sha256: sha256(bytes),
        elf: bytes.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46])),
      };
      if (prior) {
        assert.deepEqual(identity, prior.identity, "fresh complete executable bytes changed");
        return identity;
      }
      this.handles.set(key, { fd, identity });
      retained = true;
      return identity;
    } finally {
      if (!retained) fs.closeSync(fd);
    }
  }

  close() {
    for (const { fd } of this.handles.values()) fs.closeSync(fd);
    this.handles.clear();
  }
}

function statIdentity(thread: number) {
  const raw = fs.readFileSync(`/proc/${thread}/stat`, "utf8");
  const end = raw.lastIndexOf(") ");
  assert.ok(end > 0 && raw.startsWith(`${thread} (`));
  const fields = raw
    .slice(end + 2)
    .trim()
    .split(/\s+/u);
  const ppid = Number(fields[1]);
  const birthTicks = Number(fields[19]);
  assert.ok(Number.isSafeInteger(ppid) && ppid > 0);
  assert.ok(Number.isSafeInteger(birthTicks) && birthTicks > 0);
  return { raw, state: fields[0], ppid, birthTicks };
}

export type LiveActor = {
  thread: number;
  tgid: number;
  threadBirthTicks: number;
  processBirthTicks: number;
  status: { pid: number; tgid: number; ppid: number };
  threadStat: string;
  processStat: string;
  image: ElfIdentity;
  descriptors: Array<{ fd: number; target: string }>;
  descriptorFailures: Array<{ fd: number; error: string }>;
  process: NativeProcessWitness;
};

/** A checked live snapshot, captured before returning to query/error/retirement handlers. */
export function captureLiveActor(
  thread: number,
  handles: ElfHandles,
  retainPartial: (value: unknown) => void = () => {},
): LiveActor {
  const status = fs.readFileSync(`/proc/${thread}/status`, "utf8");
  const field = (name: string) => {
    const value = Number(status.match(new RegExp(`^${name}:\\s+(\\d+)$`, "mu"))?.[1]);
    assert.ok(Number.isSafeInteger(value) && value > 0, `missing live ${name}`);
    return value;
  };
  const pid = field("Pid");
  const tgid = field("Tgid");
  const ppid = field("PPid");
  assert.equal(pid, thread);
  retainPartial({
    stage: "actual-kernel-status-fields",
    thread,
    source: `/proc/${thread}/status`,
    pid,
    tgid,
    ppid,
  });
  const beforeThread = statIdentity(thread);
  retainPartial({ stage: "actual-thread-starttime-fields", thread, threadStat: beforeThread.raw });
  const beforeProcess = statIdentity(tgid);
  retainPartial({
    stage: "actual-process-starttime-fields",
    thread,
    processStat: beforeProcess.raw,
  });
  assert.equal(beforeThread.ppid, ppid);
  assert.equal(beforeProcess.ppid, ppid);
  assert.ok(
    !["Z", "X", "x"].includes(beforeThread.state),
    "a dead actor cannot grant live authority",
  );
  const executable = fs.readlinkSync(`/proc/${tgid}/exe`);
  retainPartial({ stage: "actual-executable-link", thread, executable });
  const image = handles.read(`/proc/${tgid}/exe`);
  retainPartial({ stage: "actual-retained-executable-handle", thread, executable, image });
  const descriptorFailures: LiveActor["descriptorFailures"] = [];
  const descriptorNames = fs.readdirSync(`/proc/${tgid}/fd`);
  const descriptors = descriptorNames.flatMap((fd) => {
    try {
      return [{ fd: Number(fd), target: fs.readlinkSync(`/proc/${tgid}/fd/${fd}`) }];
    } catch (error) {
      descriptorFailures.push({
        fd: Number(fd),
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  });
  const descriptor = (fd: number) => {
    const target = descriptors.find((entry) => entry.fd === fd)?.target;
    assert.ok(target, `missing actual live FD ${fd}`);
    return target;
  };
  const sockets = fs
    .readFileSync("/proc/net/unix", "utf8")
    .split("\n")
    .map((line) => line.trim().split(/\s+/u))
    .filter(
      (fields) =>
        fields.length === 8 &&
        fields[7].startsWith("/tmp/tsgo-api-") &&
        descriptors.some((entry) => entry.target === `socket:[${fields[6]}]`),
    )
    .map((fields) => ({ pipe: fields[7], inode: fields[6] }));
  const threads = fs
    .readdirSync(`/proc/${tgid}/task`)
    .map(Number)
    .toSorted((a, b) => a - b);
  retainPartial({
    stage: "actual-live-descriptor-ownership",
    thread,
    descriptors,
    descriptorFailures,
    sockets,
    threads,
  });
  assert.ok(threads.includes(thread));
  const afterThread = statIdentity(thread);
  const afterProcess = statIdentity(tgid);
  assert.equal(
    beforeThread.birthTicks,
    afterThread.birthTicks,
    "thread reuse during capture refuses",
  );
  assert.equal(
    beforeProcess.birthTicks,
    afterProcess.birthTicks,
    "process reuse during capture refuses",
  );
  assert.equal(beforeProcess.ppid, afterProcess.ppid);
  assert.deepEqual(handles.read(`/proc/${tgid}/exe`), image, "exec during capture refuses");
  for (const { fd, target } of descriptors)
    assert.equal(
      fs.readlinkSync(`/proc/${tgid}/fd/${fd}`),
      target,
      "descriptor ownership changed during the actual live capture",
    );
  assert.deepEqual(
    fs.readdirSync(`/proc/${tgid}/fd`).toSorted(),
    descriptorNames.toSorted(),
    "the complete descriptor census changed during capture",
  );
  assert.deepEqual(
    fs
      .readdirSync(`/proc/${tgid}/task`)
      .map(Number)
      .toSorted((a, b) => a - b),
    threads,
    "the actual thread census changed during capture",
  );
  return {
    thread,
    tgid,
    threadBirthTicks: beforeThread.birthTicks,
    processBirthTicks: beforeProcess.birthTicks,
    status: { pid, tgid, ppid },
    threadStat: beforeThread.raw,
    processStat: beforeProcess.raw,
    image,
    descriptors,
    descriptorFailures,
    process: {
      pid: tgid,
      ppid,
      birthTicks: beforeProcess.birthTicks,
      executable,
      executableSHA256: image.sha256,
      threads,
      stdin: descriptor(0),
      stdout: descriptor(1),
      sockets,
    },
  };
}

/** The kernel's actual per-thread children list, including pre-attach descendants. */
export function initialActorGroups(root: number): number[] {
  const groups = new Set<number>();
  const visit = (pid: number) => {
    assert.equal(groups.has(pid), false, "a cyclic initial process tree refuses");
    groups.add(pid);
    for (const thread of fs.readdirSync(`/proc/${pid}/task`))
      for (const child of fs
        .readFileSync(`/proc/${pid}/task/${thread}/children`, "utf8")
        .trim()
        .split(/\s+/u)
        .filter(Boolean))
        visit(Number(child));
  };
  visit(root);
  return [...groups];
}
