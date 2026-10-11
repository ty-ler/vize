import assert from "node:assert/strict";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { VerifiedLspLaunch } from "../../../tooling/support/lsp/launch.ts";
import { sha256 } from "../../../differential/sha256.ts";
import type { MemoryBinding } from "./launch.ts";
import { assertIdentity, disappeared, identity, smaps, type ProcessIdentity } from "./identity.ts";

type Stream = "client" | "server" | "stderr";
const MAX_WIRE = 32 * 1024 * 1024;
const sessions = new Map<number, MemoryObserver>();
const json = (file: string, value: unknown) =>
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });

/** Passive client writes and original RSS fences; this helper sends no RPC. */
export class MemoryObserver {
  private readonly binding: MemoryBinding;
  private readonly launch: VerifiedLspLaunch;
  private readonly lengths = { client: 0, server: 0, stderr: 0 };
  private readonly providers = new Map<number, ProcessIdentity>();
  private owner?: ProcessIdentity;
  private total = 0;
  private fences = 0;
  private closed = false;
  private failure: string | null = null;

  constructor(binding: MemoryBinding, launch: VerifiedLspLaunch) {
    this.binding = binding;
    this.launch = launch;
    assert.equal(launch.expected.sourceRevision, binding.sourceRevision);
    assert.equal(launch.expected.binarySha256, binding.binarySha256);
    if (binding.role === "first-original-ci") {
      assert.equal(
        sha256(fs.readFileSync(`${launch.binary}.differential-build.json`)),
        binding.receiptSha256,
      );
    }
    assert(!fs.existsSync(binding.outputRoot), "stale diagnostic output refused");
    const inputs = fs.readFileSync(`${binding.outputRoot}.inputs.json`);
    const packet = JSON.parse(inputs.toString());
    assert.equal(packet.role, binding.role);
    assert.equal(packet.sourceRevision, binding.sourceRevision);
    fs.mkdirSync(binding.outputRoot, { recursive: true });
    fs.writeFileSync(this.file("inputs.json"), inputs, { flag: "wx" });
    json(this.file("launch.json"), {
      ...binding,
      launch,
      acceptanceCredit: "none",
      originalResultIsNotRepairCredit: true,
      driverObservation: "passive-wire-and-smaps-can-affect-scheduling-and-timing",
      originalCiPerformanceCredit: "none",
      inputSha256: sha256(inputs),
      wireMeaning: "attempted-existing-client-write-and-observed-process-streams",
    });
    for (const name of ["client.bin", "server.bin", "stderr.bin", "chunks.jsonl", "fences.jsonl"])
      fs.writeFileSync(this.file(name), "", { flag: "wx" });
  }

  private file(name: string) {
    return path.join(this.binding.outputRoot, name);
  }
  private refuse(error: unknown): void {
    this.failure ??= error instanceof Error ? error.message : String(error);
  }

  attach(child: ChildProcessWithoutNullStreams): void {
    assert(child.pid, "actual spawned server PID required");
    assert(!sessions.has(child.pid), "one capture per actual process");
    sessions.set(child.pid, this);
    child.once("spawn", () => {
      try {
        const owner = identity(child.pid!);
        assert.equal(owner.parentPid, process.pid);
        assert.equal(owner.executable, fs.realpathSync(this.launch.binary));
        assert.equal(owner.executableSha256, this.binding.binarySha256);
        this.owner = owner;
        json(this.file("process-start.json"), { ns: process.hrtime.bigint().toString(), owner });
      } catch (error) {
        this.refuse(error);
      }
    });
    child.stdout.on("data", (bytes: Buffer) => this.append("server", bytes));
    child.stderr.on("data", (bytes: Buffer) => this.append("stderr", bytes));
    child.on("error", (error) => this.refuse(error));
    child.once("close", (code, signal) => {
      this.closed = true;
      try {
        assert(this.owner, "actual process authentication missing");
        assert.equal(sha256(fs.readFileSync(this.launch.binary)), this.binding.binarySha256);
        assert.equal(sha256(fs.readFileSync(this.binding.backendPath)), this.binding.backendSha256);
        assert.equal(this.fences, 63, "whole original 63 causal RSS fences required");
        assert(this.providers.size > 0, "actual native provider must be observed");
      } catch (error) {
        this.refuse(error);
      }
      json(this.file("process-close.json"), {
        ns: process.hrtime.bigint().toString(),
        code,
        signal,
        owner: this.owner ?? null,
        providers: [...this.providers.values()],
        fences: this.fences,
        failure: this.failure,
        complete: this.failure === null,
        acceptanceCredit: "none",
        streams: Object.fromEntries(
          Object.entries(this.lengths).map(([stream, bytes]) => [
            stream,
            { bytes, sha256: sha256(fs.readFileSync(this.file(`${stream}.bin`))) },
          ]),
        ),
      });
    });
  }

  append(stream: Stream, bytes: Buffer): void {
    if (bytes.length === 0 || this.closed) return;
    const ns = process.hrtime.bigint().toString();
    if (this.total + bytes.length > MAX_WIRE) {
      this.refuse(new Error("complete passive wire exceeds explicit32MiB bound"));
      return;
    }
    const start = this.lengths[stream];
    const end = start + bytes.length;
    fs.appendFileSync(this.file(`${stream}.bin`), bytes);
    fs.appendFileSync(this.file("chunks.jsonl"), `${JSON.stringify({ ns, stream, start, end })}\n`);
    this.lengths[stream] = end;
    this.total += bytes.length;
  }

  metrics(value: unknown): void {
    json(this.file("original-metrics.json"), value);
    if (this.owner) sessions.delete(this.owner.pid);
  }

  fence(sample: { label: string; members: { pid: number; parentPid: number }[] }): void {
    const ns = process.hrtime.bigint().toString();
    const index = this.fences++;
    try {
      assert(index < 63, "original fence bound exceeded");
      assert(this.owner, "process authentication must precede original RSS fence");
      assertIdentity(identity(this.owner.pid, "/proc", this.owner), this.owner);
      const members: ProcessIdentity[] = [];
      const owned = new Set([this.owner.pid]);
      for (let pass = 0; pass < sample.members.length; pass += 1) {
        for (const member of sample.members) if (owned.has(member.parentPid)) owned.add(member.pid);
      }
      for (const member of sample.members) {
        assert(owned.has(member.pid), "foreign process in original process tree");
        if (member.pid === this.owner.pid) continue;
        const live = identity(member.pid, "/proc", this.providers.get(member.pid));
        assert.equal(live.parentPid, member.parentPid);
        assert.equal(live.executable, this.binding.backendPath);
        assert.equal(live.executableSha256, this.binding.backendSha256);
        if (this.providers.has(member.pid)) assertIdentity(live, this.providers.get(member.pid)!);
        this.providers.set(member.pid, live);
        members.push(live);
      }
      const bytes = smaps(this.owner);
      const relative = `smaps-${index}.txt`;
      fs.writeFileSync(this.file(relative), bytes, { flag: "wx" });
      fs.appendFileSync(
        this.file("fences.jsonl"),
        `${JSON.stringify({
          index,
          ns,
          originalSample: sample,
          owner: this.owner,
          members,
          smaps: { path: relative, bytes: bytes.length, sha256: sha256(bytes) },
          scope: "smaps-after-original-RSS-sample-no-extra-client-query",
        })}\n`,
      );
    } catch (error) {
      this.refuse(error);
      fs.appendFileSync(
        this.file("fences.jsonl"),
        `${JSON.stringify({
          index,
          ns,
          originalSample: sample,
          failure: error instanceof Error ? error.message : String(error),
          disappearance: disappeared(error),
          complete: false,
        })}\n`,
      );
    }
  }
}

export function recordMemoryFence(
  pid: number,
  sample: Parameters<MemoryObserver["fence"]>[0],
): void {
  sessions.get(pid)?.fence(sample);
}

export function recordMemoryMetrics(pid: number, metrics: unknown): void {
  sessions.get(pid)?.metrics(metrics);
}
