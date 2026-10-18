import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { parse as parseToml } from "@iarna/toml";
import {
  bumpVersion,
  updateWorkspaceManifestVersions,
} from "../../../tools/support/release/release/versions.ts";
import { rewriteWorkspaceLock } from "../../../tools/support/release/release/apply_versions.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const releasePackageJsonPaths = [
  "npm/builder/rspack/package.json",
  "npm/builder/unplugin/package.json",
  "npm/builder/vite/package.json",
  "npm/builder/vite-musea/package.json",
  "npm/cli/package.json",
  "npm/fresco/package.json",
  "npm/fresco-native/package.json",
  "npm/framework/musea-nuxt/package.json",
  "npm/framework/nuxt-lint-config/package.json",
  "npm/framework/nuxt/package.json",
  "npm/marquette/package.json",
  "npm/mcp-musea/package.json",
  "npm/native/package.json",
  "npm/oxlint/package.json",
  "npm/plugin-sdk/package.json",
  "npm/wasm/package.json",
];

function readRepoFile(filePath: string): string {
  return fs.readFileSync(path.join(root, filePath), "utf-8");
}

function workspaceVersion(): string {
  const version = readRepoFile("Cargo.toml").match(/^version = "(.+)"$/m)?.[1];
  assert.ok(version, "workspace version");
  return version;
}

test("release package manifests stay aligned with the workspace version", () => {
  const version = workspaceVersion();
  const failures: string[] = [];

  for (const packageJsonPath of releasePackageJsonPaths) {
    const packageJson = JSON.parse(readRepoFile(packageJsonPath)) as {
      name?: string;
      version?: string;
    };
    if (packageJson.version !== version) {
      failures.push(
        `${packageJson.name ?? packageJsonPath}: version ${packageJson.version ?? "<missing>"} does not match ${version}`,
      );
    }
  }

  assert.deepEqual(failures, []);
});

const corsaAliases = [
  "corsa_core",
  "corsa_jsonrpc",
  "corsa_client",
  "corsa_lsp",
  "corsa_orchestrator",
  "corsa",
];
type Dependency = { package?: string; version?: string; path?: string; workspace?: boolean };
type RustWorkspace = {
  workspace: {
    package: { version: string };
    members: string[];
    dependencies: Record<string, Dependency>;
  };
};
type RustPackage = {
  package: { name: string; version: { workspace: boolean }; publish: string[] };
  dependencies?: Record<string, Dependency>;
};

function assertCorsaVersionGraph(source: string): string {
  const { workspace } = parseToml(source) as unknown as RustWorkspace;
  const version = workspace.package.version;
  assert.deepEqual(
    Object.entries(workspace.dependencies)
      .filter(([, dep]) => dep.package?.startsWith("vize_corsa"))
      .map(([alias]) => alias),
    corsaAliases,
  );
  for (const alias of corsaAliases) {
    const dependency = workspace.dependencies[alias];
    assert.deepEqual(dependency, {
      package: `vize_${alias}`,
      version: `=${version}`,
      path: `vendor/${alias}`,
    });
    assert.ok(workspace.members.includes(dependency.path!));
    const provider = parseToml(
      readRepoFile(`${dependency.path}/Cargo.toml`),
    ) as unknown as RustPackage;
    assert.equal(provider.package.name, dependency.package);
    assert.deepEqual(provider.package.version, { workspace: true });
    assert.deepEqual(provider.package.publish, ["crates-io"]);
    for (const [name, inherited] of Object.entries(provider.dependencies ?? {})) {
      if (corsaAliases.includes(name)) assert.deepEqual(inherited, { workspace: true });
    }
  }
  return version;
}

test("vendored Corsa packages and lock entries share the sole workspace publish version", () => {
  const version = assertCorsaVersionGraph(readRepoFile("Cargo.toml"));
  const lock = parseToml(readRepoFile("Cargo.lock")) as unknown as {
    package: Array<{ name: string; version: string }>;
  };
  assert.deepEqual(
    lock.package
      .filter((pkg) => pkg.name.startsWith("vize_corsa"))
      .map(({ name, version }) => [name, version]),
    corsaAliases.map((name) => [`vize_${name}`, version]).sort(([a], [b]) => a.localeCompare(b)),
  );
});

test("the real next-minor rewrite keeps every Corsa alias exact without touching runtime", () => {
  const source = readRepoFile("Cargo.toml");
  const current = assertCorsaVersionGraph(source);
  const next = bumpVersion(current, "minor");
  assert.ok(next);
  const rewritten = updateWorkspaceManifestVersions(source, current, next);
  assert.equal(assertCorsaVersionGraph(rewritten), next);
  const dependencies = (value: string) =>
    (parseToml(value) as unknown as RustWorkspace).workspace.dependencies;
  assert.deepEqual(dependencies(rewritten).corsa_runtime, dependencies(source).corsa_runtime);
  assert.notEqual(rewritten, source);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "vize-corsa-release-lock-"));
  try {
    const lockfile = path.join(directory, "Cargo.lock");
    const original = readRepoFile("Cargo.lock");
    fs.writeFileSync(lockfile, original);
    assert.equal(rewriteWorkspaceLock(current, next, lockfile), true);
    const packages = (value: string) =>
      (parseToml(value) as unknown as { package: Array<{ name: string; version: string }> })
        .package;
    const before = packages(original);
    const after = packages(fs.readFileSync(lockfile, "utf8"));
    assert.equal(after.length, before.length);
    assert.deepEqual(
      after.map((pkg, index) => ({ ...pkg, version: before[index].version })),
      before,
    );
    for (const alias of corsaAliases) {
      const name = `vize_${alias}`;
      const entries = after.filter((pkg) => pkg.name === name);
      assert.equal(entries.length, 1, name);
      assert.deepEqual(entries[0], {
        ...before.find((pkg) => pkg.name === name),
        version: next,
      });
    }
    assert.equal(before.filter((pkg) => pkg.name === "corsa_runtime").length, 1);
    assert.deepEqual(
      after.filter((pkg) => pkg.name === "corsa_runtime"),
      before.filter((pkg) => pkg.name === "corsa_runtime"),
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
  for (const invalid of ["=0.0.0", "*", "", current]) {
    const stale = rewritten.replace(
      `corsa_core = { package = "vize_corsa_core", version = "=${next}"`,
      `corsa_core = { package = "vize_corsa_core", version = "${invalid}"`,
    );
    assert.notEqual(stale, rewritten);
    assert.throws(() => assertCorsaVersionGraph(stale), invalid);
  }
});
