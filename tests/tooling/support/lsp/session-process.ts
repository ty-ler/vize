import assert from "node:assert/strict";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import path from "node:path";
import { resolveVizeLaunchCommand, type VerifiedLspLaunch } from "./launch.ts";
import { root } from "./paths.ts";
import { verifyPublishedLaunch, type VerifiedPublishedLspLaunch } from "./published-launch.ts";

export type BoundLspSession = {
  repoRoot: string;
  binary: string;
  published?: PublishedSessionBinding;
};

export type PublishedSessionBinding = {
  authority: "published-release";
  receiptPath: string;
  receiptSha256: string;
  captureRoot: string;
};
import { LspSessionCapture } from "./session-capture.ts";
import {
  newBaselineObserver,
  type BaselineObserver,
} from "../../../performance/support/current-baseline/observer.ts";
import {
  diagnosticLaunch,
  memoryBinding,
} from "../../../performance/support/allocation-diagnostic/launch.ts";
import { MemoryObserver } from "../../../performance/support/allocation-diagnostic/observer.ts";

const captures = new WeakMap<ChildProcessWithoutNullStreams, LspSessionCapture>();
const baselines = new WeakMap<ChildProcessWithoutNullStreams, BaselineObserver>();
const memories = new WeakMap<ChildProcessWithoutNullStreams, MemoryObserver>();

export function spawnBoundLspSessionProcess(
  binding: BoundLspSession,
): ChildProcessWithoutNullStreams {
  return spawnLspSessionProcess(binding.repoRoot, true, binding.binary, binding.published);
}

/** Reuse the existing launch and version probe; capture never starts another server. */
export function spawnLspSessionProcess(
  repoRoot = root,
  sourceRequired = process.env.VIZE_LSP_REQUIRE_SOURCE_BUILD === "1",
  envBinary = process.env.VIZE_LSP_BIN,
  published?: PublishedSessionBinding,
): ChildProcessWithoutNullStreams {
  const memory = memoryBinding(repoRoot);
  assert.ok(!memory || !published, "memory diagnosis is a separate source experiment");
  if (memory) repoRoot = memory.sourceRoot;
  let verified: VerifiedLspLaunch | VerifiedPublishedLspLaunch | undefined;
  const resolveStarted = process.hrtime.bigint();
  const diagnostic = memory && diagnosticLaunch(memory, envBinary);
  if (diagnostic) verified = diagnostic;
  if (published) {
    assert.equal(sourceRequired, true, "published sessions require whole raw capture");
    assert.equal(published.authority, "published-release");
    verified = verifyPublishedLaunch(published.receiptPath, published.receiptSha256);
    assert.equal(
      envBinary,
      verified.binary,
      "the public caller cannot select a fallback executable",
    );
  }
  const [command, ...args] = published
    ? [verified!.binary, "lsp"]
    : diagnostic
      ? [diagnostic.binary, "lsp"]
      : resolveVizeLaunchCommand(undefined, envBinary, {
          required: sourceRequired,
          repoRoot,
          onVerifiedLaunch: (launch) => {
            verified = launch;
          },
        });
  const resolveLaunchMs = Number(process.hrtime.bigint() - resolveStarted) / 1e6;
  const capture =
    sourceRequired && !diagnostic
      ? new LspSessionCapture({
          repoRoot,
          outputRoot:
            published?.captureRoot ?? path.join(repoRoot, "target/differential/lsp-sessions"),
          launch: verified!,
          callerStack: new Error().stack ?? "",
        })
      : undefined;
  assert.ok(
    !sourceRequired || capture || diagnostic,
    "source-built sessions require raw observations",
  );
  const memoryObserver = memory
    ? new MemoryObserver(memory, verified as VerifiedLspLaunch)
    : undefined;
  const baseline = published
    ? undefined
    : newBaselineObserver(repoRoot, verified as VerifiedLspLaunch | undefined, resolveLaunchMs);
  baseline?.beforeSpawn();
  const child = spawn(command, args, { cwd: repoRoot, stdio: ["pipe", "pipe", "pipe"] });
  if (memoryObserver) {
    memories.set(child, memoryObserver);
    memoryObserver.attach(child);
  }
  if (baseline) {
    baselines.set(child, baseline);
    baseline.attach(child);
  }
  if (capture) {
    captures.set(child, capture);
    child.stdout.on("data", (chunk: Buffer) => capture.append("server", chunk));
    child.stderr.on("data", (chunk: Buffer) => capture.append("stderr", chunk));
    child.on("error", (error) => capture.processError(error));
    child.on("close", (code, signal) => capture.finish(code, signal));
  }
  return child;
}

/** The recorded bytes are exactly the existing client's single write, including batches. */
export function recordLspClientWire(child: ChildProcessWithoutNullStreams, frame: string): void {
  captures.get(child)?.append("client", Buffer.from(frame, "utf8"));
  baselines.get(child)?.append("client", Buffer.from(frame, "utf8"));
  memories.get(child)?.append("client", Buffer.from(frame, "utf8"));
}
