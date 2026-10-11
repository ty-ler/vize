import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { setTimeout } from "node:timers/promises";

import {
  nativeApiAttachments,
  syscallWrites,
  syscallTranscriptDigest,
  type NativeProcessWitness,
} from "./warm-type-backed-owner-syscalls.ts";
import { sha256 } from "./warm-type-backed-source.ts";
import { NativeProtocolStream } from "./warm-type-backed-owner-protocol-stream.ts";
import { nativeApiSocketTraffic } from "./warm-type-backed-owner-socket-traffic.ts";

const MAX_TRANSCRIPT = 64 * 1024 * 1024;

function tracerWitness(pid: number) {
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

function processWitness(pid: number): NativeProcessWitness {
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

/** Diagnostic-only attach; the verified production launch and primary measurement stay untouched. */
export class NativeApiSyscallObserver {
  readonly witnesses: NativeProcessWitness[] = [];
  readonly parents: NativeProcessWitness[] = [];
  readonly parent: NativeProcessWitness;
  readonly file: string;
  readonly nativeExecutable: string;
  private readonly child: ChildProcess;
  private readonly closed: Promise<{ code: number | null; signal: string | null }>;
  private tracerPid = 0;
  private tracer: ReturnType<typeof tracerWitness> | undefined;
  private readonly stream: NativeProtocolStream;
  private streamFailure: unknown;
  private stderr = "";

  private constructor(pid: number, output: string, nativeExecutable: string) {
    this.nativeExecutable = nativeExecutable;
    assert.equal(process.platform, "linux");
    assert.equal(fs.existsSync(output), false, "a fresh private observer directory is required");
    fs.mkdirSync(output, { recursive: true, mode: 0o700 });
    this.file = path.join(output, "native-api-syscalls.private");
    fs.writeFileSync(this.file, "", { flag: "wx", mode: 0o600 });
    this.stream = new NativeProtocolStream((line) => fs.appendFileSync(this.file, line));
    this.parent = processWitness(pid);
    assert.equal(
      this.parent.ppid,
      process.pid,
      "the observer must bind the unchanged launch owned by this original client",
    );
    this.parents.push(this.parent);
    this.child = spawn(
      "sudo",
      [
        "-n",
        "strace",
        "-f",
        "-qq",
        "-ttt",
        "--strings-in-hex=non-ascii-chars",
        "-yy",
        "-s",
        "1048576",
        "-e",
        "trace=write",
        "-p",
        String(pid),
      ],
      {
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    // strace's inherited stderr accepts Node's actual socket-backed descriptor;
    // reopening /dev/stdout as a file fails with ENXIO on that original transport.
    this.child.stderr!.on("data", (chunk: Buffer) => {
      if (this.streamFailure) return;
      const diagnostics = chunk
        .toString("utf8")
        .split("\n")
        .filter((line) => /^(strace|sudo):/u.test(line))
        .join("\n");
      this.stderr = (this.stderr + diagnostics).slice(0, 65_536);
      try {
        this.stream.push(chunk);
      } catch (error) {
        this.streamFailure = error;
      }
    });
    this.child.stdout!.on("data", () => {
      if (this.streamFailure) return;
      this.streamFailure = new Error("the independent syscall observer emitted unexpected stdout");
    });
    this.closed = new Promise((resolve, reject) => {
      this.child.once("error", reject);
      this.child.once("close", (code, signal) => resolve({ code, signal }));
    });
  }

  static async start(pid: number, output: string, nativeExecutable: string) {
    assert.equal(fs.existsSync(output), false, "a fresh private observer directory is required");
    let observer: NativeApiSyscallObserver | undefined;
    let phase = "construct";
    try {
      observer = new NativeApiSyscallObserver(pid, output, nativeExecutable);
      phase = "attach";
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        if (observer.streamFailure) throw observer.streamFailure;
        const status = fs.readFileSync(`/proc/${pid}/status`, "utf8");
        observer.tracerPid = Number(status.match(/^TracerPid:\s+(\d+)$/mu)?.[1]);
        if (observer.tracerPid > 0) {
          phase = "tracer-identity";
          observer.tracer = tracerWitness(observer.tracerPid);
          return observer;
        }
        if (observer.child.exitCode !== null) break;
        await setTimeout(10);
      }
      throw new Error("the observer must attach before the original initialize request");
    } catch (failure) {
      let retirementFailure: unknown;
      try {
        await observer?.stop();
      } catch (error) {
        retirementFailure = error instanceof Error ? error.stack : String(error);
      }
      if (fs.existsSync(output))
        fs.writeFileSync(
          path.join(output, "startup-failure.json"),
          `${JSON.stringify({ qualified: false, phase, failure: failure instanceof Error ? failure.stack : String(failure), retirementFailure, observer: observer?.diagnosticState() }, null, 2)}\n`,
          { flag: "wx", mode: 0o600 },
        );
      throw failure;
    }
  }

  private diagnosticState() {
    return {
      parent: this.parent,
      tracer: this.tracer,
      tracerPid: this.tracerPid,
      childExitCode: this.child.exitCode,
      childSignalCode: this.child.signalCode,
      stderr: this.stderr,
      streamFailure:
        this.streamFailure instanceof Error ? this.streamFailure.stack : this.streamFailure,
      protocolScope: this.stream.snapshot(),
    };
  }

  private checkStreamFailure() {
    if (this.streamFailure) {
      fs.writeFileSync(
        path.join(path.dirname(this.file), "observer-failure.json"),
        `${JSON.stringify({ qualified: false, observer: this.diagnosticState() }, null, 2)}\n`,
        { mode: 0o600 },
      );
      throw this.streamFailure;
    }
  }

  sample(row: Record<string, unknown>) {
    this.checkStreamFailure();
    assert.ok(
      fs.statSync(this.file).size <= MAX_TRANSCRIPT,
      "native observation exceeds its finite transcript bound",
    );
    const processes = row.processes;
    assert.ok(Array.isArray(processes));
    this.parents.push(processWitness(this.parent.pid));
    for (const process of processes) {
      if (process.executable !== this.nativeExecutable) continue;
      const witness = processWitness(process.pid);
      assert.equal(
        witness.ppid,
        this.parent.pid,
        "the original native child must belong to the original Vize launch",
      );
      assert.equal(witness.birthTicks, process.birth_ticks);
      assert.equal(witness.executable, this.nativeExecutable);
      this.witnesses.push(witness);
    }
  }

  async stop() {
    if (this.tracerPid > 0 && this.child.exitCode === null) {
      const kill = spawnSync("sudo", ["-n", "kill", "-INT", String(this.tracerPid)], {
        encoding: "utf8",
      });
      assert.equal(kill.status, 0, "the independent tracer must accept retirement");
    } else if (this.child.exitCode === null) this.child.kill("SIGTERM");
    const exit = await Promise.race([this.closed, setTimeout(5000).then(() => null)]);
    assert.ok(exit, "the independent tracer must be reaped in five seconds");
    if (this.tracerPid > 0) assert.equal(fs.existsSync(`/proc/${this.tracerPid}`), false);
    if (fs.existsSync(`/proc/${this.parent.pid}`))
      assert.match(
        fs.readFileSync(`/proc/${this.parent.pid}/status`, "utf8"),
        /^TracerPid:\s+0$/mu,
      );
    this.checkStreamFailure();
  }

  receipt() {
    this.checkStreamFailure();
    assert.ok(this.witnesses.length > 0);
    assert.ok(fs.statSync(this.file).size <= MAX_TRANSCRIPT);
    const protocolScope = this.stream.finish();
    const transcriptSHA256 = syscallTranscriptDigest(this.file);
    const attachments = nativeApiAttachments(
      fs.readFileSync(this.file, "utf8"),
      this.witnesses,
      this.parents,
    );
    const writes = syscallWrites(fs.readFileSync(this.file, "utf8"));
    const socketTraffic = attachments.map(({ process, socket }) =>
      nativeApiSocketTraffic(writes, process, socket, this.parents),
    );
    const result = {
      parent: this.parent,
      tracer: this.tracer,
      tracerPid: this.tracerPid,
      transcriptSHA256,
      protocolScope,
      attachments,
      socketTraffic,
    };
    fs.writeFileSync(
      path.join(path.dirname(this.file), "native-api-attachments.json"),
      `${JSON.stringify(result, null, 2)}\n`,
    );
    // Keep only the complete native API facts and their kernel/binary witnesses in the artifact.
    fs.unlinkSync(this.file);
    return result;
  }
}
