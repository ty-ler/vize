import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  isReaped,
  observeReaped,
} from "../../../performance/support/warm-type-backed-processes.ts";
import { offsetToPosition } from "./assertions.ts";
import { LspRequestError, LspSession } from "./session.ts";

type Witness = {
  pid: number;
  birth_ticks: number;
  parent: number;
  executable: string;
  executableSha256: string;
  commandBase64: string;
  commandArguments: string[];
  wholeStatBefore: string;
  wholeStatAfter: string;
};
type ChildObserver = (parent: number, executable: string) => Witness[];
type OwnerGraph = Array<{
  owner: string;
  role: "editor-lsp" | "project-api";
  proxy: Witness;
  native: Witness;
}>;
type CustodyJournal = {
  kind: "retired" | "active" | "recovered";
  owner?: "old" | "new";
  rawLine: string;
  json: string;
  receipt: Record<string, unknown>;
};
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const fixture = new URL(
  "../../../_fixtures/differential/lsp/canceled-native-hover/",
  import.meta.url,
);

function actualProbe(identity: Witness) {
  try {
    const wholeStat = fs.readFileSync(`/proc/${identity.pid}/stat`, "utf8");
    const fields = wholeStat
      .slice(wholeStat.lastIndexOf(") ") + 2)
      .trim()
      .split(/\s+/u);
    assert.match(fields[19], /^\d+$/u);
    return {
      ...identity,
      current: { birth_ticks: Number(fields[19]), state: fields[0], wholeStat },
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { ...identity, current: null };
    throw error;
  }
}

function object(value: unknown, label: string): Record<string, unknown> {
  assert.ok(
    value !== null && typeof value === "object" && !Array.isArray(value),
    `${label} must be a complete object`,
  );
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, keys: string[]) {
  assert.deepEqual(
    Object.keys(value).sort(),
    keys.toSorted(),
    "the frozen custody schema must stay complete",
  );
}

function rawErrors(value: unknown): string[] {
  assert.ok(
    Array.isArray(value) && value.every((entry) => typeof entry === "string" && entry.length > 0),
  );
  return value;
}

/** Keep complete source event lines; JSON is the sole final trace field. */
function custodyJournal(stderr: string): CustodyJournal[] {
  const journal: CustodyJournal[] = [];
  const events = [
    {
      kind: "recovered" as const,
      target: "vize_canon::lsp_client::startup_control",
      message: "recovered native owner terminal custody",
    },
    {
      kind: "retired" as const,
      target: "vize_maestro::server::state::corsa_shutdown::retired",
      message: "retired native owner terminal custody",
    },
    {
      kind: "active" as const,
      target: "vize_canon::corsa_bridge::bridge::shutdown",
      message: "native active owner shutdown custody",
    },
  ];
  for (const rawLine of stderr.split("\n")) {
    const line = rawLine.replace(/\u001b\[[0-?]*[ -/]*[@-~]/gu, "");
    for (const event of events) {
      const marker = `${event.target}: ${event.message} receipt=`;
      const start = line.indexOf(marker);
      if (start < 0) continue;
      assert.match(line.slice(0, start), /\bINFO\s+$/u);
      const json = line.slice(start + marker.length).trim();
      assert.ok(json.startsWith("{"), "the custody event must retain its complete JSON tail");
      journal.push({
        kind: event.kind,
        rawLine,
        json,
        receipt: object(JSON.parse(json), "custody receipt"),
      });
    }
  }
  return journal;
}

function assertCustodyJournal(
  journal: CustodyJournal[],
  owners: { old: OwnerGraph; new: OwnerGraph },
  mode: "held" | "killed",
) {
  const closed = new Set<string>();
  const terminals = new Set<number>();
  const sequences = { old: new Set<number>(), new: new Set<number>() };
  const published = { old: 0, new: 0 };
  const historicalFailures: CustodyJournal[] = [];
  for (const event of journal) {
    const receipt = event.receipt;
    const recovered = event.kind === "recovered";
    exactKeys(
      receipt,
      recovered
        ? ["children", "retirementError", "observedCount", "publishedCount"]
        : [
            "custody_complete",
            "raw_errors",
            "expectedOwnedPids",
            "children",
            "attachedBindings",
            "missingAttachmentBinding",
            "observedCount",
            "publishedCount",
            "pendingCleanupHandles",
            "pendingStartupCustody",
          ],
    );
    assert.ok(Array.isArray(receipt.children));
    const children = receipt.children.map((child) => object(child, "owned child"));
    const pids = children.map((child) => child.expectedPid);
    assert.ok(pids.every((pid) => Number.isSafeInteger(pid) && Number(pid) > 0));
    assert.equal(new Set(pids).size, pids.length);
    assert.ok(
      Number.isSafeInteger(receipt.observedCount) && Number.isSafeInteger(receipt.publishedCount),
    );
    assert.ok((receipt.observedCount as number) >= 0 && (receipt.publishedCount as number) >= 0);
    if (recovered) {
      assert.ok(
        children.length > 0,
        "recovery publication must retain actual complete terminal rows",
      );
      assert.ok(
        receipt.retirementError === null ||
          (typeof receipt.retirementError === "string" && receipt.retirementError.length > 0),
      );
    } else {
      assert.equal(
        receipt.custody_complete,
        true,
        "missing or incomplete process custody cannot permit a successful shutdown",
      );
      assert.equal(receipt.pendingCleanupHandles, 0);
      assert.equal(receipt.pendingStartupCustody, false);
      assert.equal(receipt.missingAttachmentBinding, false);
      assert.deepEqual(
        receipt.attachedBindings,
        [],
        "this fixture observes two owned SDK proxy processes, not an API attachment",
      );
      assert.ok(Array.isArray(receipt.expectedOwnedPids));
      assert.deepEqual(
        receipt.expectedOwnedPids.toSorted((a, b) => a - b),
        pids.toSorted((a, b) => Number(a) - Number(b)),
      );
      if (receipt.observedCount === 0) {
        assert.equal(receipt.publishedCount, 0);
        assert.deepEqual(children, []);
        assert.deepEqual(rawErrors(receipt.raw_errors), []);
        continue; // Empty owners cannot replace either physically witnessed owner's final closure.
      }
    }
    const candidates = Object.entries(owners).filter(
      ([, graph]) =>
        (recovered || (event.kind === "retired" ? graph === owners.old : graph === owners.new)) &&
        pids.every((pid) => graph.some((entry) => entry.proxy.pid === pid)),
    );
    assert.equal(
      candidates.length,
      1,
      "every reported owned PID must match the physically witnessed API/editor proxy graph",
    );
    const [ownerName, graph] = candidates[0];
    assert.ok(ownerName === "old" || ownerName === "new");
    const owner = ownerName;
    event.owner = owner;
    assert.equal(receipt.publishedCount, published[owner]);
    assert.equal(receipt.observedCount, 2);
    if (recovered) {
      assert.ok(!closed.has(owner), "recovery cannot publish after the owner's final closure");
      assert.ok(published[owner] + children.length <= 2);
    } else {
      assert.equal(published[owner] + children.length, 2);
      closed.add(owner);
    }
    const failedOld = mode === "killed" && owner === "old";
    const errors = recovered ? [] : rawErrors(receipt.raw_errors);
    if (failedOld && (recovered ? receipt.retirementError !== null : errors.length > 0))
      historicalFailures.push(event);
    if (!failedOld) {
      assert.deepEqual(errors, []);
      if (recovered) assert.equal(receipt.retirementError, null);
    }
    for (const child of children) {
      const expected = graph.find((entry) => entry.proxy.pid === child.expectedPid);
      assert.ok(expected);
      assert.ok(
        !terminals.has(expected.proxy.pid),
        "each physical owner terminal must appear exactly once",
      );
      terminals.add(expected.proxy.pid);
      assert.ok(child.spawnSequence === 1 || child.spawnSequence === 2);
      assert.ok(!sequences[owner].has(child.spawnSequence));
      sequences[owner].add(child.spawnSequence);
      exactKeys(child, [
        "spawnSequence",
        "expectedPid",
        "role",
        "terminal",
        "raw_errors",
        "close_error",
        "stderrCustody",
      ]);
      assert.notEqual(
        child.expectedPid,
        expected.native.pid,
        "SDK custody names the Node proxy; the actual pinned native leaf is witnessed separately",
      );
      assert.equal(child.role, expected.role === "project-api" ? "api" : "editor-lsp");
      assert.equal(child.close_error, null);
      const killed = failedOld && expected.role === "editor-lsp";
      const status = `ExitStatus(unix_wait_status(${killed ? 9 : 0}))`;
      assert.deepEqual(child.terminal, {
        pid: expected.proxy.pid,
        status,
        exitCode: killed ? null : 0,
        signal: killed ? 9 : null,
        killRequested: false,
        timedOut: false,
        reaped: true,
      });
      const childErrors = rawErrors(child.raw_errors);
      if (!killed) assert.deepEqual(childErrors, []);
      if (!recovered)
        for (const error of childErrors)
          assert.ok(
            errors.includes(error),
            "the complete top-level journal must retain every child error verbatim",
          );
      const stderr = object(child.stderrCustody, "stderr custody");
      if (expected.role === "project-api")
        assert.deepEqual(stderr, { mode: "inherited-server-stderr" });
      else {
        exactKeys(stderr, ["mode", "receipts"]);
        assert.equal(stderr.mode, "observed-editor");
        assert.ok(Array.isArray(stderr.receipts));
        assert.equal(stderr.receipts.length, 1);
        const row = object(stderr.receipts[0], "complete editor stderr receipt");
        exactKeys(row, [
          "pid",
          "completed",
          "bytes",
          "stderrComplete",
          "stderrError",
          "processError",
          "status",
          "timedOut",
          "killRequested",
          "reaped",
        ]);
        assert.ok(
          Array.isArray(row.bytes) &&
            row.bytes.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255),
          "every native stderr byte must remain lossless",
        );
        assert.deepEqual(row, {
          pid: expected.proxy.pid,
          completed: true,
          bytes: killed ? row.bytes : [],
          stderrComplete: true,
          stderrError: null,
          processError: null,
          status,
          timedOut: false,
          killRequested: false,
          reaped: true,
        });
      }
    }
    published[owner] += children.length;
  }
  assert.deepEqual(
    [...closed].sort(),
    ["new", "old"],
    "both retired and current final closed-custody receipts remain mandatory after recovery pruning",
  );
  assert.deepEqual(
    [...terminals].sort((a, b) => a - b),
    [...owners.old, ...owners.new].map((entry) => entry.proxy.pid).sort((a, b) => a - b),
    "the complete recovery/final union must contain every exact physical proxy PID once",
  );
  for (const owner of ["old", "new"] as const) {
    assert.equal(published[owner], 2);
    assert.deepEqual([...sequences[owner]].sort(), [1, 2]);
  }
  if (mode === "killed")
    assert.ok(
      historicalFailures.length > 0,
      "the killed old owner's full protocol failure must remain in its recovered retirementError or final raw_errors",
    );
}

export async function retiredOwnerWitness(
  children: ChildObserver,
  mode: "held" | "killed" = "held",
) {
  assert.equal(
    process.env.VIZE_LSP_REQUIRE_SOURCE_BUILD,
    "1",
    "complete source-bound raw wire/stderr capture is required",
  );
  assert.ok(process.env.VIZE_LSP_BIN, "this proof uses the action's prebuilt attested CLI");
  const manifest = createRequire(import.meta.url).resolve(
    "@typescript/typescript-linux-x64/package.json",
  );
  const manifestBytes = fs.readFileSync(manifest);
  const metadata = JSON.parse(manifestBytes.toString("utf8"));
  assert.equal(metadata.version, "7.0.2");
  const native = fs.realpathSync(path.join(path.dirname(manifest), "lib/tsc"));
  const nativeSha256 = digest(fs.readFileSync(native));
  const node = fs.realpathSync(process.execPath);
  const provider = process.env.VIZE_EDITOR_CONFIG_VUE_ROOT;
  assert.ok(provider);
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "vize-retired-inflight-"));
  fs.mkdirSync(path.join(workspace, "node_modules"));
  fs.mkdirSync(path.join(workspace, "src"));
  fs.symlinkSync(fs.realpathSync(provider), path.join(workspace, "node_modules/vue"), "dir");
  const source = fs.readFileSync(new URL("SlotAuthoring.vue.txt", fixture), "utf8");
  fs.writeFileSync(path.join(workspace, "src/SlotAuthoring.vue"), source);
  fs.copyFileSync(new URL("tsconfig.json", fixture), path.join(workspace, "tsconfig.json"));
  const proxyBytes = fs.readFileSync(new URL("held-native.js", fixture));
  const gates = ["old", "new"].map((role) => {
    const root = path.join(workspace, role);
    fs.mkdirSync(root);
    fs.writeFileSync(path.join(root, "package.json"), '{"type":"commonjs"}');
    const proxy = path.join(root, "tsgo.js");
    fs.writeFileSync(proxy, proxyBytes, { mode: 0o755 });
    fs.writeFileSync(path.join(root, "gate.json"), JSON.stringify({ runtime: native, root }));
    return { role, root, proxy };
  });
  const config = (proxy: string) => ({
    typeChecker: { corsaPath: proxy, checkFallthroughAttrs: false },
    lsp: { typecheck: true, lint: false, hover: true },
  });
  const configPath = path.join(workspace, "vize.config.json");
  fs.writeFileSync(configPath, JSON.stringify(config(gates[0].proxy)));
  const session = new LspSession();
  const events: Array<Record<string, unknown>> = [];
  const record = (name: string, value: unknown = null) =>
    events.push({ name, at: Date.now(), value });
  const observation: Record<string, unknown> = {
    mode,
    workspace,
    source,
    native,
    nativeSha256,
    nativeBytes: fs.statSync(native).size,
    nativeManifestBytesBase64: manifestBytes.toString("base64"),
    nativeManifestSha256: digest(manifestBytes),
    proxyBytesBase64: proxyBytes.toString("base64"),
    proxySha256: digest(proxyBytes),
    node,
    vizePid: session.processId,
    events,
    configurations: gates.map((gate) => config(gate.proxy)),
    tsconfigBytesBase64: fs.readFileSync(path.join(workspace, "tsconfig.json")).toString("base64"),
  };
  const responses: unknown[] = [];
  session.responseObservers.push((message) => responses.push(message));
  const graph = (gate: (typeof gates)[number]): OwnerGraph => {
    const proxies = children(session.processId, node).filter((child) =>
      child.commandArguments.includes(gate.proxy),
    );
    assert.equal(proxies.length, 2, `${gate.role} owner must expose actual API and LSP proxies`);
    return proxies.map((proxy) => {
      const nativeChildren = children(proxy.pid, native);
      assert.equal(
        nativeChildren.length,
        1,
        "each proxy owns one physically verified pinned native child",
      );
      const image = nativeChildren[0];
      assert.equal(image.executableSha256, nativeSha256);
      const role = proxy.commandArguments.includes("--lsp") ? "editor-lsp" : "project-api";
      assert.ok(proxy.commandArguments.includes(role === "editor-lsp" ? "--lsp" : "--api"));
      assert.ok(image.commandArguments.includes(role === "editor-lsp" ? "--lsp" : "--api"));
      return { owner: gate.role, role, proxy, native: image };
    });
  };
  let success = false;
  let polling = true;
  try {
    observation.initialize = await session.initialize(workspace, {
      editor: true,
      hover: true,
      typecheck: true,
      lint: false,
    });
    const uri = pathToFileURL(path.join(workspace, "src/SlotAuthoring.vue")).href;
    session.notify("textDocument/didOpen", {
      textDocument: { uri, languageId: "vue", version: 1, text: source },
    });
    const member = source.lastIndexOf("names.current") + "names.".length;
    const params = { textDocument: { uri }, position: offsetToPosition(source, member + 1) };
    const expected = {
      contents: {
        kind: "markdown",
        value:
          '```typescript\n(property) current: "summary"\n```\n**Primary** invoice slot shown in the summary.',
      },
      range: { start: offsetToPosition(source, member), end: offsetToPosition(source, member + 7) },
    };
    observation.warmQuery = {
      method: "textDocument/hover",
      params,
      result: await session.request("textDocument/hover", params, 10000),
    };
    assert.deepEqual((observation.warmQuery as { result: unknown }).result, expected);
    const oldGraph = graph(gates[0]);
    observation.oldOwnerGraph = oldGraph;
    assert.deepEqual(oldGraph.map((entry) => entry.role).sort(), ["editor-lsp", "project-api"]);
    fs.writeFileSync(path.join(gates[0].root, "arm"), "");
    let heldId = 0;
    const held = session
      .request("textDocument/hover", params, 10000, (id) => {
        heldId = id;
        return [];
      })
      .then(
        (result) => ({ result }),
        (error: unknown) => ({ error }),
      );
    const enteredDeadline = Date.now() + 5_000;
    while (!fs.existsSync(path.join(gates[0].root, "entered"))) {
      assert.ok(
        Date.now() < enteredDeadline,
        "the actual native hover response must enter the byte-preserving gate",
      );
      await pause(5);
    }
    record("old-native-response-held");
    const nativeRequest = JSON.parse(
      fs.readFileSync(path.join(gates[0].root, "held-request.json"), "utf8"),
    );
    const nativeResponse = JSON.parse(
      fs.readFileSync(path.join(gates[0].root, "held-response.json"), "utf8"),
    );
    observation.heldNative = { request: nativeRequest, response: nativeResponse };
    assert.equal(nativeRequest.method, "textDocument/hover");
    const position = nativeRequest.params.position;
    assert.deepEqual(nativeResponse, {
      jsonrpc: "2.0",
      id: nativeRequest.id,
      result: {
        contents: expected.contents,
        range: {
          start: { line: position.line, character: position.character - 1 },
          end: { line: position.line, character: position.character + 6 },
        },
      },
    });
    session.notify("$/cancelRequest", { id: heldId });
    const canceled = await held;
    assert.ok(
      "error" in canceled &&
        canceled.error instanceof LspRequestError &&
        canceled.error.code === -32800,
    );
    record("old-caller-canceled", { code: canceled.error.code, id: heldId });
    assert.deepEqual(
      responses.find((response) => (response as { id?: number }).id === heldId),
      {
        jsonrpc: "2.0",
        id: heldId,
        error: { code: -32800, message: "Canceled" },
      },
    );
    const oldLsp = oldGraph.find((entry) => entry.role === "editor-lsp")!;
    if (mode === "killed") {
      const proxy = children(session.processId, node).find(
        (entry) => entry.pid === oldLsp.proxy.pid && entry.birth_ticks === oldLsp.proxy.birth_ticks,
      );
      assert.ok(proxy, "the fault target's proxy is still a direct Vize child");
      const target = children(proxy.pid, native).find(
        (entry) =>
          entry.pid === oldLsp.native.pid && entry.birth_ticks === oldLsp.native.birth_ticks,
      );
      assert.ok(
        target,
        "the injected fault must target the exact previously witnessed native life",
      );
      assert.equal(target.executableSha256, nativeSha256);
      const last = actualProbe(target);
      assert.equal(last.current?.birth_ticks, target.birth_ticks);
      assert.notEqual(last.current?.state, "Z");
      assert.equal(fs.realpathSync(`/proc/${target.pid}/exe`), native);
      observation.faultControl = {
        purpose: "injected backend fault, never successful shutdown cleanup",
        signal: "SIGKILL",
        target,
        proxy,
        beforeSignal: last,
      };
      // No await separates this final PID/birth/image verification from the deliberate fault.
      const delivered = process.kill(target.pid, "SIGKILL");
      Object.assign(observation.faultControl as object, { signalDelivered: delivered });
      record("old-native-explicit-fault", observation.faultControl);
    }
    fs.writeFileSync(configPath, JSON.stringify(config(gates[1].proxy)));
    session.notify("workspace/didChangeWatchedFiles", {
      changes: [{ uri: pathToFileURL(configPath).href, type: 2 }],
    });
    record("configuration-retirement-notified");
    let newQueryId = 0;
    observation.newOwnerQuery = {
      method: "textDocument/hover",
      params,
      result: await session.request("textDocument/hover", params, 10000, (id) => {
        newQueryId = id;
        return [];
      }),
    };
    assert.deepEqual((observation.newOwnerQuery as { result: unknown }).result, expected);
    assert.deepEqual(
      responses.find((response) => (response as { id?: number }).id === newQueryId),
      {
        jsonrpc: "2.0",
        id: newQueryId,
        result: expected,
      },
    );
    const newGraph = graph(gates[1]);
    observation.newOwnerGraph = newGraph;
    assert.deepEqual(newGraph.map((entry) => entry.role).sort(), ["editor-lsp", "project-api"]);
    if (mode === "held") {
      const heldLive = children(oldLsp.proxy.pid, native).find(
        (child) =>
          child.pid === oldLsp.native.pid && child.birth_ticks === oldLsp.native.birth_ticks,
      );
      observation.oldStillInflightAfterNewOwner = heldLive;
      assert.ok(
        heldLive,
        "the retired old native owner must remain genuinely in flight after new-owner admission",
      );
      assert.ok(!fs.existsSync(path.join(gates[0].root, "release")));
      const deadline = Date.now() + 5_000;
      record("shutdown-started");
      const shutdown = session.request("shutdown", undefined, 5000).then(
        (response) => {
          record("shutdown-response", response);
          return { kind: "response" as const, response };
        },
        (error: unknown) => {
          record("shutdown-error", String(error));
          return { kind: "error" as const, error };
        },
      );
      const probes: unknown[] = [];
      observation.newOwnerClosureProbes = probes;
      const newIdentities = newGraph.flatMap((entry) => [entry.proxy, entry.native]);
      const newClosure = (async () => {
        while (polling) {
          const observed = newIdentities.map(actualProbe);
          probes.push({ at: Date.now(), observed });
          if (observed.every((entry) => isReaped(entry, entry.current)))
            return { kind: "reaped" as const };
          assert.ok(
            Date.now() < deadline,
            "new-owner closure shares the original five-second shutdown deadline",
          );
          await pause(25);
        }
        return { kind: "aborted" as const };
      })();
      const frontier = await Promise.race([newClosure, shutdown]);
      observation.newOwnerClosureFrontier = frontier;
      polling = false;
      await newClosure;
      assert.equal(
        frontier.kind,
        "reaped",
        "shutdown ACK must not bypass the still-held retired owner",
      );
      record("new-owner-actually-reaped");
      observation.vizeAtHeldFrontier = {
        wholeStat: fs.readFileSync(`/proc/${session.processId}/stat`, "utf8"),
        executable: fs.realpathSync(`/proc/${session.processId}/exe`),
      };
      observation.oldStillInflightAfterNewClosure = children(oldLsp.proxy.pid, native);
      assert.ok(
        (observation.oldStillInflightAfterNewClosure as Witness[]).some(
          (child) =>
            child.pid === oldLsp.native.pid && child.birth_ticks === oldLsp.native.birth_ticks,
        ),
      );
      const pending = await Promise.race([
        shutdown,
        pause(100).then(() => ({ kind: "pending" as const })),
      ]);
      observation.heldShutdownFrontier = pending;
      assert.equal(
        pending.kind,
        "pending",
        "new-owner closure cannot hide an omitted retired-owner join",
      );
      assert.ok(Date.now() < deadline);
      record("old-native-response-release");
      fs.writeFileSync(path.join(gates[0].root, "release"), "");
      const terminal = await shutdown;
      observation.shutdownTerminal = terminal;
      assert.deepEqual(terminal, { kind: "response", response: null });
    } else {
      record("recovered-owner-shutdown-started");
      let shutdownId = 0;
      observation.shutdownTerminal = await session.request("shutdown", undefined, 5000, (id) => {
        shutdownId = id;
        return [];
      });
      assert.equal(observation.shutdownTerminal, null);
      assert.deepEqual(
        responses.find((response) => (response as { id?: number }).id === shutdownId),
        {
          jsonrpc: "2.0",
          id: shutdownId,
          result: null,
        },
      );
      const atAck = [...oldGraph, ...newGraph]
        .flatMap((entry) => [entry.proxy, entry.native])
        .map(actualProbe);
      observation.allOwnerIdentitiesAtShutdownAck = atAck;
      assert.ok(
        atAck.every((entry) => isReaped(entry, entry.current)),
        "a null recovered shutdown ACK requires both exact API/editor owner lives already reaped; same-birth zombies fail",
      );
      record("all-recovered-owner-identities-absent-at-ack");
    }
    observation.serverExit = await session.finishInput("exit");
    assert.deepEqual(observation.serverExit, { exitCode: 0, signal: null });
    const all = [...oldGraph, ...newGraph].flatMap((entry) => [entry.proxy, entry.native]);
    observation.allOwnerReaping = await observeReaped(all);
    assert.equal(
      (observation.allOwnerReaping as { reaped: boolean }).reaped,
      true,
      "every old/new proxy and native child must be absent or have a different birth; zombies fail",
    );
    for (const gate of gates) {
      const exits = fs
        .readFileSync(path.join(gate.root, "native.exits"), "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      assert.ok(exits.length >= 2);
      if (mode === "killed" && gate.role === "old") {
        const killed = exits.filter((exit) => exit.code === null && exit.signal === "SIGKILL");
        assert.equal(killed.length, 1, "retain exactly the explicitly injected old native fault");
        for (const exit of exits.filter((exit) => exit.signal !== "SIGKILL"))
          assert.deepEqual(
            exit,
            { code: 0, signal: null },
            "the other old API owner and probes must exit cleanly",
          );
      } else
        for (const exit of exits)
          assert.deepEqual(
            exit,
            { code: 0, signal: null },
            "the actual native exits cleanly; a kill is never success",
          );
    }
    const journal = custodyJournal(session.stderrText);
    observation.typedRetirementJournal = journal;
    assertCustodyJournal(journal, { old: oldGraph, new: newGraph }, mode);
    success = true;
  } catch (error) {
    observation.failure = error instanceof Error ? error.stack : String(error);
    throw error;
  } finally {
    polling = false;
    observation.responses = responses;
    observation.stderr = session.stderrText;
    if (!observation.typedRetirementJournal) {
      try {
        observation.typedRetirementJournal = custodyJournal(session.stderrText);
      } catch (error) {
        observation.typedJournalParseFailure = error instanceof Error ? error.stack : String(error);
      }
    }
    observation.gateEvidence = gates.map((gate) => ({
      ...gate,
      files: Object.fromEntries(
        fs
          .readdirSync(gate.root)
          .map((name) => [name, fs.readFileSync(path.join(gate.root, name)).toString("base64")]),
      ),
    }));
    const capture = process.env.VIZE_NATIVE_RETIREMENT_CAPTURE_DIR;
    if (capture) {
      fs.mkdirSync(capture, { recursive: true });
      fs.writeFileSync(
        path.join(
          capture,
          mode === "held" ? "retired-owner-inflight.json" : "retired-owner-killed.json",
        ),
        `${JSON.stringify(observation, null, 2)}\n`,
      );
    }
    // Preserve the original failure and held-byte frontier before emergency cleanup.
    if (!success) {
      fs.writeFileSync(path.join(gates[0].root, "release"), "");
      await session.finishInput("exit").catch(() => session.kill().catch(() => undefined));
    }
    fs.rmSync(workspace, { recursive: true, force: true });
  }
}
