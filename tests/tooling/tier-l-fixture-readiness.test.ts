import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { prepareTierLFixtureReadiness } from "../_helpers/tier-l-fixture-readiness.ts";

function fixture(mode = "success") {
  const directory = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "vize-tier-l-readiness-")),
  );
  const root = path.join(directory, "fixture");
  const output = path.join(directory, "evidence");
  fs.mkdirSync(root);
  const write = (name: string, value: string) => {
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    fs.writeFileSync(path.join(root, name), value);
  };
  write(
    "package.json",
    JSON.stringify({
      name: "vben-admin-monorepo",
      packageManager: "pnpm@11.5.0",
      devDependencies: { "@vben/tsconfig": "workspace:*" },
    }),
  );
  write(
    "internal/tsconfig/package.json",
    JSON.stringify({ name: "@vben/tsconfig", exports: { "./web-app.json": "./web-app.json" } }),
  );
  write("internal/tsconfig/web-app.json", '{"compilerOptions":{"strict":true}}\n');
  write("playground/package.json", '{"name":"playground"}\n');
  write("playground/tsconfig.json", '{"extends":"@vben/tsconfig/web-app.json"}\n');
  write("pnpm-lock.yaml", "lockfileVersion: '9.0'\n");
  write("pnpm-workspace.yaml", "packages:\n  - internal/*\n  - playground\n");
  write(".npmrc", "registry=https://registry.npmmirror.com\n");
  write("source.vue", "<template>Hello</template>\n");
  write("mock/package.json", '{"name":"unselected-mock"}\n');
  const git = (args: string[]) =>
    execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1" },
    });
  git(["init", "--quiet"]);
  git(["add", "."]);
  git([
    "-c",
    "user.name=Fixture Test",
    "-c",
    "user.email=fixture@example.invalid",
    "-c",
    "core.hooksPath=/dev/null",
    "commit",
    "--quiet",
    "-m",
    "test: seed small source fixture",
  ]);
  const revision = git(["rev-parse", "HEAD"]).trim();
  write("node_modules/.vize/vize.config.schema.json", '{"predecessor":true}\n');
  write("generated/keep.txt", "original generated body\n");
  fs.symlinkSync("keep.txt", path.join(root, "generated/keep-link"));
  write("node_modules/.pnpm/state", "old install-owned state\n");
  write("mock/node_modules/.pnpm/state", "protected unselected predecessor\n");
  const cli = path.join(directory, "fake-vp");
  fs.writeFileSync(
    cli,
    `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const args = process.argv.slice(2);
assert.deepEqual(args.slice(0, 5), ['env', 'exec', '--node', ${JSON.stringify(process.versions.node)}, 'pnpm']);
const requested = args.slice(5);
fs.appendFileSync(${JSON.stringify(path.join(directory, "calls.jsonl"))}, JSON.stringify(requested)+'\\n');
if (requested[0] === '--version') {
  assert.deepEqual(requested, ['--version']);
  console.error('whole version stderr');
  console.log(${JSON.stringify(mode === "wrong-version" ? "11.4.0" : "11.5.0")});
  process.exit(0);
}
assert.deepEqual(requested, ['--filter', 'vben-admin-monorepo...', '--fail-if-no-match', 'install', '--frozen-lockfile', '--ignore-scripts', '--prefer-offline']);
console.log('install banner is not JSON');
console.error('whole install stderr');
const mode = ${JSON.stringify(mode)};
if (mode === 'failed-install') process.exit(23);
if (mode === 'mutate-lock') fs.appendFileSync('pnpm-lock.yaml', '# bad\\n');
if (mode === 'mutate-npmrc') fs.appendFileSync('.npmrc', 'ignore=true\\n');
if (mode === 'lose-schema') fs.unlinkSync('node_modules/.vize/vize.config.schema.json');
if (mode === 'mutate-unselected-store') fs.writeFileSync('mock/node_modules/.pnpm/state', 'bad');
if (mode === 'mutate-generated') fs.writeFileSync('generated/keep.txt', 'bad');
if (mode === 'mutate-link') { fs.unlinkSync('generated/keep-link'); fs.symlinkSync('../source.vue', 'generated/keep-link'); }
fs.writeFileSync('node_modules/.pnpm/state', 'changed install-owned state\\n');
if (mode === 'playground-only') {
  fs.mkdirSync('playground/node_modules/@vben', {recursive:true});
  fs.symlinkSync('../../../internal/tsconfig', 'playground/node_modules/@vben/tsconfig');
} else if (mode !== 'missing-resolution') {
  fs.mkdirSync('node_modules/@vben', {recursive:true});
  fs.symlinkSync('../../internal/tsconfig', 'node_modules/@vben/tsconfig');
}
`,
    { mode: 0o755 },
  );
  return {
    directory,
    root,
    output,
    revision,
    cli,
    run: (pin = revision) => prepareTierLFixtureReadiness(root, pin, output, cli),
    receipt: () => JSON.parse(fs.readFileSync(path.join(output, "fixture-readiness.json"), "utf8")),
    calls: () =>
      fs.existsSync(path.join(directory, "calls.jsonl"))
        ? fs
            .readFileSync(path.join(directory, "calls.jsonl"), "utf8")
            .trim()
            .split("\n")
            .map((line) => JSON.parse(line))
        : [],
  };
}

test("owned Tier-L preparation preserves generated state and exact source while retaining whole fake commands", () => {
  const f = fixture();
  f.run();
  const receipt = f.receipt();
  assert.equal(receipt.complete, true);
  assert.deepEqual(f.calls(), [
    ["--version"],
    [
      "--filter",
      "vben-admin-monorepo...",
      "--fail-if-no-match",
      "install",
      "--frozen-lockfile",
      "--ignore-scripts",
      "--prefer-offline",
    ],
  ]);
  assert.equal(receipt.commands.length, 2);
  for (const command of receipt.commands) {
    assert.equal(command.executable, f.cli);
    assert.deepEqual(command.argv.slice(0, 5), [
      "env",
      "exec",
      "--node",
      process.versions.node,
      "pnpm",
    ]);
    assert.equal(command.status, 0);
    assert.equal(command.signal, null);
    assert.equal(command.error, null);
  }
  assert.equal(
    Buffer.from(receipt.commands[1].stdoutBase64, "base64").toString(),
    "install banner is not JSON\n",
  );
  assert.equal(
    Buffer.from(receipt.commands[1].stderrBase64, "base64").toString(),
    "whole install stderr\n",
  );
  assert.deepEqual(receipt.declaredWorkspaceClosure.owners, [
    { name: "vben-admin-monorepo", path: "package.json" },
    { name: "@vben/tsconfig", path: "internal/tsconfig/package.json" },
  ]);
  assert.equal(receipt.declaredWorkspaceClosure.edges.length, 1);
  const protectedSchema = receipt.predecessorEntries.find(
    (entry: { path: string }) => entry.path === "node_modules/.vize/vize.config.schema.json",
  );
  assert.equal(protectedSchema.installOwnedMutable, false);
  for (const pass of receipt.predecessorChecks) {
    const schema = pass.find((entry: { path: string }) => entry.path === protectedSchema.path);
    const { installOwnedMutable: _, ...before } = protectedSchema;
    assert.deepEqual(schema, before);
  }
  assert.equal(
    receipt.predecessorEntries.find(
      (entry: { path: string }) => entry.path === "node_modules/.pnpm/state",
    ).installOwnedMutable,
    true,
  );
  assert.deepEqual(receipt.rootConfigurationRoute, {
    path: path.join(f.root, "node_modules/@vben/tsconfig/web-app.json"),
    realPath: path.join(f.root, "internal/tsconfig/web-app.json"),
  });
  assert.equal(fs.existsSync(path.join(f.root, "playground/node_modules")), false);
  assert.equal(
    receipt.playgroundResolution.realPath,
    path.join(f.root, "internal/tsconfig/web-app.json"),
  );
  assert.equal(
    Buffer.from(receipt.playgroundResolution.contentsBase64, "base64").toString(),
    '{"compilerOptions":{"strict":true}}\n',
  );
});

test("wrong real manager version stops before install and failed commands retain raw status", () => {
  const wrong = fixture("wrong-version");
  assert.throws(() => wrong.run(), /actual pnpm version/);
  assert.equal(wrong.receipt().complete, false);
  assert.deepEqual(wrong.calls(), [["--version"]]);
  const failed = fixture("failed-install");
  assert.throws(() => failed.run(), /package manager command failed/);
  const receipt = failed.receipt();
  assert.equal(receipt.complete, false);
  assert.equal(receipt.commands[1].status, 23);
  assert.equal(
    Buffer.from(receipt.commands[1].stderrBase64, "base64").toString(),
    "whole install stderr\n",
  );
});

test("every authored lock/config and protected predecessor body/link fails closed on mutation", () => {
  for (const mode of [
    "mutate-lock",
    "mutate-npmrc",
    "lose-schema",
    "mutate-generated",
    "mutate-link",
    "mutate-unselected-store",
  ]) {
    const f = fixture(mode);
    assert.throws(() => f.run(), /original|predecessor changed/);
    assert.equal(f.receipt().complete, false, mode);
    assert.equal(f.receipt().commands.length, 2, mode);
  }
});

test("missing authentic config resolution and wrong Git authority cannot become ready", () => {
  const missing = fixture("missing-resolution");
  assert.throws(() => missing.run(), /ENOENT/);
  assert.equal(missing.receipt().complete, false);
  const foreign = fixture("playground-only");
  assert.throws(() => foreign.run(), /ENOENT/);
  assert.equal(foreign.receipt().complete, false);
  assert.equal(
    fs.existsSync(path.join(foreign.root, "playground/node_modules/@vben/tsconfig/web-app.json")),
    true,
  );
  assert.equal(
    fs.existsSync(path.join(foreign.root, "node_modules/@vben/tsconfig/web-app.json")),
    false,
  );
  const wrong = fixture();
  assert.throws(() => wrong.run("0".repeat(40)), /owning Gitlink/);
  assert.deepEqual(wrong.calls(), []);
  assert.equal(wrong.receipt().complete, false);
  const nested = path.join(wrong.root, "unhydrated");
  fs.mkdirSync(nested);
  assert.throws(
    () => prepareTierLFixtureReadiness(nested, wrong.revision, wrong.output, wrong.cli),
    /initialized repository/,
  );
  assert.deepEqual(wrong.calls(), []);
  assert.equal(wrong.receipt().complete, false);
});
