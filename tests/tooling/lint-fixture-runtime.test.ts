import assert from "node:assert/strict";
import { execFileSync, spawnSync, type SpawnSyncReturns } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { resolveLintEnvironmentCli } from "../_helpers/lint-fixture-runtime.ts";

test(
  "environment commands use the installed native CLI even inside a script's local vp PATH",
  { skip: process.platform === "win32" },
  () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "vize-lint-runtime-"));
    try {
      const native = path.join(home, ".vite-plus", "bin");
      const local = path.join(home, "project", "node_modules", ".bin");
      for (const dir of [native, local]) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(native, "vp"),
        '#!/bin/sh\nprintf "native environment: %s" "$*"\n',
        { mode: 0o755 },
      );
      fs.writeFileSync(
        path.join(local, "vp"),
        '#!/bin/sh\necho "Command env not found" >&2\nexit 1\n',
        { mode: 0o755 },
      );
      const env = { ...process.env, PATH: `${local}${path.delimiter}${process.env.PATH ?? ""}` };
      assert.throws(() => execFileSync("vp", ["env", "exec"], { env, stdio: "pipe" }));
      const result = execFileSync(
        resolveLintEnvironmentCli(home),
        ["env", "exec", "--node", "24.14.0", "pnpm", "--version"],
        { env, encoding: "utf8" },
      );
      assert.equal(result, "native environment: env exec --node 24.14.0 pnpm --version");
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  },
);

test("missing or invalid native installation never falls back to a local project CLI", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "vize-lint-runtime-"));
  try {
    assert.throws(() => resolveLintEnvironmentCli(home), /installed by setup-vp/);
    const binary = path.join(
      home,
      ".vite-plus",
      "bin",
      process.platform === "win32" ? "vp.exe" : "vp",
    );
    fs.mkdirSync(binary, { recursive: true });
    assert.throws(() => resolveLintEnvironmentCli(home), /installed file/);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

const fakeProvider = `#!/usr/bin/env node
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const args = process.argv.slice(2);
assert.deepEqual(args.slice(0, 5), ['env', 'exec', '--node', process.versions.node, 'pnpm']);
const command = args.slice(5);
fs.appendFileSync('manager-calls.jsonl', JSON.stringify({command, inheritedVerify: process.env.pnpm_config_verify_deps_before_run ?? null})+'\\n');
if (command[0] === '--version') { process.stdout.write('11.10.0\\n'); }
else if (command[0] === 'install') {
  assert.deepEqual(command, ['install', '--frozen-lockfile', '--ignore-scripts', '--prefer-offline']);
  const dir = path.resolve('node_modules/@tsconfig/node24');
  fs.mkdirSync(dir, {recursive:true});
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({name:'@tsconfig/node24',version:'24.0.4'}));
  fs.writeFileSync(path.join(dir, 'tsconfig.json'), '{}\\n');
  process.stdout.write('explicit frozen ignore-scripts install\\n');
} else {
  const exec = command.indexOf('exec');
  assert.ok(exec >= 0);
  if (exec === 0 || process.env.pnpm_config_verify_deps_before_run) {
    fs.writeFileSync('implicit-install', 'unreviewed prepare scripts ran\\n');
  } else assert.deepEqual(command.slice(0, exec), ['--config.verify-deps-before-run=false']);
  process.stdout.write('Scope: all 22 workspace projects\\n{"version":"decoy","executable":"stdout-is-not-identity"}\\n');
  process.stderr.write('whole manager diagnostic\\n');
  const target = command.at(-1);
  const mode = process.env.VIZE_FAKE_RUNTIME_MODE;
  if (mode === 'missing') {}
  else if (mode === 'partial') fs.writeFileSync(target+'.tmp', '{"version":', {mode:0o600});
  else if (mode === 'malformed') fs.writeFileSync(target, '{"version":', {mode:0o600});
  else if (mode === 'symlink') fs.symlinkSync(path.resolve('Original.vue'), target);
  else if (mode === 'oversized') {
    const descriptor = fs.openSync(target, 'wx', 0o600);
    try { fs.ftruncateSync(descriptor, 256 * 1024 * 1024 + 1); }
    finally { fs.closeSync(descriptor); }
  }
  else {
    const result = spawnSync(process.execPath, command.slice(exec+2), {env:process.env,stdio:'pipe'});
    process.stdout.write(result.stdout); process.stderr.write(result.stderr);
    if (result.status !== 0) process.exit(result.status ?? 1);
    if (mode === 'wrong-version') {
      const value = JSON.parse(fs.readFileSync(target,'utf8'));value.version='v0.0.0';
      fs.writeFileSync(target, JSON.stringify(value));
    }
    if (mode === 'failed') process.exit(9);
  }
}
`;

function withPinnedRuntimeFixture(mode: string, check: (context: RuntimeFixture) => void): void {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "vize-pinned-runtime-law-"));
  const source = path.join(directory, "source");
  const workspace = path.join(directory, "prepared");
  const home = path.join(directory, "home");
  const git = (args: string[]) =>
    execFileSync("git", args, { cwd: source, encoding: "utf8" }).trim();
  try {
    fs.mkdirSync(source);
    git(["init", "-q"]);
    fs.writeFileSync(
      path.join(source, "package.json"),
      '{"name":"create-vue","packageManager":"pnpm@11.10.0"}\n',
    );
    fs.writeFileSync(path.join(source, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
    fs.writeFileSync(path.join(source, "Original.vue"), "<template><div /></template>\n");
    git(["add", "."]);
    git(["-c", "user.name=Vize", "-c", "user.email=vize@example.com", "commit", "-qm", "pin"]);
    const pin = git(["rev-parse", "HEAD"]);
    fs.cpSync(source, workspace, {
      recursive: true,
      filter: (file) => path.basename(file) !== ".git",
    });
    const native = path.join(home, ".vite-plus/bin/vp");
    fs.mkdirSync(path.dirname(native), { recursive: true });
    fs.writeFileSync(native, fakeProvider, { mode: 0o755 });
    const helper = new URL("../_helpers/pinned-fixture-dependencies.ts", import.meta.url).href;
    const sourceHelper = new URL("../_helpers/pinned-fixture-source.ts", import.meta.url).href;
    const program = `import {preparePinnedFixtureDependencies} from ${JSON.stringify(helper)};
      import {readPinnedFixtureSource} from ${JSON.stringify(sourceHelper)};
      preparePinnedFixtureDependencies(${JSON.stringify(workspace)},${JSON.stringify(source)},
        readPinnedFixtureSource(${JSON.stringify(source)},${JSON.stringify(pin)}),['Original.vue']);`;
    const child = spawnSync(process.execPath, ["--input-type=module", "-e", program], {
      env: {
        ...process.env,
        HOME: home,
        VIZE_FAKE_RUNTIME_MODE: mode,
        pnpm_config_verify_deps_before_run: "install",
      },
      encoding: "utf8",
      timeout: 10_000,
    });
    assert.ifError(child.error);
    const receipt = JSON.parse(
      fs.readFileSync(path.join(workspace, ".vize-pinned-fixture-dependencies.json"), "utf8"),
    ) as RuntimeReceipt;
    check({ child, receipt, workspace });
    assert.deepEqual(
      fs.readFileSync(path.join(workspace, "Original.vue")),
      fs.readFileSync(path.join(source, "Original.vue")),
    );
    assert.equal(
      fs.readdirSync(workspace).some((name) => name.startsWith(".vize-node-identity-")),
      false,
      "owned result directories are removed on every outcome",
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

type RuntimeReceipt = {
  complete: boolean;
  commands: { argv: string[]; stdoutBase64: string; stderrBase64: string; status: number }[];
  runtimeIdentityOutputs: {
    path: string;
    kind: string;
    sizeBytes?: number;
    file?: { contentsBase64: string; sha256: string };
  }[];
};
type RuntimeFixture = {
  child: SpawnSyncReturns<string>;
  receipt: RuntimeReceipt;
  workspace: string;
};

test(
  "runtime identity uses a separate committed channel and never implicitly installs through pnpm exec",
  { skip: process.platform === "win32" },
  () => {
    withPinnedRuntimeFixture("good", ({ child, receipt, workspace }) => {
      assert.equal(child.status, 0, child.stderr);
      assert.equal(receipt.complete, true);
      assert.equal(fs.existsSync(path.join(workspace, "implicit-install")), false);
      assert.equal(receipt.commands.length, 3);
      const runtime = receipt.commands[1];
      assert.equal(runtime.argv[5], "--config.verify-deps-before-run=false");
      assert.equal(
        Buffer.from(runtime.stdoutBase64, "base64").toString(),
        'Scope: all 22 workspace projects\n{"version":"decoy","executable":"stdout-is-not-identity"}\n',
      );
      assert.equal(
        Buffer.from(runtime.stderrBase64, "base64").toString(),
        "whole manager diagnostic\n",
      );
      const calls = fs
        .readFileSync(path.join(workspace, "manager-calls.jsonl"), "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      assert.equal(calls[0].inheritedVerify, "install");
      assert.equal(
        calls[1].inheritedVerify,
        null,
        "only the one runtime probe removes the inherited override",
      );
      assert.equal(calls[2].inheritedVerify, "install");
      assert.deepEqual(calls[2].command, [
        "install",
        "--frozen-lockfile",
        "--ignore-scripts",
        "--prefer-offline",
      ]);
      assert.equal(receipt.runtimeIdentityOutputs[0].kind, "missing");
      const committed = receipt.runtimeIdentityOutputs[1];
      assert.equal(committed.kind, "regular");
      assert.ok(committed.file);
      const bytes = Buffer.from(committed.file.contentsBase64, "base64");
      assert.equal(createHash("sha256").update(bytes).digest("hex"), committed.file.sha256);
      assert.deepEqual(JSON.parse(bytes.toString()), {
        version: process.version,
        executable: fs.realpathSync(process.execPath),
      });
    });
  },
);

for (const [mode, error] of [
  ["missing", /commit its complete result atomically/],
  ["partial", /commit its complete result atomically/],
  ["malformed", /SyntaxError/],
  ["symlink", /must be a regular file/],
  ["oversized", /exceeds the subprocess transport limit/],
  ["wrong-version", /fixture scripts must retain the actual process Node/],
  ["failed", /authored fixture command failed/],
] as const) {
  test(
    `runtime identity refuses ${mode} output and preserves its complete failed receipt`,
    { skip: process.platform === "win32" },
    () => {
      withPinnedRuntimeFixture(mode, ({ child, receipt, workspace }) => {
        assert.notEqual(child.status, 0);
        assert.match(child.stderr, error);
        assert.equal(receipt.complete, false);
        assert.equal(
          receipt.commands.length,
          2,
          "no installer or stub may run after a failed identity",
        );
        assert.equal(fs.existsSync(path.join(workspace, "implicit-install")), false);
        const runtime = receipt.commands[1];
        assert.equal(runtime.status, mode === "failed" ? 9 : 0);
        assert.equal(
          Buffer.from(runtime.stdoutBase64, "base64").toString(),
          'Scope: all 22 workspace projects\n{"version":"decoy","executable":"stdout-is-not-identity"}\n',
        );
        assert.equal(
          Buffer.from(runtime.stderrBase64, "base64").toString(),
          "whole manager diagnostic\n",
        );
        if (mode === "partial" || mode === "malformed") {
          const output = receipt.runtimeIdentityOutputs.find((row) => row.file);
          assert.ok(output?.file);
          assert.equal(Buffer.from(output.file.contentsBase64, "base64").toString(), '{"version":');
        }
        if (mode === "symlink") {
          const output = receipt.runtimeIdentityOutputs.at(-1);
          assert.equal(output?.kind, "symlink");
          assert.equal(output?.file, undefined, "unsafe symlink target bytes are never read");
        }
        if (mode === "oversized") {
          const output = receipt.runtimeIdentityOutputs.at(-1);
          assert.equal(output?.sizeBytes, 256 * 1024 * 1024 + 1);
          assert.equal(
            output?.file,
            undefined,
            "oversized sparse channel bytes are never allocated or read",
          );
        }
        if (mode === "wrong-version") {
          assert.ok(
            receipt.runtimeIdentityOutputs.at(-1)?.file,
            "wrong identity bytes survive cleanup",
          );
        }
        if (mode === "failed") {
          assert.equal(receipt.runtimeIdentityOutputs.at(-1)?.kind, "regular");
          assert.equal(
            receipt.runtimeIdentityOutputs.at(-1)?.file,
            undefined,
            "unsuccessful child output is never opened or read",
          );
        }
      });
    },
  );
}
