// Drive the packaged Emacs integration through real Eglot, with every native
// packet retained by the shared transparent tap. No simulated LSP connection.
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { resolveRealServerPath } from "../editor-e2e/real-vue-workspace.mjs";

const repository = path.resolve(import.meta.dirname, "../../../..");
const source =
  '<script setup>\nconst count = 1;\n</script>\n<template><Widget :value.sync="count" /></template>\n';
const rule = "vue/no-deprecated-v-bind-sync";

type Packet = {
  dir?: string;
  msg?: { method?: string; params?: { initializationOptions?: unknown } };
  event?: string;
  code?: number;
};
type Publication = {
  uri: string;
  version?: number;
  diagnostics: Array<{ code?: string | number }>;
};
type Observation = { phase: string; legacy: Publication; modern: Publication; hover: unknown };

function prepareWorkspace(workspace: string) {
  fs.mkdirSync(workspace, { recursive: true });
  fs.writeFileSync(path.join(workspace, "package.json"), '{"private":true}\n');
  fs.writeFileSync(
    path.join(workspace, "vite.config.mjs"),
    `export default ${JSON.stringify({
      vue: {
        typeChecker: { enabled: false },
        languageServer: { typecheck: false, ecosystem: false, hover: false, lint: true },
        linter: { preset: "essential", rules: { [rule]: "error" } },
      },
    })};\n`,
  );
  fs.writeFileSync(
    path.join(workspace, "tsconfig.json"),
    JSON.stringify({
      files: [],
      references: [{ path: "./tsconfig.legacy.json" }, { path: "./tsconfig.modern.json" }],
    }),
  );
  for (const [name, target] of [
    ["Legacy", 2.7],
    ["Modern", 3],
  ] as const) {
    fs.writeFileSync(path.join(workspace, `${name}.vue`), source);
    fs.writeFileSync(
      path.join(workspace, `tsconfig.${name.toLowerCase()}.json`),
      JSON.stringify({
        compilerOptions: { noEmit: true },
        include: [`${name}.vue`],
        vueCompilerOptions: { target },
      }),
    );
  }
  // Eglot's genuine project backend discovers all watcher directories here.
  execFileSync("git", ["init", "--quiet", workspace]);
  execFileSync("git", ["-C", workspace, "add", "."]);
}

function readPackets(file: string): Packet[] {
  return fs.existsSync(file)
    ? fs
        .readFileSync(file, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line))
    : [];
}

async function main() {
  const server = resolveRealServerPath();
  const sourceSha = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: repository,
    encoding: "utf8",
  }).trim();
  if (process.env.GITHUB_SHA) assert.equal(sourceSha, process.env.GITHUB_SHA);
  const binaryHash = createHash("sha256").update(fs.readFileSync(server)).digest("hex");
  const output = path.resolve(
    process.env.VIZE_EMACS_ARTIFACT_DIR ??
      path.join(repository, "target/editor-host/emacs-native-config"),
  );
  fs.mkdirSync(output, { recursive: true });
  const session = fs.mkdtempSync(path.join(os.tmpdir(), "vize-eglot-native-"));
  const workspace = path.join(session, "workspace");
  prepareWorkspace(workspace);
  const bin = path.join(session, "bin");
  fs.mkdirSync(bin);
  const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
  const nativePidFile = path.join(output, "native.pid");
  fs.rmSync(nativePidFile, { force: true });
  const nativeWrapper = path.join(bin, "native-server");
  fs.writeFileSync(
    nativeWrapper,
    `#!/bin/sh\n${quote(server)} "$@" <&0 &\nnative=$!\nprintf '%s\\n' "$native" > ${quote(nativePidFile)}\nwait "$native"\n`,
    { mode: 0o755 },
  );
  fs.writeFileSync(
    path.join(bin, "vize"),
    `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(
      path.join(repository, "tests/editor-conformance/lsp-tap.mjs"),
    )} ${quote(nativeWrapper)} "$@"\n`,
    { mode: 0o755 },
  );
  const transcript = path.join(output, "transcript.jsonl");
  const casesFile = path.join(output, "cases.json");
  for (const file of [transcript, casesFile]) fs.rmSync(file, { force: true });
  fs.writeFileSync(
    path.join(output, "identity.json"),
    JSON.stringify(
      {
        server,
        sha256: binaryHash,
        sourceSha,
        client: "Emacs Eglot using editors/emacs/vize.el",
        workspace,
      },
      null,
      2,
    ),
  );
  const child = spawn(
    process.env.VIZE_TEST_EMACS_PATH ?? "emacs",
    [
      "-Q",
      "--batch",
      "-l",
      path.join(repository, "tests/editor-host/emacs-native-config.el"),
      "-f",
      "ert-run-tests-batch-and-exit",
    ],
    {
      cwd: workspace,
      env: {
        ...process.env,
        PATH: `${bin}${path.delimiter}${process.env.PATH ?? ""}`,
        VIZE_EMACS_REPOSITORY: repository,
        VIZE_EMACS_WORKSPACE: workspace,
        VIZE_EMACS_CASES: casesFile,
        VIZE_CONFORMANCE_TRANSCRIPT: transcript,
      },
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 210_000,
    },
  );
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
    process.stdout.write(chunk);
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
    process.stderr.write(chunk);
  });
  let passed = false;
  try {
    const code = await new Promise<number | null>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", resolve);
    });
    assert.equal(code, 0, "The actual Eglot ERT scenario must pass");
    for (let attempt = 0; attempt < 30; attempt++) {
      if (readPackets(transcript).some((entry) => entry.event === "exit")) break;
      await sleep(100);
    }
    const packets = readPackets(transcript);
    const nativePid = Number(fs.readFileSync(nativePidFile, "utf8").trim());
    assert.ok(
      Number.isInteger(nativePid) && nativePid > 0,
      "Actual native child PID must be recorded",
    );
    assert.ok(
      packets.some((entry) => entry.event === "exit" && entry.code === 0),
      "The real native server must exit cleanly",
    );
    const initial = packets.find(
      (entry) => entry.dir === "c2s" && entry.msg?.method === "initialize",
    );
    assert.ok(initial, "Eglot must initialize the real server");
    assert.deepEqual(
      initial.msg!.params?.initializationOptions,
      {},
      "The packaged default must leave feature ownership to project configuration",
    );
    const cases = JSON.parse(fs.readFileSync(casesFile, "utf8")) as Observation[];
    assert.equal(cases.length, 1);
    const observation = cases[0];
    assert.equal(observation.phase, "initial-reference-targets-and-vite-hover");
    assert.ok(!observation.legacy.diagnostics.some((item) => item.code === rule));
    assert.ok(observation.modern.diagnostics.some((item) => item.code === rule));
    assert.equal(observation.hover, null);
    assert.ok(
      packets.some((entry) => entry.event === "spawn"),
      "A real server must start behind the tap",
    );
    passed = true;
    console.log(`Emacs Eglot native configuration passed; complete evidence: ${output}`);
  } finally {
    fs.writeFileSync(
      path.join(output, "receipt.json"),
      JSON.stringify(
        {
          passed,
          sourceSha,
          binary: {
            path: server,
            sha256: binaryHash,
            nativePid: fs.existsSync(nativePidFile)
              ? Number(fs.readFileSync(nativePidFile, "utf8").trim())
              : null,
          },
          transcript: {
            path: transcript,
            sha256: fs.existsSync(transcript)
              ? createHash("sha256").update(fs.readFileSync(transcript)).digest("hex")
              : null,
          },
          cases: fs.existsSync(casesFile) ? JSON.parse(fs.readFileSync(casesFile, "utf8")) : [],
        },
        null,
        2,
      ),
    );
    fs.writeFileSync(path.join(output, "emacs.stdout.log"), stdout);
    fs.writeFileSync(path.join(output, "emacs.stderr.log"), stderr);
    fs.cpSync(workspace, path.join(output, "fixture"), {
      recursive: true,
      filter: (name) => path.basename(name) !== ".git",
    });
    fs.rmSync(session, { recursive: true, force: true });
  }
}

await main();
