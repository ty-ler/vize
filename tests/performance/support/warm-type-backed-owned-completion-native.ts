import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { decodeFrames } from "../../differential/lsp-wire.ts";
import {
  digest,
  fixtureRoot,
  items,
  object,
  observedRoots,
  readFixture,
  type ObservedPair,
} from "./warm-type-backed-owned-completion-fixture.ts";

type Witness = {
  side: "before" | "after";
  stage: string;
  requestId: number;
  authored: { file: string; code: string; sha256: string };
  requestPosition: { line: number; character: number };
  root: string;
  virtualFile: string;
  position: number;
  virtualBody: string;
  virtualSHA256: string;
  configBody: string;
  configSHA256: string;
  portableVirtualSHA256: string;
  portableConfigSHA256: string;
};
type FileBody = { file: string; code: string; sha256: string };
type Ownership = {
  authored: Witness["authored"];
  requestPosition: Witness["requestPosition"];
  root: string;
  virtualFile: string;
  files: FileBody[];
  startup: unknown[];
  sockets: Array<{
    pipe: string;
    process: { pid: number; birth_ticks: number; executable: string };
  }>;
};
const witnesses = readFixture<Witness[]>("native-witnesses.json");

/** Derive the native cursor from actual complete source bytes, never from an offset allowance. */
export function validateNativeOwnership(pair: ObservedPair) {
  for (const side of [pair.before, pair.after]) {
    const client = decodeFrames(
      fs.readFileSync(path.join(side.wire.capture, "client.bin")),
    ).messages;
    const folders = client.filter(
      (message) => message.method === "workspace/didChangeWorkspaceFolders",
    );
    assert.deepEqual(folders, [
      {
        jsonrpc: "2.0",
        method: "workspace/didChangeWorkspaceFolders",
        params: {
          event: {
            added: [
              {
                uri: "file:///home/runner/_work/_temp/warm-pair/workspace-other",
                name: "original20",
              },
            ],
            removed: [],
          },
        },
      },
    ]);
    const opened = client.findIndex(
      (message) =>
        message.method === "textDocument/didOpen" &&
        object(object(message.params).textDocument).uri ===
          "file:///home/runner/_work/_temp/warm-pair/workspace-other/src/c/Comp0.vue",
    );
    assert.ok(
      opened > client.indexOf(folders[0]),
      "the original foreign document opens only after registration",
    );
  }
  const hosts = new Map<string, { code: string; position: number; root: string }>();
  for (const witness of witnesses) {
    const side = pair[witness.side];
    const roots = observedRoots(side);
    const row = side.rows.find((entry) => entry.requestId === witness.requestId);
    assert.ok(row);
    const ownership = row.ownerMigration as Ownership;
    assert.ok(ownership);
    assert.equal(row.stage, witness.stage);
    const historical = readFixture<{ sessionRoots: ObservedPair["before"]["sessionRoots"] }>(
      `${witness.side}-ownership.json`,
    );
    const originalRoots = observedRoots({ ...side, sessionRoots: historical.sessionRoots });
    assert.equal(roots.visit(ownership.root), originalRoots.visit(witness.root));
    assert.equal(roots.visit(ownership.virtualFile), originalRoots.visit(witness.virtualFile));
    assert.match(ownership.root, /\/projects\/[0-9a-f]{64}$/u);
    assert.ok(ownership.virtualFile.startsWith(`${ownership.root}/`));
    assert.deepEqual(ownership.authored, witness.authored);
    assert.deepEqual(ownership.requestPosition, witness.requestPosition);
    assert.deepEqual(object(row.params).position, witness.requestPosition);
    assert.equal(
      fileURLToPath(object(object(row.params).textDocument).uri as string),
      ownership.authored.file,
    );
    assert.equal(digest(ownership.authored.code), ownership.authored.sha256);
    const authoredLine = ownership.authored.code.split("\n")[witness.requestPosition.line];
    assert.equal(
      authoredLine.slice(witness.requestPosition.character, witness.requestPosition.character + 5),
      "count",
    );
    const host = ownership.files.find((file) => file.file === ownership.virtualFile);
    const config = ownership.files.find((file) => file.file === `${ownership.root}/tsconfig.json`);
    assert.ok(host && config);
    for (const file of [host, config]) assert.equal(digest(file.code), file.sha256);
    assert.equal(digest(roots.visit(host.code) as string), witness.portableVirtualSHA256);
    assert.equal(digest(roots.visit(config.code) as string), witness.portableConfigSHA256);
    // Archive complete raw bodies independently of the existing storage-root bijection.
    assert.equal(
      digest(fs.readFileSync(new URL(witness.virtualBody, fixtureRoot))),
      witness.virtualSHA256,
    );
    assert.equal(
      digest(fs.readFileSync(new URL(witness.configBody, fixtureRoot))),
      witness.configSHA256,
    );
    for (const item of items(row)) {
      const capability = object(object(item.data).vizeCompletion);
      assert.equal(fileURLToPath(capability.requestUri as string), ownership.virtualFile);
      const native = object(object(capability.item).data);
      assert.equal(native.fileName, ownership.virtualFile);
      assert.equal(native.position, witness.position);
      assert.equal(
        host.code.slice(native.position as number, (native.position as number) + 5),
        "count",
      );
    }
    hosts.set(`${witness.side}/${witness.stage}`, {
      code: host.code,
      position: witness.position,
      root: ownership.root,
    });
    if (witness.side === "after") validateStartup(ownership, config.code);
  }
  const before = hosts.get("before/cross-root")!;
  const after = hosts.get("after/cross-root")!;
  const importLines = (code: string) =>
    code.split("\n").filter((line) => line.startsWith("import "));
  const importsBefore = importLines(before.code),
    importsAfter = importLines(after.code);
  assert.equal(importsBefore.length, 5);
  assert.equal(importsAfter.length, 5);
  const external = "__vize_external__/home/runner/_work/_temp/warm-pair/workspace-other/";
  assert.equal(external.length, 68);
  assert.equal(importsBefore.filter((line) => line.includes(external)).length, 4);
  assert.equal(importsAfter.filter((line) => line.includes(external)).length, 0);
  assert.equal(importsBefore[0], importsAfter[0]);
  for (const [index, line] of importsBefore.slice(1).entries()) {
    assert.equal(line.split(`${before.root}/${external}`).length, 2);
    const rebound = line.replace(`${before.root}/${external}`, `${after.root}/`);
    assert.equal(
      rebound,
      importsAfter[index + 1],
      "the complete authored import symbol, order and target suffix remain exact",
    );
  }
  const delta = importsBefore.reduce(
    (sum, line, index) => sum + line.length - importsAfter[index].length,
    0,
  );
  assert.equal(delta, 272);
  const withoutImports = (code: string, offset: number) =>
    code
      .slice(0, offset)
      .split("\n")
      .filter((line) => !line.startsWith("import "))
      .join("\n");
  assert.equal(
    withoutImports(before.code, before.position),
    withoutImports(after.code, after.position),
  );
  assert.equal(before.position - after.position, delta);
  validateEpoch(pair.after);
}

function validateStartup(ownership: Ownership, configCode: string) {
  assert.equal(ownership.startup.length, 1);
  const startup = object(ownership.startup[0]);
  const configFile = `${ownership.root}/tsconfig.json`;
  assert.equal(startup.requestedConfig, configFile);
  assert.deepEqual(startup.result, { ok: true, response: { configFilePath: configFile } });
  const native = object(startup.nativeConfig);
  assert.equal(object(native.options).configFilePath, configFile);
  assert.equal(startup.memberUri, `file://${ownership.root}/__vize_vue_modules.d.ts`);
  assert.ok((native.fileNames as string[]).includes(ownership.virtualFile));
  const config = object(JSON.parse(configCode));
  assert.ok(Array.isArray(config.include));
  assert.deepEqual(
    (native.fileNames as string[]).toSorted(),
    config.include.map((name) => `${ownership.root}/${name}`).toSorted(),
  );
  const pipe = object(startup.apiAttachment).pipe;
  assert.equal(typeof pipe, "string");
  const socket = ownership.sockets.filter((entry) => entry.pipe === pipe);
  assert.equal(socket.length, 1, "the selected config must join one actual native socket owner");
  assert.ok(socket[0].process.pid > 0 && socket[0].process.birth_ticks > 0);
  assert.match(socket[0].process.executable, /\/typescript-linux-x64\/lib\/(?:tsc|tsgo)$/u);
}

function validateEpoch(side: ObservedPair["after"]) {
  const retired = side.changedInputs.filter((entry) => entry.name === "retired-native-epoch");
  const recovered = side.changedInputs.filter((entry) => entry.name === "recovered-native-epoch");
  assert.equal(retired.length, 1);
  assert.equal(recovered.length, 1);
  const old = retired[0].processes as Array<{ pid: number; birth_ticks: number }>;
  const current = recovered[0].processes as typeof old;
  assert.equal(old.length, 2, "registered primary and foreign owners remain independent");
  assert.equal(current.length, 1);
  assert.ok(
    current.every(
      (entry) =>
        !old.some(
          (previous) => previous.pid === entry.pid && previous.birth_ticks === entry.birth_ticks,
        ),
    ),
  );
  const retiredIdentities = retired[0].retired as Array<{ pid: number; birth_ticks: number }>;
  assert.deepEqual(
    retiredIdentities.map(({ pid, birth_ticks }) => ({ pid, birth_ticks })),
    old.map(({ pid, birth_ticks }) => ({ pid, birth_ticks })),
  );
  const cross = side.rows.find((row) => row.requestId === 72)!.ownerMigration as Ownership;
  const epoch = side.rows.find((row) => row.requestId === 80)!.ownerMigration as Ownership;
  const identity = (entry: { pid: number; birth_ticks: number }) =>
    `${entry.pid}:${entry.birth_ticks}`;
  assert.deepEqual(
    cross.sockets.map((entry) => identity(entry.process)).toSorted(),
    old.map(identity).toSorted(),
  );
  assert.deepEqual(
    epoch.sockets.map((entry) => identity(entry.process)),
    current.map(identity),
  );
  assert.equal(side.sessionRoots.physical.length, 3);
}
