import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BUILD_RECIPE, validateBuildReceipt } from "../../../differential/build-receipt.ts";
import { sha256 } from "../../../differential/harness.mjs";
import { decodeFrames } from "../../../differential/lsp-wire.ts";
import type { VerifiedLspLaunch } from "./launch.ts";
import { validatePublishedLaunch, type VerifiedPublishedLspLaunch } from "./published-launch.ts";
import { linkSessionSourceOrigins, type SourceWitness } from "./session-source-links.ts";

const MAX_CAPTURE_BYTES = 16 * 1024 * 1024;
const MAX_TIMING_BYTES = 1024 * 1024;
export type LspRequestTiming =
  | {
      phase: "request-before-write" | "timeout-callback";
      id: number;
      method: string;
      configuredTimeoutMs: number;
    }
  | { phase: "response-dispatch"; id: number; pendingFound: boolean };
const STREAMS = ["client", "server", "stderr"] as const;
type Stream = (typeof STREAMS)[number];
let nextSession = 0;

function sourceWitnesses(repoRoot: string, callerStack: string): SourceWitness[] {
  const witnesses: SourceWitness[] = [];
  for (const line of callerStack.split("\n")) {
    const frame = line.match(/(file:\/\/[^\s)]+):(\d+):(\d+)\)?$/);
    if (!frame) continue;
    const absolute = fileURLToPath(frame[1]);
    const relative = path.relative(repoRoot, absolute);
    if (
      !relative.startsWith(`tests${path.sep}tooling${path.sep}`) &&
      !relative.startsWith(`tests${path.sep}snapshots${path.sep}`)
    )
      continue;
    if (relative.endsWith("session-process.ts") || relative.endsWith("session.ts")) continue;
    witnesses.push({
      path: relative.split(path.sep).join("/"),
      line: Number(frame[2]),
      column: Number(frame[3]),
      sha256: sha256(fs.readFileSync(absolute)),
    });
  }
  return witnesses;
}

/** Passive whole-wire observations are pending evidence, never accepted corpus rows. */
export class LspSessionCapture {
  readonly directory: string;
  private readonly launch: VerifiedLspLaunch | VerifiedPublishedLspLaunch;
  private readonly witnesses: SourceWitness[];
  private readonly sourceOrigins: ReturnType<typeof linkSessionSourceOrigins>;
  private readonly chunks: Record<Stream, Buffer[]> = { client: [], server: [], stderr: [] };
  private readonly observedBytes: Record<Stream, number> = { client: 0, server: 0, stderr: 0 };
  private capturedBytes = 0;
  private readonly timingAnchor = {
    wallTime: new Date().toISOString(),
    monotonicNs: process.hrtime.bigint(),
  };
  private readonly timingEvents: Array<LspRequestTiming & { elapsedMs: number }> = [];
  private timingBytes = 0;
  private timingObserved = 0;
  private error: string | null = null;
  private closed = false;
  private exitStatus: number | null = null;
  private signal: string | null = null;

  constructor({
    repoRoot,
    outputRoot,
    launch,
    callerStack,
  }: {
    repoRoot: string;
    outputRoot: string;
    launch: VerifiedLspLaunch | VerifiedPublishedLspLaunch;
    callerStack: string;
  }) {
    assert.ok(launch, "verified source launch is required for raw observations");
    if ("authority" in launch) validatePublishedLaunch(launch);
    else validateBuildReceipt(launch.receipt, launch.expected, launch.buildRecipe ?? BUILD_RECIPE);
    const probe = launch.versionProbe;
    assert.ok(probe, "actual source version probe is required for raw observations");
    assert.equal(probe.exitStatus, 0);
    assert.equal(probe.signal, null);
    assert.equal(probe.processError, null);
    assert.equal(
      Buffer.from(probe.stdoutBase64, "base64").toString().trim(),
      launch.expected.cliVersion,
    );
    assert.equal(path.resolve(launch.binary), path.resolve(repoRoot, launch.expected.binaryPath));
    this.launch = launch;
    this.witnesses = sourceWitnesses(repoRoot, callerStack);
    this.sourceOrigins = linkSessionSourceOrigins(repoRoot, this.witnesses);
    fs.mkdirSync(outputRoot, { recursive: true });
    this.directory = fs.mkdtempSync(path.join(outputRoot, `${process.pid}-${++nextSession}-`));
    this.writeMetadata(null, null, "awaiting-process-close");
  }

  append(stream: Stream, chunk: Buffer): void {
    this.observedBytes[stream] += chunk.length;
    const remaining = MAX_CAPTURE_BYTES - this.capturedBytes;
    const retained = Math.min(chunk.length, remaining);
    if (retained > 0) {
      this.chunks[stream].push(Buffer.from(chunk.subarray(0, retained)));
      this.capturedBytes += retained;
    }
    if (this.closed) this.writeMetadata(this.exitStatus, this.signal, "process-closed");
  }

  recordRequestTiming(event: LspRequestTiming): void {
    const row = {
      ...event,
      elapsedMs: Number(process.hrtime.bigint() - this.timingAnchor.monotonicNs) / 1e6,
    };
    this.timingObserved++;
    // Retain only a complete prefix; overflow never affects wire capture or dispatch.
    if (this.timingObserved !== this.timingEvents.length + 1) return;
    const bytes = Buffer.byteLength(JSON.stringify(row), "utf8");
    if (this.timingBytes + bytes <= MAX_TIMING_BYTES) {
      this.timingEvents.push(row);
      this.timingBytes += bytes;
    }
  }

  processError(error: Error): void {
    this.error = error.message;
  }

  finish(exitStatus: number | null, signal: string | null): void {
    assert.ok(!this.closed, "raw observation cannot close twice");
    this.closed = true;
    this.exitStatus = exitStatus;
    this.signal = signal;
    this.writeMetadata(exitStatus, signal, "process-closed");
  }

  private writeMetadata(
    exitStatus: number | null,
    signal: string | null,
    state: "awaiting-process-close" | "process-closed",
  ): void {
    const streams = Object.fromEntries(
      STREAMS.map((stream) => {
        const bytes = Buffer.concat(this.chunks[stream]);
        const relative = `${stream}.bin`;
        fs.writeFileSync(path.join(this.directory, relative), bytes);
        let framing:
          | { state: "complete"; messageCount: number }
          | { state: "invalid-or-truncated"; error: string }
          | undefined;
        if (stream !== "stderr") {
          if (bytes.length !== this.observedBytes[stream]) {
            framing = {
              state: "invalid-or-truncated",
              error: "raw stream was truncated by the capture byte limit",
            };
          } else {
            try {
              framing = { state: "complete", messageCount: decodeFrames(bytes).messages.length };
            } catch (error) {
              framing = {
                state: "invalid-or-truncated",
                error: error instanceof Error ? error.message : String(error),
              };
            }
          }
        }
        return [
          stream,
          {
            path: relative,
            capturedBytes: bytes.length,
            observedBytes: this.observedBytes[stream],
            sha256: sha256(bytes),
            truncated: bytes.length !== this.observedBytes[stream],
            ...(framing ? { framing } : {}),
          },
        ];
      }),
    );
    const observation = {
      schema: "vize.lsp.session.observation",
      version: 1,
      state,
      sourceRevision: this.launch.expected.sourceRevision,
      ...("authority" in this.launch
        ? { launchAuthority: this.launch.authority, publicationReceipt: this.launch.receipt }
        : { buildReceipt: this.launch.receipt }),
      binary: this.launch.expected,
      versionProbe: this.launch.versionProbe,
      argv: ["lsp"],
      clientWireMeaning: "attempted-existing-stdin-write",
      captureByteLimit: MAX_CAPTURE_BYTES,
      requestTiming: {
        wallAnchor: this.timingAnchor.wallTime,
        monotonicAnchorNs: String(this.timingAnchor.monotonicNs),
        meaning:
          "passive client callback times; before-write is before the existing send, not server receipt; wall and monotonic anchors are sampled consecutively",
        byteLimit: MAX_TIMING_BYTES,
        capturedBytes: this.timingBytes,
        observedEvents: this.timingObserved,
        omittedEvents: this.timingObserved - this.timingEvents.length,
        truncated: this.timingObserved !== this.timingEvents.length,
        events: this.timingEvents,
      },
      sourceWitnesses: this.witnesses,
      sourceOrigins: this.sourceOrigins,
      streams,
      process: { exitStatus, signal, error: this.error },
      acceptance: {
        state: "pending-original-input-and-session-reconciliation",
        wholeFixesClosed: 0,
        nativeHandled: 0,
        nativeEquivalent: 0,
        workspaceDependenciesCaptured: false,
      },
    };
    const destination = path.join(this.directory, "observation.json");
    fs.writeFileSync(`${destination}.tmp`, `${JSON.stringify(observation, null, 2)}\n`);
    fs.renameSync(`${destination}.tmp`, destination);
  }
}
