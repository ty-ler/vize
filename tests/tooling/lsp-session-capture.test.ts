import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { LEGACY_BUILD_RECIPE, writeBuildReceipt } from "../differential/build-receipt.ts";
import { sha256 } from "../differential/harness.mjs";
import { decodeFrames, frameMessage } from "../differential/lsp-wire.ts";
import { resolveVizeLaunchCommand, type VerifiedLspLaunch } from "./support/lsp/launch.ts";
import { LspSession } from "./support/lsp/session.ts";
import { LspSessionCapture, type LspRequestTiming } from "./support/lsp/session-capture.ts";
import { recordLspClientWire, spawnLspSessionProcess } from "./support/lsp/session-process.ts";

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vize-lsp-passive-capture-law-"));
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root });
  git("init", "-q");
  git("config", "user.name", "CI Test");
  git("config", "user.email", "ci@example.invalid");
  fs.writeFileSync(path.join(root, "Cargo.toml"), '[workspace.package]\nversion = "1.0.0"\n');
  fs.mkdirSync(path.join(root, "tests/tooling"), { recursive: true });
  const witness = path.join(root, "tests/tooling/witness.test.ts");
  fs.writeFileSync(witness, "// Explicitly synthetic observer law, not a product fixture.\n");
  git("add", ".");
  git("commit", "-qm", "synthetic capture source");
  const binary = path.join(root, "target/ci/vize");
  fs.mkdirSync(path.dirname(binary), { recursive: true });
  fs.writeFileSync(
    binary,
    '#!/bin/sh\nif [ "$1" = "--version" ]; then printf "vize 1.0.0\\n"; exit 0; fi\ncat\nprintf "observer stderr 🧪\\n" >&2\nexit 23\n',
    { mode: 0o755 },
  );
  writeBuildReceipt(root);
  let launch: VerifiedLspLaunch | undefined;
  resolveVizeLaunchCommand(undefined, binary, {
    required: true,
    repoRoot: root,
    onVerifiedLaunch: (observed) => {
      launch = observed;
    },
  });
  assert.ok(launch);
  return { root, binary, witness, launch };
}

test("passive capture retains existing batched client bytes, whole stdout and failed process evidence", async () => {
  const f = fixture();
  try {
    const child = spawnLspSessionProcess(f.root, true, f.binary);
    const closed = once(child, "close");
    const frames = Buffer.concat([
      frameMessage({ jsonrpc: "2.0", id: 1, method: "unknown", params: { text: "🧪" } }),
      frameMessage({ jsonrpc: "2.0", method: "$/cancelRequest", params: { id: 1 } }),
    ]).toString("utf8");
    recordLspClientWire(child, frames);
    child.stdin.end(frames, "utf8");
    assert.deepEqual(await closed, [23, null]);
    const captures = path.join(f.root, "target/differential/lsp-sessions");
    const directories = fs.readdirSync(captures);
    assert.equal(directories.length, 1);
    const directory = path.join(captures, directories[0]);
    const observed = JSON.parse(fs.readFileSync(path.join(directory, "observation.json"), "utf8"));
    assert.equal(observed.state, "process-closed");
    assert.equal(observed.sourceRevision, f.launch.expected.sourceRevision);
    assert.deepEqual(observed.buildReceipt, f.launch.receipt);
    assert.deepEqual(observed.process, { exitStatus: 23, signal: null, error: null });
    for (const stream of ["client", "server"] as const) {
      const bytes = fs.readFileSync(path.join(directory, observed.streams[stream].path));
      assert.equal(bytes.toString("utf8"), frames);
      assert.equal(observed.streams[stream].sha256, sha256(bytes));
      assert.equal(observed.streams[stream].observedBytes, Buffer.byteLength(frames));
      assert.equal(observed.streams[stream].truncated, false);
      assert.deepEqual(observed.streams[stream].framing, { state: "complete", messageCount: 2 });
    }
    assert.equal(
      fs.readFileSync(path.join(directory, "stderr.bin"), "utf8"),
      "observer stderr 🧪\n",
    );
    assert.equal(observed.acceptance.wholeFixesClosed, 0);
    assert.equal(observed.acceptance.nativeHandled, 0);
    assert.equal(observed.acceptance.nativeEquivalent, 0);
    assert.equal(observed.acceptance.workspaceDependenciesCaptured, false);
  } finally {
    fs.rmSync(f.root, { recursive: true, force: true });
  }
});

test("pending observations bind caller source and mark byte truncation and missing closure explicitly", () => {
  const f = fixture();
  try {
    const capture = new LspSessionCapture({
      repoRoot: f.root,
      outputRoot: path.join(f.root, "target/differential/lsp-sessions"),
      launch: f.launch,
      callerStack: `Error\n    at helper (${pathToFileURL(f.witness).href}:7:3)`,
    });
    const read = () =>
      JSON.parse(fs.readFileSync(path.join(capture.directory, "observation.json"), "utf8"));
    assert.equal(read().state, "awaiting-process-close");
    capture.recordRequestTiming({
      phase: "request-before-write",
      id: 1,
      method: "x".repeat(1024 * 1024),
      configuredTimeoutMs: 1,
    });
    capture.recordRequestTiming({ phase: "response-dispatch", id: 1, pendingFound: false });
    capture.append("client", Buffer.alloc(16 * 1024 * 1024 + 1, 65));
    capture.append("server", frameMessage({ jsonrpc: "2.0", id: 1, result: null }));
    capture.append("stderr", Buffer.from("late failure 🧪"));
    capture.processError(new Error("process failed"));
    capture.finish(null, "SIGKILL");
    const observed = read();
    assert.deepEqual(observed.sourceWitnesses, [
      {
        path: "tests/tooling/witness.test.ts",
        line: 7,
        column: 3,
        sha256: sha256(fs.readFileSync(f.witness)),
      },
    ]);
    assert.equal(observed.requestTiming.byteLimit, 1024 * 1024);
    assert.equal(observed.requestTiming.capturedBytes, 0);
    assert.equal(observed.requestTiming.observedEvents, 2);
    assert.equal(observed.requestTiming.omittedEvents, 2);
    assert.equal(observed.requestTiming.truncated, true);
    assert.deepEqual(observed.requestTiming.events, []);
    assert.equal(observed.streams.client.capturedBytes, 16 * 1024 * 1024);
    assert.equal(observed.streams.client.observedBytes, 16 * 1024 * 1024 + 1);
    assert.equal(observed.streams.client.truncated, true);
    assert.equal(observed.streams.client.framing.state, "invalid-or-truncated");
    assert.equal(observed.streams.server.capturedBytes, 0);
    assert.equal(observed.streams.server.framing.state, "invalid-or-truncated");
    assert.equal(observed.streams.stderr.truncated, true);
    assert.deepEqual(observed.process, {
      exitStatus: null,
      signal: "SIGKILL",
      error: "process failed",
    });
    assert.throws(() => capture.finish(0, null), /cannot close twice/);
    capture.append("client", Buffer.from("attempt after close"));
    assert.equal(read().streams.client.observedBytes, 16 * 1024 * 1024 + 20);
  } finally {
    fs.rmSync(f.root, { recursive: true, force: true });
  }
});

test("passive source observations reject missing probe, forged receipt and mismatched version", () => {
  const f = fixture();
  const observe = (launch: VerifiedLspLaunch) =>
    new LspSessionCapture({
      repoRoot: f.root,
      outputRoot: path.join(f.root, "target/differential/lsp-sessions"),
      launch,
      callerStack: "",
    });
  try {
    assert.throws(() => observe({ ...f.launch, versionProbe: undefined }), /actual source version/);
    assert.throws(
      () =>
        observe({ ...f.launch, receipt: { ...f.launch.receipt, sourceRevision: "0".repeat(40) } }),
      /sourceRevision/,
    );
    assert.throws(() =>
      observe({
        ...f.launch,
        versionProbe: {
          ...f.launch.versionProbe!,
          stdoutBase64: Buffer.from("vize 0.0.0\n").toString("base64"),
        },
      }),
    );
    assert.throws(() => observe({ ...f.launch, binary: path.join(f.root, "target/debug/vize") }));
    assert.equal(fs.existsSync(path.join(f.root, "target/differential")), false);
  } finally {
    fs.rmSync(f.root, { recursive: true, force: true });
  }
});

test("ordinary unbound helper execution does not manufacture source observations", async () => {
  const f = fixture();
  try {
    const child = spawnLspSessionProcess(f.root, false, f.binary);
    const closed = once(child, "close");
    recordLspClientWire(child, "ordinary client bytes");
    child.stdin.end("ordinary client bytes");
    assert.deepEqual(await closed, [23, null]);
    assert.equal(fs.existsSync(path.join(f.root, "target/differential")), false);
  } finally {
    fs.rmSync(f.root, { recursive: true, force: true });
  }
});

test("legacy passive observations retain the snapshot caller and complete failed RPC bytes", () => {
  const f = fixture();
  try {
    const witness = path.join(f.root, "tests/snapshots/check/synthetic.ts");
    fs.mkdirSync(path.dirname(witness), { recursive: true });
    fs.writeFileSync(witness, "// Synthetic snapshot observer law, not a product fixture.\n");
    execFileSync("git", ["add", "tests/snapshots"], { cwd: f.root });
    execFileSync("git", ["commit", "-qm", "synthetic snapshot witness"], { cwd: f.root });
    writeBuildReceipt(f.root, LEGACY_BUILD_RECIPE);
    let launch: VerifiedLspLaunch | undefined;
    resolveVizeLaunchCommand(undefined, f.binary, {
      required: true,
      repoRoot: f.root,
      buildRecipe: LEGACY_BUILD_RECIPE,
      onVerifiedLaunch: (verified) => {
        launch = verified;
      },
    });
    assert.ok(launch);
    const capture = new LspSessionCapture({
      repoRoot: f.root,
      outputRoot: path.join(f.root, "target/differential/lsp-sessions"),
      launch,
      callerStack: `Error\n    at snapshot (${pathToFileURL(witness).href}:11:41)`,
    });
    const reply = frameMessage({ jsonrpc: "2.0", id: 3, result: { items: [{ label: "🧪" }] } });
    capture.append("server", reply);
    capture.finish(23, null);
    const observed = JSON.parse(
      fs.readFileSync(path.join(capture.directory, "observation.json"), "utf8"),
    );
    assert.equal(observed.buildReceipt.recipe, LEGACY_BUILD_RECIPE);
    assert.deepEqual(observed.sourceWitnesses, [
      {
        path: "tests/snapshots/check/synthetic.ts",
        line: 11,
        column: 41,
        sha256: sha256(fs.readFileSync(witness)),
      },
    ]);
    assert.deepEqual(fs.readFileSync(path.join(capture.directory, "server.bin")), reply);
    assert.equal(observed.streams.server.truncated, false);
    assert.deepEqual(observed.process, { exitStatus: 23, signal: null, error: null });
    assert.equal(observed.acceptance.nativeHandled, 0);
  } finally {
    fs.rmSync(f.root, { recursive: true, force: true });
  }
});

test("actual request timeout retains late whole NULL response and unmatched dispatch timing", async () => {
  const f = fixture();
  fs.writeFileSync(
    f.binary,
    `#!${process.execPath}
if (process.argv[2] === "--version") { console.log("vize 1.0.0"); process.exit(0); }
let buffer = Buffer.alloc(0), held;
const send = message => {
  const body = JSON.stringify({ jsonrpc: "2.0", ...message });
  process.stdout.write("Content-Length: " + Buffer.byteLength(body) + "\\r\\n\\r\\n" + body);
};
process.stdin.on("data", chunk => {
  buffer = Buffer.concat([buffer, chunk]);
  while (true) {
    const end = buffer.indexOf("\\r\\n\\r\\n"); if (end < 0) return;
    const length = Number(buffer.subarray(0, end).toString().match(/Content-Length: (\\d+)/)[1]);
    if (buffer.length < end + 4 + length) return;
    const message = JSON.parse(buffer.subarray(end + 4, end + 4 + length));
    buffer = buffer.subarray(end + 4 + length);
    if (message.method === "hold") held = message.id;
    else if (message.method === "release") {
      send({ id: held, result: null }); send({ method: "released", params: { id: held } });
    } else if (message.method === "exit") process.exit(0);
    else send({ id: message.id, result: null });
  }
});
`,
    { mode: 0o755 },
  );
  writeBuildReceipt(f.root);
  const session = new LspSession({ repoRoot: f.root, binary: f.binary });
  const closed = once(session["process"], "close");
  try {
    assert.equal(await session.request("ready", null), null);
    await assert.rejects(session.request("hold", { original: true }, 1), {
      message: "Timed out waiting for hold",
    });
    const responses: unknown[] = [];
    session.responseObservers.push((message) => responses.push(message));
    session.notify("release", {});
    assert.deepEqual(await session.waitForNotification("released"), { id: 2 });
    assert.deepEqual(responses, [{ jsonrpc: "2.0", id: 2, result: null }]);
    await session.shutdown();
    assert.deepEqual(await closed, [0, null]);
    const captures = path.join(f.root, "target/differential/lsp-sessions");
    const directory = path.join(captures, fs.readdirSync(captures)[0]);
    const observation = JSON.parse(
      fs.readFileSync(path.join(directory, "observation.json"), "utf8"),
    );
    const timing = observation.requestTiming as {
      wallAnchor: string;
      monotonicAnchorNs: string;
      truncated: boolean;
      omittedEvents: number;
      events: Array<LspRequestTiming & { elapsedMs: number }>;
    };
    assert.ok(Number.isFinite(Date.parse(timing.wallAnchor)));
    assert.match(timing.monotonicAnchorNs, /^\d+$/);
    assert.equal(timing.truncated, false);
    assert.equal(timing.omittedEvents, 0);
    const events = timing.events.filter((event) => event.id === 2);
    assert.deepEqual(
      events.map(({ elapsedMs: _elapsedMs, ...event }) => event),
      [
        { phase: "request-before-write", id: 2, method: "hold", configuredTimeoutMs: 1 },
        { phase: "timeout-callback", id: 2, method: "hold", configuredTimeoutMs: 1 },
        { phase: "response-dispatch", id: 2, pendingFound: false },
      ],
    );
    assert.ok(events.every((event) => Number.isFinite(event.elapsedMs) && event.elapsedMs >= 0));
    assert.ok(
      events[0].elapsedMs <= events[1].elapsedMs && events[1].elapsedMs <= events[2].elapsedMs,
    );
    assert.ok(
      timing.events.some(
        (event) => event.phase === "response-dispatch" && event.id === 1 && event.pendingFound,
      ),
    );
    const client = decodeFrames(fs.readFileSync(path.join(directory, "client.bin"))).messages;
    assert.deepEqual(
      client.find((message) => message.id === 2),
      { jsonrpc: "2.0", id: 2, method: "hold", params: { original: true } },
    );
    const server = decodeFrames(fs.readFileSync(path.join(directory, "server.bin"))).messages;
    assert.deepEqual(
      server.find((message) => message.id === 2),
      { jsonrpc: "2.0", id: 2, result: null },
    );
    assert.equal(fs.readFileSync(path.join(directory, "stderr.bin"), "utf8"), "");
  } finally {
    await session.kill();
    fs.rmSync(f.root, { recursive: true, force: true });
  }
});
