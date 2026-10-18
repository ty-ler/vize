import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const fixture = path.join(root, "editors/vscode/test/fixtures");
const { createConfigurationWatchRegistration } = require(
  path.join(fixture, "initialize-response.cjs"),
) as {
  createConfigurationWatchRegistration: (root: string, id: string, uri?: string) => Packet;
};
type Packet = Record<string, unknown>;
const historicalWidePattern =
  "**/{vite.config.ts,vite.config.mts,vite.config.cts,vite.config.js,vite.config.mjs,vite.config.cjs,tsconfig.json,jsconfig.json,tsconfig.*.json}";

function registration(id: string, baseUri: string, pattern: string): Packet {
  return {
    id,
    jsonrpc: "2.0",
    method: "client/registerCapability",
    params: {
      registrations: [
        {
          id: "vize-config-watch-1",
          method: "workspace/didChangeWatchedFiles",
          registerOptions: { watchers: [{ kind: 7, globPattern: { baseUri, pattern } }] },
        },
      ],
    },
  };
}

test("known-file registration uses the native parent and escaped filename; historical wide default remains", () => {
  const workspace = "file:///historical-workspace";
  const historical = registration("watch-1", workspace, historicalWidePattern);
  assert.deepEqual(createConfigurationWatchRegistration(workspace, "watch-1"), historical);
  const parent = path.join(os.tmpdir(), "vize config", "packages", "app");
  const baseUri = pathToFileURL(parent + path.sep).href;
  // Native config_watchers::watcher escapes glob metacharacters and ECMAScript trim characters.
  for (const [filename, pattern] of [
    ["tsconfig.app.json", "tsconfig.app.json"],
    ["vite.config.mjs", "vite.config.mjs"],
    ["vite.config.ts", "vite.config.ts"],
    ["config[{}]?*.json", "config[[][{][}][]][?][*].json"],
    [
      " \tconfig\u00a0\u1680\u2000\u200a\u2028\u2029\u202f\u205f\u3000\ufeff.json ",
      "[ ][\t]config[\u00a0][\u1680][\u2000][\u200a][\u2028][\u2029][\u202f][\u205f][\u3000][\ufeff].json[ ]",
    ],
    ["config-雪-100%.json", "config-雪-100%.json"],
  ]) {
    const packet = createConfigurationWatchRegistration(
      workspace,
      "watch-1",
      pathToFileURL(path.join(parent, filename)).href,
    );
    assert.deepEqual(packet, registration("watch-1", baseUri, pattern));
    assert.throws(
      () => assert.deepEqual(historical, registration("watch-1", baseUri, pattern)),
      "old recursive workspace packet cannot pass the known-file oracle",
    );
  }
  const trimCodePoints = [
    9,
    10,
    11,
    12,
    13,
    32,
    0x00a0,
    0x1680,
    ...Array.from({ length: 11 }, (_, index) => 0x2000 + index),
    0x2028,
    0x2029,
    0x202f,
    0x205f,
    0x3000,
    0xfeff,
  ];
  for (const codePoint of trimCodePoints) {
    const character = String.fromCodePoint(codePoint);
    const filename = `${character}tsconfig.json${character}`;
    assert.deepEqual(
      createConfigurationWatchRegistration(
        workspace,
        "watch-1",
        baseUri + encodeURIComponent(filename),
      ),
      registration("watch-1", baseUri, `[${character}]tsconfig.json[${character}]`),
    );
  }
  for (const character of ["\u0085", "\u180e", "\u200b"]) {
    const filename = `${character}tsconfig.json${character}`;
    assert.deepEqual(
      createConfigurationWatchRegistration(
        workspace,
        "watch-1",
        baseUri + encodeURIComponent(filename),
      ),
      registration("watch-1", baseUri, filename),
    );
  }
  assert.throws(() =>
    createConfigurationWatchRegistration(workspace, "watch-1", "https://invalid/config.json"),
  );
});

test(
  "fake server emits the actual registration and records only real client ACK/change frames",
  { timeout: 10_000 },
  async (t) => {
    for (const filename of [
      undefined,
      "vite.config.ts",
      "vite.config.mjs",
      "packages/app/tsconfig.app.json",
    ]) {
      await t.test(filename ?? "unchanged default", async (caseContext) => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), "vize-watch-protocol-"));
        const logPath = path.join(directory, "events.jsonl");
        const workspace = pathToFileURL(path.join(directory, "workspace")).href;
        const uri = filename
          ? pathToFileURL(path.join(directory, "workspace", filename)).href
          : undefined;
        const env: NodeJS.ProcessEnv = { ...process.env, VIZE_TEST_SERVER_LOG: logPath };
        delete env.VIZE_TEST_SERVER_INITIALIZE_GATE;
        delete env.VIZE_TEST_SERVER_CONFIG_WATCH_URI;
        if (uri) env.VIZE_TEST_SERVER_CONFIG_WATCH_URI = uri;
        const child = spawn(process.execPath, [path.join(fixture, "fake-vize-server.cjs"), "lsp"], {
          env,
          stdio: ["pipe", "pipe", "pipe"],
        });
        const exited = once(child, "close");
        void exited.catch(() => {});
        let closed = false;
        let transportError: Error | undefined;
        const frames: Packet[] = [];
        const pending: Array<{
          resolve: (packet: Packet) => void;
          reject: (error: Error) => void;
        }> = [];
        const onAbort = () => {
          child.kill();
        };
        caseContext.signal.addEventListener("abort", onAbort, { once: true });
        child.on("close", () => {
          closed = true;
          for (const waiter of pending.splice(0))
            waiter.reject(new Error("fake closed before its expected LSP frame"));
        });
        const fail = (error: Error) => {
          transportError = error;
          child.kill();
          for (const waiter of pending.splice(0)) waiter.reject(error);
        };
        child.on("error", fail);
        child.stdin.on("error", fail);
        const queued: Packet[] = [];
        let input = Buffer.alloc(0);
        let stderr = "";
        child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
          stderr += chunk;
        });
        child.stdout.on("data", (chunk: Buffer) => {
          try {
            input = Buffer.concat([input, chunk]);
            for (;;) {
              const end = input.indexOf("\r\n\r\n");
              if (end === -1) break;
              const length = /^Content-Length: (\d+)$/im.exec(
                input.subarray(0, end).toString("ascii"),
              );
              assert.ok(length, "actual fake stdout uses LSP framing");
              const stop = end + 4 + Number(length[1]);
              if (input.length < stop) break;
              const packet = JSON.parse(input.subarray(end + 4, stop).toString("utf8")) as Packet;
              input = input.subarray(stop);
              frames.push(packet);
              const receive = pending.shift();
              if (receive) receive.resolve(packet);
              else queued.push(packet);
            }
          } catch (error) {
            fail(error instanceof Error ? error : new Error(String(error)));
          }
        });
        const receive = () => {
          if (transportError) return Promise.reject(transportError);
          if (queued.length) return Promise.resolve(queued.shift()!);
          if (closed) return Promise.reject(new Error("fake closed before receiving a frame"));
          return new Promise<Packet>((resolve, reject) => pending.push({ resolve, reject }));
        };
        const send = (packet: Packet) => {
          const body = Buffer.from(JSON.stringify(packet));
          child.stdin.write(
            Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`), body]),
          );
        };
        const entries = () =>
          fs
            .readFileSync(logPath, "utf8")
            .trim()
            .split("\n")
            .map((line) => JSON.parse(line) as Packet);
        try {
          const options = { typecheck: false };
          send({
            jsonrpc: "2.0",
            id: 1,
            method: "initialize",
            params: { rootUri: workspace, initializationOptions: options },
          });
          assert.equal((await receive()).id, 1);
          send({ jsonrpc: "2.0", method: "initialized", params: {} });
          const packet = await receive();
          const id = `vize-config-watch-register-${child.pid}`;
          const expected = uri
            ? registration(
                id,
                pathToFileURL(path.dirname(fileURLToPath(uri)) + path.sep).href,
                path.basename(filename!),
              )
            : registration(id, workspace, historicalWidePattern);
          assert.deepEqual(packet, expected);
          assert.equal(
            entries().filter((entry) => entry.event === "configuration-watch-ack").length,
            0,
          );
          assert.equal(
            entries().filter((entry) => entry.method === "workspace/didChangeWatchedFiles").length,
            0,
          );
          const response = { jsonrpc: "2.0", id, result: null };
          send(response);
          const changes = [{ uri: uri ?? `${workspace}/tsconfig.json`, type: 2 }];
          send({ jsonrpc: "2.0", method: "workspace/didChangeWatchedFiles", params: { changes } });
          send({ jsonrpc: "2.0", id: 2, method: "shutdown", params: null });
          assert.deepEqual(await receive(), { jsonrpc: "2.0", id: 2, result: null });
          send({ jsonrpc: "2.0", method: "exit" });
          assert.deepEqual(await exited, [0, null]);
          assert.equal(stderr, "");
          assert.equal(input.length, 0);
          const log = entries();
          const acknowledgements = log.filter((entry) => entry.event === "configuration-watch-ack");
          assert.equal(acknowledgements.length, 1);
          const acknowledgement = acknowledgements[0];
          assert.equal(new Date(String(acknowledgement.time)).toISOString(), acknowledgement.time);
          assert.deepEqual(acknowledgement, {
            event: "configuration-watch-ack",
            pid: child.pid,
            response,
            time: acknowledgement.time,
          });
          const watched = log.filter((entry) => entry.method === "workspace/didChangeWatchedFiles");
          assert.equal(watched.length, 1);
          assert.deepEqual((watched[0].params as Packet).changes, changes);
          assert.equal(frames.length, 3, "server must not fabricate watched-file notifications");
          const initialize = log.find((entry) => entry.method === "initialize");
          assert.ok(initialize);
          assert.deepEqual((initialize.params as Packet).initializationOptions, options);
          t.diagnostic(JSON.stringify({ filename: filename ?? null, pid: child.pid, frames, log }));
        } finally {
          caseContext.signal.removeEventListener("abort", onAbort);
          if (child.exitCode === null) child.kill();
          await exited;
          fs.rmSync(directory, { force: true, recursive: true });
        }
      });
    }
  },
);

test("shared fake preparation scopes the explicit URI to one scenario and clears it for default callers", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "vize-watch-env-"));
  const logPath = path.join(directory, "events.jsonl");
  const uri = pathToFileURL(path.join(directory, "tsconfig.app.json")).href;
  const modulePath = require.resolve("../../editors/vscode/test/suite/extension-host-support.cjs");
  const runtime = require("node:module") as {
    _load: (id: string, parent: unknown, isMain: boolean) => unknown;
  };
  const load = runtime._load;
  const previous = process.env.VIZE_TEST_SERVER_CONFIG_WATCH_URI;
  runtime._load = (id, parent, isMain) =>
    id === "vscode"
      ? {
          ConfigurationTarget: { Workspace: 1 },
          workspace: { getConfiguration: () => ({ update: async () => {} }) },
        }
      : load(id, parent, isMain);
  try {
    delete require.cache[modulePath];
    const { prepareConfiguredFakeServer } = require(modulePath) as {
      prepareConfiguredFakeServer: (options: {
        logPath: string;
        serverPath: string;
        configurationWatchUri?: string;
      }) => Promise<void>;
    };
    runtime._load = load;
    await prepareConfiguredFakeServer({
      logPath,
      serverPath: "fixture-server",
      configurationWatchUri: uri,
    });
    assert.equal(process.env.VIZE_TEST_SERVER_CONFIG_WATCH_URI, uri);
    await prepareConfiguredFakeServer({ logPath, serverPath: "fixture-server" });
    assert.equal(process.env.VIZE_TEST_SERVER_CONFIG_WATCH_URI, undefined);
  } finally {
    runtime._load = load;
    delete require.cache[modulePath];
    if (previous === undefined) delete process.env.VIZE_TEST_SERVER_CONFIG_WATCH_URI;
    else process.env.VIZE_TEST_SERVER_CONFIG_WATCH_URI = previous;
    fs.rmSync(directory, { force: true, recursive: true });
  }
});
