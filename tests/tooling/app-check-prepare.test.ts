import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { gzipSync } from "node:zlib";

import {
  assertFullDependencyInstall,
  assertPreparedInventory,
  assertSource,
  assertUnpreparedSource,
  checkPolicies,
  campaignInventory,
  consumeAppCheckProviders,
  copyExactGeneratedFile,
  forwardVoicevoxMetadata,
  frozenInstallArgs,
  providerInventory,
  originalAppCheckEnvironment,
  validateGeneratedGraph,
  validateManager,
  type GeneratedGraph,
} from "../_helpers/app-check-custody.ts";
import {
  packageManagerEnvironment,
  preparationMode,
  prepareAppCheckProviders,
} from "../_helpers/app-check-prepare.ts";
import { blobOid } from "../_helpers/nuxt-check-source.ts";
import { inspectRekaNpx } from "../_helpers/reka-check-providers.ts";

const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
// Synthetic archive/lock guard vectors only: no real PM, native or App acceptance.
function managerArchive() {
  const bytes = Buffer.from('{"name":"pnpm","version":"11.10.0"}\n');
  const header = Buffer.alloc(512);
  header.write("package/package.json");
  for (const [offset, size, value] of [
    [100, 8, 0o644],
    [108, 8, 0],
    [116, 8, 0],
    [124, 12, bytes.length],
    [136, 12, 0],
  ])
    header.write(value.toString(8).padStart(size - 1, "0") + "\0", offset, size);
  header.fill(32, 148, 156);
  header.write("0", 156);
  header.write("ustar\0", 257);
  header.write("00", 263);
  const sum = header.reduce((total, value) => total + value, 0);
  header.write(sum.toString(8).padStart(6, "0") + "\0 ", 148, 8);
  return gzipSync(
    Buffer.concat([
      header,
      bytes,
      Buffer.alloc((512 - (bytes.length % 512)) % 512),
      Buffer.alloc(1024),
    ]),
  );
}

function fixture() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "vize-app-provider-guard-")));
  const cwd = path.join(root, "original"),
    campaign = path.join(root, "campaign");
  fs.mkdirSync(cwd);
  fs.mkdirSync(campaign);
  const manifest = {
    name: "synthetic-guard",
    version: "1.0.0",
    packageManager: "pnpm@11.10.0",
    devDependencies: { dependency: "1.0.0" },
  };
  const bytes = Buffer.from(JSON.stringify(manifest) + "\n");
  fs.writeFileSync(path.join(cwd, "package.json"), bytes);
  const files = [{ file: "package.json", mode: "100644", oid: blobOid(bytes), bytes }];
  const source = { cwd, files, submodules: [], policy: checkPolicies[0], manifest };
  const lock = path.join(campaign, "naive-generated-lock.yaml");
  fs.writeFileSync(
    lock,
    "lockfileVersion: '9.0'\nimporters:\n  .:\n    devDependencies:\n      dependency: {specifier: 1.0.0, version: 1.0.0}\npackages:\n  dependency@1.0.0:\n    resolution: {integrity: synthetic-guard-only}\n",
  );
  const manager = path.join(campaign, "manager"),
    archive = path.join(manager, "pnpm.tgz");
  fs.mkdirSync(manager);
  const tar = managerArchive();
  fs.writeFileSync(archive, tar);
  const stdout = path.join(campaign, "stdout.bin"),
    stderr = path.join(campaign, "stderr.bin");
  fs.writeFileSync(stdout, "whole synthetic resolver stdout\0\n");
  fs.writeFileSync(stderr, "");
  const graph: GeneratedGraph = {
    kind: "generated-fixture-authority",
    fixture: "naive-ui",
    pin: checkPolicies[0].pin,
    manager: manifest.packageManager,
    source: files.map(({ file, mode, oid }) => ({ file, mode, oid })),
    lock: { file: lock, sha256: sha(fs.readFileSync(lock)) },
    registry: "https://registry.npmjs.org/",
    managerIntegrity: `sha512-${createHash("sha512").update(tar).digest("base64")}`,
    managerArchive: archive,
    campaign,
    resolution: {
      executable: "/synthetic/node",
      args: [
        path.join(manager, "package/bin/pnpm.cjs"),
        "install",
        "--lockfile-only",
        "--no-frozen-lockfile",
        "--ignore-scripts",
        "--prod=false",
      ],
      cwd: path.join(campaign, "naive-original-source"),
      status: 0,
      signal: null,
      error: null,
      stdout,
      stderr,
      stdoutSha256: sha(fs.readFileSync(stdout)),
      stderrSha256: sha(Buffer.alloc(0)),
      environment: { NPM_CONFIG_REGISTRY: "https://registry.npmjs.org/" },
    },
  };
  return {
    root,
    source,
    campaign,
    graph,
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

test("the App authorities separate current npmX from the preserved original source pins", () => {
  assert.deepEqual(
    checkPolicies.map(({ name, pin, manager }) => ({ name, pin, manager })),
    [
      { name: "naive-ui", pin: "b26496a26536918204722cb9b9e5dd9bfe31c893", manager: "11.10.0" },
      { name: "npmx.dev", pin: "dc0319f8cb61e79e504a8d542b44badcb1384676", manager: "11.22.0" },
      { name: "voicevox", pin: "0a7fcc8523410ad294b51b70a46575c4d21371ac", manager: "10.28.2" },
      { name: "misskey", pin: "810faa8e5db4bbf9d6d408a61df148559340ee99", manager: "10.30.1" },
    ],
  );
  for (const policy of checkPolicies) {
    validateManager({ packageManager: `pnpm@${policy.manager}` }, policy);
    assert.throws(() => validateManager({ packageManager: "pnpm@10" }, policy));
    assert.throws(() => validateManager({ packageManager: "pnpm@9.0.0" }, policy));
  }
  assert.equal(checkPolicies[1].directory, "npmx-check");
  assert.throws(() => validateManager({ packageManager: "pnpm@11.20.0" }, checkPolicies[1]));
  const legacy = fs.realpathSync(new URL("../_fixtures/_git/npmx.dev", import.meta.url));
  assert.throws(
    () => originalAppCheckEnvironment({ name: "npmx.dev", check: { cwd: legacy } }, {}),
    /original check root required/,
  );
  const digest = "ab".repeat(64);
  assert.equal(
    validateManager({ packageManager: `pnpm@11.22.0+sha512.${digest}` }, checkPolicies[1]),
    digest,
  );
  assert.throws(() =>
    validateManager({ packageManager: "pnpm@11.22.0+sha512.ab" }, checkPolicies[1]),
  );
});

test("both B/H consumers require an explicit identical sealed graph and cannot produce", () => {
  assert.equal(preparationMode(["--prepare"]), "--prepare");
  const reference = ["--consume", "/captured/shared-prepared.json", "ab".repeat(32)];
  for (const _subject of ["baseline", "candidate"])
    assert.equal(preparationMode(reference), "--consume");
  for (const args of [
    [],
    ["--consume"],
    ["--consume", "graph", "unsealed"],
    ["--prepare", "--baseline"],
    ["--resolve-again"],
  ])
    assert.throws(() => preparationMode(args));
  const original = process.env.VIZE_APP_CHECK_BASELINE;
  try {
    process.env.VIZE_APP_CHECK_BASELINE = "exact-baseline-subject";
    assert.throws(() => prepareAppCheckProviders(), /baseline must consume/);
  } finally {
    if (original === undefined) delete process.env.VIZE_APP_CHECK_BASELINE;
    else process.env.VIZE_APP_CHECK_BASELINE = original;
  }
});

test("generated lock admission needs the complete current source, real PM archive and raw process provenance", () => {
  const f = fixture();
  try {
    validateGeneratedGraph(f.graph, f.source, f.campaign);
    const changes = [
      { kind: "upstream-authored-lock" },
      { pin: "00".repeat(20) },
      { manager: "pnpm@10" },
      { source: [] },
      { registry: "https://different.invalid/" },
      { managerIntegrity: "unverified" },
      { campaign: f.source.cwd },
      { resolution: { ...f.graph.resolution, status: 1 } },
      { resolution: { ...f.graph.resolution, signal: "SIGTERM" } },
      { resolution: { ...f.graph.resolution, error: "spawn failed" } },
      { resolution: { ...f.graph.resolution, cwd: f.source.cwd } },
      { resolution: { ...f.graph.resolution, args: frozenInstallArgs() } },
      { resolution: { ...f.graph.resolution, environment: {} } },
    ];
    for (const change of changes)
      assert.throws(() =>
        validateGeneratedGraph({ ...f.graph, ...change } as GeneratedGraph, f.source, f.campaign),
      );
    fs.appendFileSync(f.graph.managerArchive, "changed archive");
    assert.throws(() => validateGeneratedGraph(f.graph, f.source, f.campaign), /SRI mismatch/);
  } finally {
    f.cleanup();
  }
});

test("missing lock, truncated lock and changed raw resolver bytes never earn generated authority", () => {
  const f = fixture();
  try {
    const original = fs.readFileSync(f.graph.lock.file);
    fs.unlinkSync(f.graph.lock.file);
    assert.throws(() => validateGeneratedGraph(f.graph, f.source, f.campaign));
    fs.writeFileSync(f.graph.lock.file, "lockfileVersion: '9.0'\n");
    assert.throws(
      () => validateGeneratedGraph(f.graph, f.source, f.campaign),
      /generated lock changed/,
    );
    const truncated = {
      ...f.graph,
      lock: { ...f.graph.lock, sha256: sha(fs.readFileSync(f.graph.lock.file)) },
    };
    assert.throws(
      () => validateGeneratedGraph(truncated, f.source, f.campaign),
      /complete resolved lock/,
    );
    fs.writeFileSync(f.graph.lock.file, original);
    fs.appendFileSync(f.graph.resolution.stdout, "changed raw stream");
    assert.throws(
      () => validateGeneratedGraph(f.graph, f.source, f.campaign),
      /raw resolution stream changed/,
    );
    fs.unlinkSync(f.graph.resolution.stderr);
    assert.throws(() => validateGeneratedGraph(f.graph, f.source, f.campaign));
  } finally {
    f.cleanup();
  }
});

test("a prepared Naive root refuses another resolution; both installers include the complete frozen dev graph", () => {
  const f = fixture();
  try {
    assertUnpreparedSource(f.source);
    fs.copyFileSync(f.graph.lock.file, path.join(f.source.cwd, "pnpm-lock.yaml"));
    assert.throws(() => assertUnpreparedSource(f.source), /consume its sealed graph/);
    assert.deepEqual(frozenInstallArgs(), [
      "install",
      "--frozen-lockfile",
      "--ignore-scripts",
      "--prefer-offline",
      "--prod=false",
    ]);
    assertFullDependencyInstall({ included: { dependencies: true, devDependencies: true } });
    for (const included of [
      {},
      { dependencies: true },
      { dependencies: true, devDependencies: false },
      { dependencies: false, devDependencies: true },
    ])
      assert.throws(() => assertFullDependencyInstall({ included }));
  } finally {
    f.cleanup();
  }
});

test("preparation and generated files preserve whole authored bytes, modes and original environment copy", () => {
  const f = fixture();
  try {
    assertSource(f.source);
    const file = path.join(f.source.cwd, "package.json"),
      original = fs.readFileSync(file);
    fs.appendFileSync(file, "\n");
    assert.throws(() => assertSource(f.source), /authored source changed/);
    fs.writeFileSync(file, original);
    if (process.platform !== "win32") {
      fs.chmodSync(file, 0o755);
      assert.throws(() => assertSource(f.source), /source mode changed/);
      fs.chmodSync(file, 0o644);
    }
    const example = Buffer.from("VITE_APP_NAME=voicevox\n# original engine example retained\n");
    const env = path.join(f.source.cwd, ".env");
    copyExactGeneratedFile(example, env);
    copyExactGeneratedFile(example, env);
    assert.deepEqual(fs.readFileSync(env), example);
    fs.appendFileSync(env, "invented setting=true\n");
    assert.throws(() => copyExactGeneratedFile(example, env), /differs from exact authored input/);
    assertSource(f.source);
  } finally {
    f.cleanup();
  }
});

test("B/H reuse one physical root and refuse changed generated i18n, Nuxt or installed provider bytes", () => {
  const f = fixture();
  try {
    const generated = [
      "packages/i18n/built/index.js",
      ".nuxt/tsconfig.json",
      "node_modules/provider/index.mjs",
    ];
    for (const file of generated) {
      const target = path.join(f.source.cwd, file);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, `whole original ${file}\n`);
    }
    const captured = { cwd: f.source.cwd, inventory: providerInventory(f.source) };
    for (const _subject of ["baseline", "candidate"]) assertPreparedInventory(f.source, captured);
    assert.throws(
      () =>
        assertPreparedInventory(f.source, {
          ...captured,
          cwd: path.join(f.root, "different-checkout"),
        }),
      /one original physical provider root/,
    );
    for (const file of generated) {
      const target = path.join(f.source.cwd, file),
        bytes = fs.readFileSync(target);
      fs.appendFileSync(target, "changed");
      assert.throws(
        () => assertPreparedInventory(f.source, captured),
        /bytes changed between B\/H/,
      );
      fs.writeFileSync(target, bytes);
    }
    if (process.platform !== "win32") {
      const provider = path.join(f.source.cwd, generated[2]);
      fs.chmodSync(provider, 0o755);
      assert.throws(
        () => assertPreparedInventory(f.source, captured),
        /bytes changed between B\/H/,
      );
      fs.chmodSync(provider, 0o644);
    }
    const outside = path.join(f.root, "ambient-provider");
    fs.mkdirSync(outside);
    fs.symlinkSync(outside, path.join(f.source.cwd, "node_modules/ambient"), "junction");
    assert.throws(() => providerInventory(f.source), /escaped original fixture/);
  } finally {
    f.cleanup();
  }
});

test("Voicevox forwards exact authored metadata per actual child and leaves every other project/env untouched", () => {
  const f = fixture();
  try {
    const inherited = {
      PATH: "/authored/runtime",
      npm_package_name: "parent-workspace",
      npm_package_version: "parent-version",
      KEEP: "whole inherited environment",
    };
    const original = structuredClone(inherited),
      manifest = { name: "voicevox", version: "0.27.0-test-vector" };
    const child = forwardVoicevoxMetadata(
      { name: "voicevox", check: { cwd: f.source.cwd } },
      f.source.cwd,
      manifest,
      inherited,
    );
    assert.deepEqual(child, {
      ...inherited,
      npm_package_name: manifest.name,
      npm_package_version: manifest.version,
    });
    assert.notEqual(child, inherited);
    assert.deepEqual(inherited, original);
    const other = { name: "naive-ui", check: { cwd: path.join(f.root, "unrelated") } };
    assert.equal(forwardVoicevoxMetadata(other, f.source.cwd, undefined, inherited), inherited);
    for (const app of [
      { name: "unknown", check: { cwd: f.source.cwd } },
      { name: "voicevox", check: other.check },
      { name: "voicevox" },
    ])
      assert.throws(() => forwardVoicevoxMetadata(app, f.source.cwd, manifest, inherited));
    for (const wrong of [
      undefined,
      { name: "spoofed", version: "1" },
      { name: "voicevox", version: "" },
    ])
      assert.throws(() =>
        forwardVoicevoxMetadata(
          { name: "voicevox", check: { cwd: f.source.cwd } },
          f.source.cwd,
          wrong,
          inherited,
        ),
      );
    assert.deepEqual(inherited, original);
  } finally {
    f.cleanup();
  }
});

// These refusals happen before any fixture Git lookup or subprocess execution.
test("consumers reject a replaced receipt or changed whole retained process evidence", () => {
  const f = fixture();
  try {
    const processRecord = path.join(f.campaign, "whole-process.json");
    fs.writeFileSync(processRecord, '{"args":["frozen-install"],"status":0}\n');
    const receipt = path.join(f.campaign, "prepared.json");
    const bytes = Buffer.from(
      JSON.stringify({
        schema: 1,
        authorityRoot: f.root,
        campaign: f.campaign,
        evidence: campaignInventory(f.campaign),
        fixtures: [],
      }),
    );
    fs.writeFileSync(receipt, bytes);
    assert.throws(
      () => consumeAppCheckProviders(receipt, "00".repeat(32), f.root),
      /shared graph authority changed/,
    );
    fs.appendFileSync(processRecord, "changed command or registry provenance");
    assert.throws(
      () => consumeAppCheckProviders(receipt, sha(bytes), f.root),
      /preparation process\/source\/PM evidence changed/,
    );
  } finally {
    f.cleanup();
  }
});

test("package managers receive distinct empty user and global configs without ambient settings", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vize-app-manager-env-"));
  const inherited = {
    PATH: process.env.PATH,
    npm_config_registry: "https://invalid.example/",
    PNPM_HOME: "/ambient/pnpm",
    COREPACK_HOME: "/ambient/corepack",
  };
  try {
    const env = packageManagerEnvironment(inherited, root);
    assert.equal(env.PATH, inherited.PATH);
    assert.equal(env.npm_config_registry, undefined);
    assert.equal(env.PNPM_HOME, undefined);
    assert.equal(env.COREPACK_HOME, undefined);
    assert.equal(inherited.npm_config_registry, "https://invalid.example/");
    const user = env.NPM_CONFIG_USERCONFIG!,
      global = env.NPM_CONFIG_GLOBALCONFIG!;
    assert.notEqual(fs.realpathSync(user), fs.realpathSync(global));
    assert.equal(fs.readFileSync(user, "utf8"), "");
    assert.equal(fs.readFileSync(global, "utf8"), "");
    assert.equal(env.NPM_CONFIG_REGISTRY, "https://registry.npmjs.org/");
    assert.deepEqual(packageManagerEnvironment(inherited, root), env);
    // Real npm config loading, without a network request or package installation.
    const npm = inspectRekaNpx(env);
    const cli = path.join(path.dirname(npm.cli), "npm-cli.js");
    const probe = (configuration: NodeJS.ProcessEnv) =>
      spawnSync(process.execPath, [cli, "config", "get", "registry"], {
        cwd: root,
        env: configuration,
        encoding: "utf8",
        timeout: 5_000,
      });
    const original = probe({ ...env, NPM_CONFIG_GLOBALCONFIG: user });
    assert.equal(original.error, undefined);
    assert.equal(original.status, 1);
    assert.match(original.stderr, /double-loading config/);
    const corrected = probe(env);
    assert.equal(corrected.error, undefined);
    assert.equal(corrected.status, 0, corrected.stderr);
    assert.equal(corrected.stdout.trim(), "https://registry.npmjs.org/");

    fs.writeFileSync(global, "registry=https://invalid.example/\n");
    assert.throws(
      () => packageManagerEnvironment(inherited, root),
      /ambient PM configuration refused/,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
