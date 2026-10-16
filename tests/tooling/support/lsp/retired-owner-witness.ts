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

export async function retiredOwnerWitness(children: ChildObserver) {
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
  const graph = (gate: (typeof gates)[number]) => {
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
    fs.writeFileSync(configPath, JSON.stringify(config(gates[1].proxy)));
    session.notify("workspace/didChangeWatchedFiles", {
      changes: [{ uri: pathToFileURL(configPath).href, type: 2 }],
    });
    record("configuration-retirement-notified");
    observation.newOwnerQuery = {
      method: "textDocument/hover",
      params,
      result: await session.request("textDocument/hover", params, 10000),
    };
    assert.deepEqual((observation.newOwnerQuery as { result: unknown }).result, expected);
    const newGraph = graph(gates[1]);
    observation.newOwnerGraph = newGraph;
    assert.deepEqual(newGraph.map((entry) => entry.role).sort(), ["editor-lsp", "project-api"]);
    const oldLsp = oldGraph.find((entry) => entry.role === "editor-lsp")!;
    const heldLive = children(oldLsp.proxy.pid, native).find(
      (child) => child.pid === oldLsp.native.pid && child.birth_ticks === oldLsp.native.birth_ticks,
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
      for (const exit of exits)
        assert.deepEqual(
          exit,
          { code: 0, signal: null },
          "the actual native exits cleanly; a kill is never success",
        );
    }
    success = true;
  } catch (error) {
    observation.failure = error instanceof Error ? error.stack : String(error);
    throw error;
  } finally {
    polling = false;
    observation.responses = responses;
    observation.stderr = session.stderrText;
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
        path.join(capture, "retired-owner-inflight.json"),
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
