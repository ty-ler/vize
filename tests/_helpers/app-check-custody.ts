import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

import {
  assertNoSourceMutation,
  git,
  readAuthored,
  type AuthoredFile,
} from "./nuxt-check-source.ts";
import { inspectArchive } from "../../tools/support/release/consumer_recovery/archive.ts";

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const readJson = (file: string) => JSON.parse(fs.readFileSync(file, "utf8"));
export type Policy = {
  name: string;
  directory?: string;
  pin: string;
  manager: string;
  minimumNode: number[];
  hooks: string[][];
};
export const checkPolicies: readonly Policy[] = [
  {
    name: "naive-ui",
    pin: "b26496a26536918204722cb9b9e5dd9bfe31c893",
    manager: "11.10.0",
    minimumNode: [24, 0, 0],
    hooks: [],
  },
  {
    name: "npmx.dev",
    directory: "npmx-check",
    pin: "dc0319f8cb61e79e504a8d542b44badcb1384676",
    manager: "11.22.0",
    minimumNode: [24, 4, 0],
    hooks: [
      ["exec", "vp", "run", "generate:lexicons"],
      ["exec", "vp", "run", "generate:sprite"],
      ["exec", "nuxt", "prepare"],
      ["exec", "nuxt", "prepare", "--cwd", "docs"],
    ],
  },
  {
    name: "voicevox",
    pin: "0a7fcc8523410ad294b51b70a46575c4d21371ac",
    manager: "10.28.2",
    minimumNode: [24, 11, 1],
    hooks: [["exec", "install-electron"]],
  },
  {
    name: "misskey",
    pin: "810faa8e5db4bbf9d6d408a61df148559340ee99",
    manager: "10.30.1",
    minimumNode: [22, 15, 0],
    hooks: [["--filter", "i18n", "build"]],
  },
];
export type Manifest = {
  name: string;
  version: string;
  packageManager: string;
  pnpm?: { overrides?: Record<string, string> };
};
export type Source = {
  cwd: string;
  policy: Policy;
  files: AuthoredFile[];
  submodules: Array<{ file: string; oid: string }>;
  manifest: Manifest;
};
export type Item = {
  file: string;
  kind: "file" | "link";
  sha256: string;
  bytes: number;
  physical?: string;
  mode?: number;
};
export type ProcessEvidence = {
  executable: string;
  args: string[];
  cwd: string;
  status: number | null;
  signal: string | null;
  error: string | null;
  stdout: string;
  stderr: string;
  stdoutSha256: string;
  stderrSha256: string;
  environment: Record<string, string | undefined>;
};
export type GeneratedGraph = {
  kind: "generated-fixture-authority";
  fixture: "naive-ui";
  pin: string;
  manager: string;
  source: Array<{ file: string; mode: string; oid: string }>;
  lock: { file: string; sha256: string };
  registry: string;
  managerIntegrity: string;
  managerArchive: string;
  resolution: ProcessEvidence;
  campaign: string;
};
export function validateManager(manifest: Pick<Manifest, "packageManager">, policy: Policy) {
  assert.match(manifest.packageManager, /^pnpm@\d+\.\d+\.\d+(?:\+sha512\.[a-f0-9]{128})?$/);
  assert.equal(
    manifest.packageManager.split("+")[0],
    `pnpm@${policy.manager}`,
    "authored package manager changed",
  );
  return manifest.packageManager.split("+sha512.")[1] as string | undefined;
}

export function validateGeneratedGraph(graph: GeneratedGraph, source: Source, campaign: string) {
  assert.equal(graph.kind, "generated-fixture-authority", "generated lock provenance required");
  assert.equal(graph.fixture, "naive-ui");
  assert.equal(graph.pin, source.policy.pin);
  assert.equal(graph.manager, source.manifest.packageManager);
  assert.deepEqual(
    graph.source,
    source.files.map(({ file, mode, oid }) => ({ file, mode, oid })),
  );
  assert.equal(graph.campaign, fs.realpathSync(campaign), "one shared campaign required");
  assert.equal(graph.registry, "https://registry.npmjs.org/");
  assert.match(graph.managerIntegrity, /^sha512-[A-Za-z0-9+/]{86}==$/);
  const manager = inspectArchive(fs.readFileSync(graph.managerArchive), graph.managerIntegrity);
  assert.equal(manager.archiveManifest.name, "pnpm");
  assert.equal(manager.archiveManifest.version, source.policy.manager);
  assert.equal(graph.resolution.status, 0, "failed resolution cannot authorize a lock");
  assert.equal(graph.resolution.signal, null);
  assert.equal(graph.resolution.error, null);
  assert.equal(graph.resolution.environment.NPM_CONFIG_REGISTRY, graph.registry);
  assert.equal(
    graph.resolution.cwd,
    path.join(campaign, "naive-original-source"),
    "resolution belongs to the external exact-source copy",
  );
  assert.equal(
    graph.resolution.args[0],
    path.join(path.dirname(graph.managerArchive), "package/bin/pnpm.cjs"),
  );
  assert.deepEqual(graph.resolution.args.slice(1), [
    "install",
    "--lockfile-only",
    "--no-frozen-lockfile",
    "--ignore-scripts",
    "--prod=false",
  ]);
  assert.equal(path.dirname(graph.lock.file), fs.realpathSync(campaign));
  assert.equal(sha(fs.readFileSync(graph.lock.file)), graph.lock.sha256, "generated lock changed");
  const lock = parse(fs.readFileSync(graph.lock.file, "utf8"));
  assert.ok(Object.keys(lock.packages ?? {}).length, "complete resolved lock required");
  assert.deepEqual(
    Object.keys(lock.importers ?? {}),
    ["."],
    "original single-root importer layout required",
  );
  for (const stream of ["stdout", "stderr"] as const) {
    assert.ok(fs.statSync(graph.resolution[stream]).isFile(), "raw resolution streams required");
    assert.equal(
      sha(fs.readFileSync(graph.resolution[stream])),
      graph.resolution[`${stream}Sha256`],
      "raw resolution stream changed",
    );
  }
}

export function observeSource(authorityRoot: string, policy: Policy): Source {
  const relative = `tests/_fixtures/_git/${policy.directory ?? policy.name}`;
  const cwd = fs.realpathSync(path.join(authorityRoot, relative));
  assert.equal(cwd, path.join(authorityRoot, relative), "original fixture physical root required");
  assert.equal(
    git(authorityRoot, ["ls-tree", "HEAD", "--", relative]).trim(),
    `160000 commit ${policy.pin}\t${relative}`,
  );
  assert.equal(git(cwd, ["rev-parse", "HEAD"]).trim(), policy.pin);
  const files: AuthoredFile[] = [],
    submodules: Source["submodules"] = [];
  for (const row of git(cwd, ["ls-tree", "-rz", "HEAD"]).split("\0").filter(Boolean)) {
    const match = /^(\d+) (blob|commit) ([a-f0-9]{40})\t([\s\S]+)$/.exec(row);
    assert.ok(match, "closed authored tree required");
    if (match[2] === "commit") submodules.push({ file: match[4], oid: match[3] });
    else
      files.push({
        file: match[4],
        mode: match[1],
        oid: match[3],
        bytes: readAuthored(cwd, match[4], match[1]),
      });
  }
  const source = {
    cwd,
    policy,
    files,
    submodules,
    manifest: readJson(path.join(cwd, "package.json")),
  };
  assertSource(source);
  validateManager(source.manifest, policy);
  return source;
}

export function assertSource(source: Pick<Source, "cwd" | "files" | "submodules">) {
  assertNoSourceMutation(source.files, source.cwd, true);
  for (const entry of source.submodules) {
    const cwd = path.join(source.cwd, entry.file);
    assert.equal(git(cwd, ["rev-parse", "HEAD"]).trim(), entry.oid);
    assert.equal(git(cwd, ["diff", "--binary", "HEAD"]), "", "nested authored source changed");
  }
}

export function assertUnpreparedSource(
  source: Pick<Source, "cwd" | "policy" | "files" | "submodules">,
) {
  if (source.policy.name === "naive-ui")
    assert.ok(
      !fs.existsSync(path.join(source.cwd, "pnpm-lock.yaml")),
      "original root already prepared: consume its sealed graph, never re-resolve",
    );
  assert.deepEqual(
    providerInventory(source),
    [],
    "fresh original provider root required; consume an existing preparation",
  );
}

/** The generic runner keeps its inherited environment; only this exact child owns these fields. */
export function forwardVoicevoxMetadata(
  app: { name: string; check?: { cwd: string } },
  originalCwd: string,
  manifest: { name: string; version: string } | undefined,
  inherited: NodeJS.ProcessEnv,
) {
  const actual = app.check?.cwd;
  const physical = actual && fs.existsSync(actual) ? fs.realpathSync(actual) : actual;
  if (app.name !== "voicevox") {
    assert.notEqual(
      physical,
      originalCwd,
      "unknown project cannot claim the original Voicevox root",
    );
    return inherited;
  }
  assert.equal(physical, originalCwd, "Voicevox child must use its original pinned physical root");
  assert.ok(manifest, "verified authored Voicevox manifest required");
  assert.equal(manifest.name, "voicevox", "wrong authored Voicevox package identity");
  assert.ok(
    typeof manifest.version === "string" && manifest.version.length,
    "authored Voicevox version required",
  );
  return { ...inherited, npm_package_name: manifest.name, npm_package_version: manifest.version };
}

export function copyExactGeneratedFile(bytes: Uint8Array, destination: string) {
  if (fs.existsSync(destination))
    assert.deepEqual(
      fs.readFileSync(destination),
      Buffer.from(bytes),
      "existing generated file differs from exact authored input",
    );
  else fs.writeFileSync(destination, bytes, { flag: "wx" });
}

export function providerInventory(
  source: Pick<Source, "cwd" | "files" | "submodules">,
  excluded: string[] = [],
): Item[] {
  const authored = new Set(source.files.map((entry) => entry.file));
  const nested = new Set([...source.submodules.map((entry) => entry.file), ...excluded]);
  const result: Item[] = [];
  function walk(relative: string) {
    for (const entry of fs.readdirSync(path.join(source.cwd, relative), { withFileTypes: true })) {
      const file = path.posix.join(relative, entry.name);
      if (entry.name === ".git" || nested.has(file) || authored.has(file)) continue;
      const absolute = path.join(source.cwd, file);
      if (entry.isDirectory()) walk(file);
      else if (entry.isSymbolicLink()) {
        const target = fs.readlinkSync(absolute),
          physical = fs.realpathSync(absolute);
        assert.ok(
          physical.startsWith(source.cwd + path.sep),
          "ambient provider link escaped original fixture",
        );
        result.push({
          file,
          kind: "link",
          sha256: sha(Buffer.from(target)),
          bytes: Buffer.byteLength(target),
          physical,
        });
      } else {
        assert.ok(entry.isFile(), "unsupported generated/provider file kind");
        const bytes = fs.readFileSync(absolute);
        result.push({
          file,
          kind: "file",
          sha256: sha(bytes),
          bytes: bytes.length,
          mode: fs.statSync(absolute).mode & 0o777,
        });
      }
    }
  }
  walk("");
  return result.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
}

export function frozenInstallArgs() {
  return ["install", "--frozen-lockfile", "--ignore-scripts", "--prefer-offline", "--prod=false"];
}

export function assertFullDependencyInstall(modules: {
  included?: { dependencies?: boolean; devDependencies?: boolean };
}) {
  assert.equal(modules.included?.dependencies, true, "complete runtime dependency graph required");
  assert.equal(
    modules.included?.devDependencies,
    true,
    "complete authored dev dependency graph required",
  );
}

export function assertPreparedInventory(
  source: Pick<Source, "cwd" | "files" | "submodules">,
  captured: { cwd: string; inventory: Item[] },
) {
  assert.equal(captured.cwd, source.cwd, "B/H must use one original physical provider root");
  assert.deepEqual(
    providerInventory(source),
    captured.inventory,
    "prepared provider/generated bytes changed between B/H calls",
  );
}

export type Prepared = {
  schema: 1;
  authorityRoot: string;
  sourceHead: string;
  campaign: string;
  generated: GeneratedGraph;
  evidence: Item[];
  fixtures: Array<{
    name: string;
    pin: string;
    cwd: string;
    inventory: Item[];
    source: Array<{ file: string; mode: string; oid: string }>;
  }>;
};

export function originalAppCheckEnvironment(
  app: { name: string; check?: { cwd: string } },
  inherited = process.env,
) {
  const root = fs.realpathSync(repository);
  const original = path.join(root, "tests/_fixtures/_git/voicevox");
  const policy = checkPolicies.find(({ name }) => name === app.name);
  if (policy) {
    const cwd = path.join(root, "tests/_fixtures/_git", policy.directory ?? policy.name);
    const expected = policy.name === "misskey" ? path.join(cwd, "packages/frontend") : cwd;
    // Misskey's historical visual-worktree snapshot is separate from original-source acceptance.
    if (policy.name !== "misskey" || app.check?.cwd === expected) {
      assert.equal(
        app.check?.cwd && fs.realpathSync(app.check.cwd),
        expected,
        "original check root required",
      );
      const receipt = inherited.VIZE_APP_CHECK_PREPARED_RECEIPT;
      const expectedSha = inherited.VIZE_APP_CHECK_PREPARED_SHA256;
      assert.ok(
        receipt && expectedSha,
        "original check requires the shared prepared graph reference",
      );
      consumeAppCheckProviders(receipt, expectedSha, root, policy.name);
    }
  }
  if (app.name !== "voicevox") return forwardVoicevoxMetadata(app, original, undefined, inherited);
  const source = observeSource(
    root,
    checkPolicies.find(({ name }) => name === "voicevox")!,
  );
  return forwardVoicevoxMetadata(app, source.cwd, source.manifest, inherited);
}

export function campaignInventory(campaign: string) {
  const excluded = [
    "npm-cache",
    "naive-original-source",
    "prepared.json",
    ...checkPolicies.map(({ name }) => `${name}-manager/package`),
  ];
  return providerInventory({ cwd: campaign, files: [], submodules: [] }, excluded);
}

export function consumeAppCheckProviders(
  receipt: string,
  expected: string,
  authorityRoot = repository,
  selectedFixture?: string,
) {
  assert.match(expected, /^[a-f0-9]{64}$/, "independently passed prepared graph SHA256 required");
  const bytes = fs.readFileSync(receipt);
  assert.equal(sha(bytes), expected, "shared graph authority changed");
  const prepared: Prepared = JSON.parse(bytes.toString("utf8"));
  assert.equal(prepared.schema, 1);
  assert.equal(
    prepared.authorityRoot,
    fs.realpathSync(authorityRoot),
    "B/H must use the same original physical provider roots",
  );
  assert.equal(prepared.campaign, fs.realpathSync(path.dirname(receipt)));
  assert.deepEqual(
    campaignInventory(prepared.campaign),
    prepared.evidence,
    "retained preparation process/source/PM evidence changed",
  );
  assert.deepEqual(
    prepared.fixtures.map(({ name, pin }) => ({ name, pin })),
    checkPolicies.map(({ name, pin }) => ({ name, pin })),
  );
  assert.ok(
    selectedFixture === undefined || checkPolicies.some(({ name }) => name === selectedFixture),
  );
  for (const policy of checkPolicies.filter(
    ({ name }) => !selectedFixture || name === selectedFixture,
  )) {
    const source = observeSource(prepared.authorityRoot, policy);
    const captured = prepared.fixtures.find((entry) => entry.name === policy.name)!;
    assert.deepEqual(
      captured.source,
      source.files.map(({ file, mode, oid }) => ({ file, mode, oid })),
      "original source/config/hook authority changed",
    );
    if (policy.name === "naive-ui") {
      validateGeneratedGraph(prepared.generated, source, prepared.campaign);
      assert.equal(
        sha(fs.readFileSync(path.join(source.cwd, "pnpm-lock.yaml"))),
        prepared.generated.lock.sha256,
      );
    }
    assertPreparedInventory(source, captured);
  }
  return prepared;
}
