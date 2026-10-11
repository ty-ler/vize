import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";
import {
  cases,
  cliPacket,
  lspPacket,
  policyCase,
  policySource,
} from "../../../tools/support/release/public_acceptance/component_inputs.ts";
import { ComponentLsp } from "../../../tools/support/release/public_acceptance/component_protocol.ts";
import {
  componentArchive,
  componentAsset,
  requireComponentChecksum,
} from "../../../tools/support/release/public_acceptance/component_release.ts";
import { judgePolicyLedger } from "../../../tools/support/release/public_acceptance/component_lsp.ts";

test("installed component input refuses any drift of the whole original 30-source corpus", () => {
  const bytes = readFileSync(
    new URL(
      "../../_fixtures/differential/lint/component-registration-context-8142/cases.json",
      import.meta.url,
    ),
  );
  assert.equal(cases(bytes).length, 30);
  const changed = Buffer.from(bytes);
  changed[changed.length - 1] ^= 1;
  assert.throws(() => cases(changed), /original complete corpus/u);
  assert.throws(() => cases(Buffer.concat([bytes, Buffer.from(" ")])), /original complete corpus/u);
});
test("whole public packets use scalar CLI and UTF-16 LSP coordinates across Unicode and CRLF", () => {
  const entry = policyCase(["my-owned"]);
  entry.source = "<template>界😀😀<my-neighbor/></template>\r\n";
  entry.authoredExpectedPacket.diagnostics[0].start = 22;
  entry.authoredExpectedPacket.diagnostics[0].end = 33;
  const cli = cliPacket(entry)[0];
  assert.deepEqual(
    cli.messages.map(({ line, column, endLine, endColumn }) => ({
      line,
      column,
      endLine,
      endColumn,
    })),
    [{ line: 1, column: 15, endLine: 1, endColumn: 26 }],
  );
  const lsp = lspPacket(entry, "file:///fresh/Policy.vue", 3);
  assert.deepEqual(lsp.params.diagnostics[0].range, {
    start: { line: 0, character: 16 },
    end: { line: 0, character: 27 },
  });
  assert.equal(
    cli.messages[0].help,
    "Import the component in <script setup> or register it in components option",
  );
  assert.equal(lsp.params.version, 3);
  const broken = policyCase(["my-owned"]);
  broken.authoredExpectedPacket.diagnostics[0].start = 16;
  assert.throws(() => cliPacket(broken), /UTF-8 boundary/u);
  assert.throws(() => lspPacket(broken, "file:///fresh/Policy.vue", 1), /UTF-8 boundary/u);
});
test("public component archive refuses missing, duplicate, foreign or incomplete uploaded assets", () => {
  const tag = "v0.999.0",
    asset = {
      name: componentArchive,
      state: "uploaded",
      id: 1,
      size: 10,
      browser_download_url: `https://github.com/ubugeeei-prod/vize/releases/download/${tag}/${componentArchive}`,
    };
  const release = { tag_name: tag, draft: false, prerelease: false, assets: [asset] };
  assert.equal(componentAsset(release, tag, componentArchive).id, 1);
  for (const bad of [
    { assets: [] },
    { assets: [asset, asset] },
    { draft: true },
    { prerelease: true },
    { tag_name: "v0.998.0" },
  ])
    assert.throws(() => componentAsset({ ...release, ...bad }, tag, componentArchive));
  for (const bad of [
    { state: "new" },
    { id: 0 },
    { size: 0 },
    { browser_download_url: asset.browser_download_url.replace("ubugeeei-prod", "foreign") },
  ])
    assert.throws(() =>
      componentAsset({ ...release, assets: [{ ...asset, ...bad }] }, tag, componentArchive),
    );
  const digest = "a".repeat(64),
    checksum = `${digest}  ${componentArchive}\n`;
  requireComponentChecksum(checksum, digest);
  for (const wrong of [
    checksum.replace(digest, "b".repeat(64)),
    checksum.replace(componentArchive, "other.tar.gz"),
    checksum + checksum,
    checksum.trimEnd(),
  ])
    assert.throws(() => requireComponentChecksum(wrong, digest));
});
function processFixture(t: TestContext, suffix: string) {
  const root = mkdtempSync(path.join(os.tmpdir(), "vize-component-protocol-law-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const packet = { jsonrpc: "2.0", id: 2, result: null },
    body = JSON.stringify(packet);
  writeFileSync(
    path.join(root, "lsp"),
    `const fs = require('node:fs');
const frame = Buffer.from(${JSON.stringify(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`)});
${suffix}
`,
  );
  return { lsp: new ComponentLsp(process.execPath, root), packet };
}
test("queued complete shutdown response still refuses an already exited nonzero process", async (t) => {
  const { lsp, packet } = processFixture(t, "fs.writeSync(1, frame); process.exit(7);");
  try {
    assert.deepEqual(await lsp.receive((message) => message.id === 2), packet);
    await new Promise((resolve) => setTimeout(resolve, 50));
    await assert.rejects(lsp.stop());
    assert.deepEqual(lsp.terminal().exit, { code: 7, signal: null });
    assert.ok(lsp.terminal().stdoutBase64);
  } finally {
    await lsp.abort();
  }
});
test("a normal exit with trailing partial frame retains bytes and refuses success", async (t) => {
  const { lsp } = processFixture(
    t,
    "fs.writeSync(1, Buffer.concat([frame, Buffer.from('Content-Length: 20\\r\\n')])); process.exit(0);",
  );
  try {
    await lsp.receive((message) => message.id === 2);
    await new Promise((resolve) => setTimeout(resolve, 50));
    await assert.rejects(lsp.stop(), /complete final frame/u);
    assert.equal(
      Buffer.from(lsp.terminal().undecodedBytesBase64, "base64").toString(),
      "Content-Length: 20\r\n",
    );
  } finally {
    await lsp.abort();
  }
});
test("closed server stdin becomes retained EPIPE evidence rather than an unhandled stream error", async (t) => {
  const { lsp } = processFixture(
    t,
    "fs.closeSync(0); fs.writeSync(1, frame); setTimeout(() => process.exit(0), 200);",
  );
  try {
    await lsp.receive((message) => message.id === 2);
    lsp.send({ jsonrpc: "2.0", id: 3, method: "shutdown" });
    await assert.rejects(
      lsp.receive((message) => message.id === 3),
      /EPIPE/u,
    );
    assert.match(lsp.terminal().fault!, /EPIPE/u);
  } finally {
    await lsp.abort();
  }
});
test("the complete reload ledger rejects an extra wrong sibling broadcast", () => {
  const owner = "file:///fresh/owned/Policy.vue",
    sibling = "file:///fresh/sibling/Policy.vue";
  const request = (uri: string, version: number) => ({
    direction: "request",
    message: {
      method: "textDocument/didOpen",
      params: { textDocument: { uri, version, text: policySource } },
    },
  });
  const packets = [
    lspPacket(policyCase(["my-owned"]), owner, 1),
    lspPacket(policyCase(["my-neighbor"]), sibling, 1),
    lspPacket(policyCase([]), owner, 1),
    lspPacket(policyCase(["my-neighbor"]), sibling, 2),
  ];
  const protocol = [
    request(owner, 1),
    { direction: "response", message: packets[0] },
    request(sibling, 1),
    { direction: "response", message: packets[1] },
    { direction: "request", message: { method: "workspace/didChangeWatchedFiles" } },
    { direction: "response", message: packets[2] },
    request(sibling, 2),
    { direction: "response", message: packets[3] },
  ];
  const terminal = {
    executable: "inert",
    pid: 1,
    protocol,
    publishedDiagnostics: packets,
    stdoutBase64: "",
    stderrBase64: "",
    stderrUtf8: "",
    undecodedBytesBase64: "",
    exit: { code: 0, signal: null },
    fault: null,
  };
  assert.equal(judgePolicyLedger(terminal, owner, sibling), 4);
  const wrong = lspPacket(policyCase([]), sibling, 2);
  assert.throws(
    () =>
      judgePolicyLedger(
        {
          ...terminal,
          protocol: [...protocol, { direction: "response", message: wrong }],
          publishedDiagnostics: [...packets, wrong],
        },
        owner,
        sibling,
      ),
    /own live policy/u,
  );
});
