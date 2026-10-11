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
import {
  captureLiveActor,
  ElfHandles,
  initialActorGroups,
  processWitness,
  tracerWitness,
} from "./warm-type-backed-owner-live-process.ts";
import { NativeActorLifecycle } from "./warm-type-backed-owner-lifecycle.ts";
import { NativeTraceCustody } from "./warm-type-backed-owner-trace-custody.ts";
import { NativeProtocolStream } from "./warm-type-backed-owner-protocol-stream.ts";
import { nativeApiSocketTraffic } from "./warm-type-backed-owner-socket-traffic.ts";
import { authenticateWriteEpochs } from "./warm-type-backed-owner-write-epochs.ts";
import { retireKernelObserver } from "./warm-type-backed-owner-retirement.ts";
const MAX_TRANSCRIPT = 64 * 1024 * 1024;
/** Diagnostic-only attach; the verified production launch and primary measurement stay untouched. */
export class NativeApiSyscallObserver {
  readonly witnesses: NativeProcessWitness[] = [];
  readonly parents: NativeProcessWitness[] = [];
  readonly parent: NativeProcessWitness;
  readonly file: string;
  readonly nativeExecutable: string;
  private child!: ChildProcess;
  private closed!: Promise<{ code: number | null; signal: string | null }>;
  private tracerPid = 0;
  private tracer: ReturnType<typeof tracerWitness> | undefined;
  private readonly stream: NativeProtocolStream;
  private streamFailure: unknown;
  private rejectedProcess: NativeProcessWitness | undefined;
  private rejectedProcessFailure: string | undefined;
  private stderr = "";
  private readonly handles = new ElfHandles();
  private readonly lifecycle: NativeActorLifecycle;
  private readonly custody: NativeTraceCustody;
  private readonly initialThreads: number[];
  private readonly initialGroups: number[];
  private readonly actorRecords = new Set<number>();
  private constructor(pid: number, output: string, nativeExecutable: string, nativeSHA256: string) {
    this.nativeExecutable = nativeExecutable;
    assert.equal(process.platform, "linux");
    assert.equal(fs.existsSync(output), false, "a fresh private observer directory is required");
    fs.mkdirSync(output, { recursive: true, mode: 0o700 });
    this.file = path.join(output, "native-api-syscalls.private");
    fs.writeFileSync(this.file, "", { flag: "wx", mode: 0o600 });
    this.custody = new NativeTraceCustody(output);
    try {
      const selected = this.handles.read(nativeExecutable);
      assert.equal(
        selected.sha256,
        nativeSHA256,
        "the actual selected ELF must match its complete locked SDK authority",
      );
      this.lifecycle = new NativeActorLifecycle(
        pid,
        selected,
        (thread) =>
          captureLiveActor(thread, this.handles, (value) =>
            this.custody.record({ kind: "partial-live-read", value }),
          ),
        (event) => {
          if (!this.actorRecords.has(event.actor)) {
            this.custody.record({
              kind: "complete-live-actor",
              index: event.actor,
              actor: this.lifecycle.actors[event.actor],
            });
            this.actorRecords.add(event.actor);
          }
          this.custody.record({ kind: "kernel-event", event });
        },
      );
      this.initialGroups = initialActorGroups(pid);
      this.initialThreads = this.initialGroups.flatMap((group) =>
        fs.readdirSync(`/proc/${group}/task`).map(Number),
      );
      for (const thread of this.initialThreads) {
        const actor = captureLiveActor(thread, this.handles, (value) =>
          this.custody.record({ kind: "partial-initial-live-read", value }),
        );
        this.custody.record({ kind: "actual-pre-attach-kernel-census", actor });
        this.lifecycle.initial(actor);
      }
      this.stream = new NativeProtocolStream(
        (line) => fs.appendFileSync(this.file, line),
        (line) => this.lifecycle.line(line),
      );
      this.parent = processWitness(pid);
      assert.equal(
        this.parent.ppid,
        process.pid,
        "the observer must bind the unchanged launch owned by this original client",
      );
      this.parents.push(this.parent);
    } catch (failure) {
      this.handles.close();
      throw failure;
    }
  }
  private launch() {
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
        "trace=write,clone,clone3,fork,vfork,execve,execveat,exit,exit_group",
        "-e",
        "raw=execve,execveat",
        ...this.initialGroups.flatMap((group) => ["-p", String(group)]),
      ],
      {
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    this.closed = new Promise((resolve, reject) => {
      this.child.once("error", (failure) => {
        this.streamFailure ??= failure;
        reject(failure);
      });
      this.child.once("close", (code, signal) => resolve({ code, signal }));
    });
    void this.closed.catch(() => {});
    // strace's inherited stderr accepts Node's actual socket-backed descriptor;
    // reopening /dev/stdout as a file fails with ENXIO on that original transport.
    this.child.stderr!.on("data", (chunk: Buffer) => {
      try {
        this.custody.input(chunk);
      } catch (failure) {
        this.streamFailure ??= failure;
        return;
      }
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
        const thread = this.stream.snapshot().rejectedLine?.thread;
        if (thread !== undefined) {
          try {
            const status = fs.readFileSync(`/proc/${thread}/status`, "utf8");
            const pid = Number(status.match(/^Tgid:\s+(\d+)$/mu)?.[1]);
            assert.ok(Number.isSafeInteger(pid) && pid > 0);
            this.rejectedProcess = processWitness(pid);
            assert.ok(this.rejectedProcess.threads.includes(thread));
          } catch (failure) {
            this.rejectedProcessFailure =
              failure instanceof Error ? failure.stack : String(failure);
          }
        }
      }
    });
    this.child.stdout!.on("data", () => {
      if (this.streamFailure) return;
      this.streamFailure = new Error("the independent syscall observer emitted unexpected stdout");
    });
  }
  static async start(pid: number, output: string, nativeExecutable: string, nativeSHA256: string) {
    assert.equal(fs.existsSync(output), false, "a fresh private observer directory is required");
    let observer: NativeApiSyscallObserver | undefined;
    let phase = "construct";
    try {
      observer = new NativeApiSyscallObserver(pid, output, nativeExecutable, nativeSHA256);
      phase = "launch";
      observer.launch();
      phase = "attach";
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        if (observer.streamFailure) throw observer.streamFailure;
        const status = fs.readFileSync(`/proc/${pid}/status`, "utf8");
        observer.tracerPid = Number(status.match(/^TracerPid:\s+(\d+)$/mu)?.[1]);
        if (observer.tracerPid > 0) {
          phase = "tracer-identity";
          observer.tracer = tracerWitness(observer.tracerPid);
          for (const thread of observer.initialThreads)
            assert.match(
              fs.readFileSync(`/proc/${thread}/status`, "utf8"),
              new RegExp(`^TracerPid:\\s+${observer.tracerPid}$`, "mu"),
              "every actual pre-attach thread must belong to the observed tracer",
            );
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
      childExitCode: this.child?.exitCode,
      childSignalCode: this.child?.signalCode,
      stderr: this.stderr,
      streamFailure:
        this.streamFailure instanceof Error ? this.streamFailure.stack : this.streamFailure,
      protocolScope: this.stream.snapshot(),
      rejectedProcess: this.rejectedProcess,
      rejectedProcessFailure: this.rejectedProcessFailure,
      observedNativeProcesses: this.witnesses,
      observedParents: this.parents,
      wholeKernelCustody: this.custody.snapshot(),
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
      const actual = this.lifecycle.measuredNativeWitnesses(process.pid, process.birth_ticks);
      assert.ok(
        actual.length,
        "the measured native PID/starttime needs its earlier bound live ELF owner",
      );
      for (const witness of actual) {
        assert.equal(
          witness.ppid,
          this.parent.pid,
          "the original native child must belong to the original Vize launch",
        );
        assert.equal(witness.executable, this.nativeExecutable);
        this.witnesses.push(witness);
      }
    }
  }
  async stop() {
    if (!this.child) {
      this.handles.close();
      return;
    }
    await retireKernelObserver(
      () => {
        if (this.tracerPid > 0 && this.child.exitCode === null) {
          const kill = spawnSync("sudo", ["-n", "kill", "-INT", String(this.tracerPid)], {
            encoding: "utf8",
          });
          assert.equal(kill.status, 0, "the independent tracer must accept retirement");
        } else if (this.child.exitCode === null) this.child.kill("SIGTERM");
      },
      this.closed,
      () => {
        if (this.tracerPid > 0) assert.equal(fs.existsSync(`/proc/${this.tracerPid}`), false);
        if (fs.existsSync(`/proc/${this.parent.pid}`))
          assert.match(
            fs.readFileSync(`/proc/${this.parent.pid}/status`, "utf8"),
            /^TracerPid:\s+0$/mu,
          );
      },
      () => this.checkStreamFailure(),
      () => this.handles.close(),
    );
  }
  receipt() {
    this.checkStreamFailure();
    assert.ok(fs.statSync(this.file).size <= MAX_TRANSCRIPT);
    const protocolScope = this.stream.finish();
    const live = this.lifecycle.finish();
    this.witnesses.push(...live.native);
    assert.ok(this.witnesses.length > 0);
    const transcriptSHA256 = syscallTranscriptDigest(this.file);
    const writes = syscallWrites(fs.readFileSync(this.file, "utf8"));
    const writeEpochs = authenticateWriteEpochs(
      writes,
      this.lifecycle,
      this.lifecycle.selected,
      this.witnesses,
      this.parents,
    );
    const attachments = nativeApiAttachments(
      fs.readFileSync(this.file, "utf8"),
      this.witnesses,
      this.parents,
    );
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
      writeEpochs,
      wholeKernelCustody: this.custody.snapshot(),
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
