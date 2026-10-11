import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  config,
  lspPacket,
  policy,
  policyCase,
  policySource,
  save,
  unchanged,
  write,
  type ComponentCase,
} from "./component_inputs.ts";
import { ComponentLsp, message } from "./component_protocol.ts";

const uri = (file: string) => pathToFileURL(file).href;
async function initialize(lsp: ComponentLsp, folders: Array<{ uri: string; name: string }>) {
  lsp.send({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      processId: null,
      rootUri: null,
      workspaceFolders: folders,
      capabilities: {},
      initializationOptions: { editor: false, typecheck: false, lint: true },
    },
  });
  const actual = await lsp.receive((packet) => packet.id === 1);
  assert.equal(actual.error, undefined);
  assert.ok(actual.result);
  lsp.send({ jsonrpc: "2.0", method: "initialized", params: {} });
  return actual;
}
function open(lsp: ComponentLsp, fileUri: string, source: string) {
  lsp.send({
    jsonrpc: "2.0",
    method: "textDocument/didOpen",
    params: {
      textDocument: { uri: fileUri, languageId: "vue", version: 1, text: source },
    },
  });
}
function change(lsp: ComponentLsp, fileUri: string, source: string, version: number) {
  lsp.send({
    jsonrpc: "2.0",
    method: "textDocument/didChange",
    params: {
      textDocument: { uri: fileUri, version },
      contentChanges: [{ text: source }],
    },
  });
}
const publication = (lsp: ComponentLsp, fileUri: string, version: number) =>
  lsp.receive(
    (packet) =>
      packet.method === "textDocument/publishDiagnostics" &&
      message(packet.params).uri === fileUri &&
      message(packet.params).version === version,
  );
export function judgePolicyLedger(
  terminal: ReturnType<ComponentLsp["terminal"]>,
  ownerUri: string,
  siblingUri: string,
) {
  const versions = new Map<string, number>(),
    policies = new Map([
      [ownerUri, ["my-owned"]],
      [siblingUri, ["my-neighbor"]],
    ]);
  const judged = [];
  for (const event of terminal.protocol) {
    const packet = message(event.message);
    if (
      event.direction === "request" &&
      (packet.method === "textDocument/didOpen" || packet.method === "textDocument/didChange")
    ) {
      const document = message(message(packet.params).textDocument);
      assert.ok(typeof document.uri === "string" && policies.has(document.uri));
      assert.ok(typeof document.version === "number" && Number.isSafeInteger(document.version));
      versions.set(document.uri, document.version);
    }
    if (event.direction === "request" && packet.method === "workspace/didChangeWatchedFiles")
      policies.set(ownerUri, []);
    if (event.direction === "response" && packet.method === "textDocument/publishDiagnostics") {
      const params = message(packet.params);
      assert.ok(typeof params.uri === "string" && policies.has(params.uri));
      const version = versions.get(params.uri);
      assert.ok(version);
      assert.deepEqual(
        packet,
        lspPacket(policyCase(policies.get(params.uri)!), params.uri, version),
        "every complete reload publication follows its own live policy",
      );
      judged.push(packet);
    }
  }
  assert.deepEqual(
    judged,
    terminal.publishedDiagnostics,
    "complete publication ledger, including extra broadcasts",
  );
  assert.ok(judged.length >= 4);
  return judged.length;
}
async function shutdown(lsp: ComponentLsp) {
  lsp.send({ jsonrpc: "2.0", id: 2, method: "shutdown" });
  const packet = await lsp.receive((entry) => entry.id === 2);
  lsp.send({ jsonrpc: "2.0", method: "exit" });
  await lsp.stop();
  assert.deepEqual(packet, { jsonrpc: "2.0", id: 2, result: null });
  return packet;
}
export async function observeLsp(
  binary: string,
  workspace: string,
  output: string,
  entries: ComponentCase[],
) {
  const folders = entries.map((entry) => {
    const root = path.join(workspace, entry.id);
    write(root, entry.filename, entry.source);
    write(root, "vize.config.json", JSON.stringify(config(entry)));
    return { uri: uri(root), name: entry.id };
  });
  const lsp = new ComponentLsp(binary, workspace),
    observations = [];
  let initialized: unknown, stopped: unknown;
  try {
    initialized = await initialize(lsp, folders);
    for (const entry of entries) {
      const root = path.join(workspace, entry.id),
        fileUri = uri(path.join(root, entry.filename));
      for (const version of [1, 2, 3]) {
        if (version === 1) open(lsp, fileUri, entry.source);
        else change(lsp, fileUri, entry.source, version);
        const actual = await publication(lsp, fileUri, version);
        observations.push({
          caseId: entry.id,
          source: entry.source,
          config: config(entry),
          expected: lspPacket(entry, fileUri, version),
          actual,
        });
        save(output, "lsp-transport.json", {
          initialize: initialized,
          observations,
          terminal: lsp.terminal(),
        });
      }
      unchanged(root, entry.filename, entry.source);
      unchanged(root, "vize.config.json", JSON.stringify(config(entry)));
    }
    stopped = await shutdown(lsp);
    assert.equal(observations.length, 90);
    assert.equal(lsp.terminal().publishedDiagnostics.length, 90);
    for (const { actual, expected } of observations) assert.deepEqual(actual, expected);
    return { packets: observations.length };
  } finally {
    await lsp.abort();
    save(output, "lsp-transport.json", {
      initialize: initialized,
      shutdown: stopped,
      observations,
      terminal: lsp.terminal(),
    });
  }
}
export async function observePolicyReplacement(binary: string, workspace: string, output: string) {
  const roots = [path.join(workspace, "owned"), path.join(workspace, "sibling")];
  const policies = [["my-owned"], ["my-neighbor"]];
  const folders = roots.map((root, index) => {
    write(root, "Policy.vue", policySource);
    write(root, "vize.config.json", JSON.stringify(policy(policies[index])));
    return { uri: uri(root), name: String(index) };
  });
  const lsp = new ComponentLsp(binary, workspace),
    observations = [];
  let initialized: unknown, stopped: unknown;
  try {
    initialized = await initialize(lsp, folders);
    for (const [index, root] of roots.entries()) {
      const fileUri = uri(path.join(root, "Policy.vue"));
      open(lsp, fileUri, policySource);
      observations.push({
        expected: lspPacket(policyCase(policies[index]), fileUri, 1),
        actual: await publication(lsp, fileUri, 1),
      });
    }
    write(roots[0], "vize.config.json", JSON.stringify(policy([])));
    lsp.send({
      jsonrpc: "2.0",
      method: "workspace/didChangeWatchedFiles",
      params: {
        changes: [{ uri: uri(path.join(roots[0], "vize.config.json")), type: 2 }],
      },
    });
    const ownerUri = uri(path.join(roots[0], "Policy.vue"));
    observations.push({
      expected: lspPacket(policyCase([]), ownerUri, 1),
      actual: await publication(lsp, ownerUri, 1),
    });
    const siblingUri = uri(path.join(roots[1], "Policy.vue"));
    change(lsp, siblingUri, policySource, 2);
    observations.push({
      expected: lspPacket(policyCase(policies[1]), siblingUri, 2),
      actual: await publication(lsp, siblingUri, 2),
    });
    stopped = await shutdown(lsp);
    assert.equal(observations.length, 4);
    for (const { actual, expected } of observations) assert.deepEqual(actual, expected);
    const completePublications = judgePolicyLedger(lsp.terminal(), ownerUri, siblingUri);
    for (const root of roots) unchanged(root, "Policy.vue", policySource);
    unchanged(roots[0], "vize.config.json", JSON.stringify(policy([])));
    unchanged(roots[1], "vize.config.json", JSON.stringify(policy(policies[1])));
    return {
      packets: observations.length,
      completePublications,
    };
  } finally {
    await lsp.abort();
    save(output, "lsp-policy-replacement.json", {
      source: policySource,
      initialize: initialized,
      shutdown: stopped,
      observations,
      terminal: lsp.terminal(),
    });
  }
}
