import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { resolveLintEnvironmentCli } from "./lint-fixture-runtime.ts";
import {
  assertPinnedFixtureFiles,
  readPinnedFixtureSource,
  sha256,
} from "./pinned-fixture-source.ts";

type Entry = {
  path: string;
  kind: string;
  mode?: number;
  size?: number;
  sha256?: string;
  target?: string;
  error?: string;
};
type Manifest = {
  name?: string;
  packageManager?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
};

function observe(root: string, relative: string): Entry {
  const file = path.join(root, relative);
  try {
    const stat = fs.lstatSync(file);
    const mode = stat.mode & 0o777;
    if (stat.isSymbolicLink()) {
      return { path: relative, kind: "symlink", mode, target: fs.readlinkSync(file) };
    }
    if (stat.isFile()) {
      const bytes = fs.readFileSync(file);
      return { path: relative, kind: "file", mode, size: bytes.length, sha256: sha256(bytes) };
    }
    return { path: relative, kind: stat.isDirectory() ? "directory" : "other", mode };
  } catch (error) {
    return { path: relative, kind: "read-error", error: String(error) };
  }
}

function entryInventory(root: string): Entry[] {
  const entries: Entry[] = [];
  const walk = (relative: string) => {
    const entry = observe(root, relative);
    entries.push(entry);
    // Git object databases are not fixture bodies; authenticate Git source separately.
    if (entry.kind === "directory" && path.basename(relative) !== ".git") {
      for (const child of fs.readdirSync(path.join(root, relative)).sort()) {
        walk(path.join(relative, child));
      }
    }
  };
  walk(".");
  assert.ok(
    entries.every((entry) => entry.kind !== "read-error"),
    "entry inventory must be complete",
  );
  return entries;
}

function pmOwned(entry: Entry, installRoots: Set<string>): boolean {
  const owner = [...installRoots].find((root) => entry.path.startsWith(`${root}${path.sep}`));
  if (owner === undefined) return false;
  const relative = path.relative(owner, entry.path);
  const parts = relative.split(path.sep);
  if ([".pnpm", ".bin"].includes(parts[0])) return true;
  if ([".modules.yaml", ".pnpm-workspace-state-v1.json"].includes(parts[0])) {
    return parts.length === 1;
  }
  if (entry.kind !== "symlink" || entry.target === undefined || path.isAbsolute(entry.target))
    return false;
  const target = path.normalize(path.join(path.dirname(entry.path), entry.target));
  return [...installRoots].some((root) =>
    target.startsWith(`${path.join(root, ".pnpm")}${path.sep}`),
  );
}

/** This owns an existing CI fixture after its original check/cycle predecessors. */
export function prepareTierLFixtureReadiness(
  fixtureRoot: string,
  revision: string,
  outputDir: string,
  environmentCli?: string,
): void {
  fs.mkdirSync(outputDir, { recursive: true });
  const receipt: Record<string, unknown> = {
    schemaVersion: 1,
    complete: false,
    fixtureRoot,
    revision,
    run: { id: process.env.GITHUB_RUN_ID ?? null, sha: process.env.GITHUB_SHA ?? null },
    authority:
      "pinned authored source and preexisting fixture entries; not all newly installed files",
    commands: [],
    predecessorChecks: [],
  };
  const save = () =>
    fs.writeFileSync(
      path.join(outputDir, "fixture-readiness.json"),
      JSON.stringify(receipt, null, 2),
    );
  save();
  try {
    const root = fs.realpathSync(fixtureRoot);
    const output = fs.realpathSync(outputDir);
    const outputRelative = path.relative(root, output);
    assert.ok(
      outputRelative.startsWith(`..${path.sep}`) || path.isAbsolute(outputRelative),
      "evidence must stay outside fixture",
    );
    const source = readPinnedFixtureSource(root, revision);
    assertPinnedFixtureFiles(root, source);
    receipt.source = source;
    const manifests = source.blobs
      .filter((blob) => path.basename(blob.path) === "package.json")
      .map((blob) => ({
        path: blob.path,
        manifest: JSON.parse(fs.readFileSync(path.join(root, blob.path), "utf8")) as Manifest,
      }));
    const rootManifest = manifests.find((entry) => entry.path === "package.json")?.manifest;
    assert.equal(rootManifest?.name, "vben-admin-monorepo");
    assert.equal(rootManifest?.packageManager, "pnpm@11.5.0");
    assert.equal(rootManifest?.devDependencies?.["@vben/tsconfig"], "workspace:*");
    const owners = new Map(
      manifests.filter((entry) => entry.manifest.name).map((entry) => [entry.manifest.name, entry]),
    );
    const selected = new Set<string>();
    const edges: { from: string; to: string; specifier: string; field: string }[] = [];
    const visit = (name: string) => {
      if (selected.has(name)) return;
      selected.add(name);
      const owner = owners.get(name);
      assert.ok(owner, `workspace owner missing: ${name}`);
      for (const field of ["dependencies", "devDependencies", "optionalDependencies"] as const) {
        for (const [target, specifier] of Object.entries(owner.manifest[field] ?? {})) {
          if (!specifier.startsWith("workspace:")) continue;
          edges.push({ from: name, to: target, specifier, field });
          visit(target);
        }
      }
    };
    visit("vben-admin-monorepo");
    receipt.declaredWorkspaceClosure = {
      qualification: "declared source edges, not measured package-manager selection",
      owners: [...selected].map((name) => ({ name, path: owners.get(name)?.path })),
      edges,
    };
    receipt.authoredInputs = source.blobs
      .filter((blob) =>
        /(^|\/)(package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|\.npmrc)$/.test(blob.path),
      )
      .map((blob) => {
        const bytes = fs.readFileSync(path.join(root, blob.path));
        return { path: blob.path, sha256: sha256(bytes), contentsBase64: bytes.toString("base64") };
      });
    const installRoots = new Set(
      [...selected].map((name) => {
        const owner = owners.get(name);
        assert.ok(owner);
        return path.join(path.dirname(owner.path), "node_modules");
      }),
    );
    receipt.installOwnedRoots = [...installRoots];
    const before = entryInventory(root);
    receipt.predecessorEntries = before.map((entry) => ({
      ...entry,
      installOwnedMutable: pmOwned(entry, installRoots),
    }));
    receipt.gitMetadataBoundary =
      "Git database directory retained as an entry, not recursively inventoried";
    const cli = fs.realpathSync(environmentCli ?? resolveLintEnvironmentCli());
    receipt.executables = [process.execPath, cli].map((file) => ({
      path: file,
      sha256: sha256(fs.readFileSync(file)),
    }));
    const prefix = ["env", "exec", "--node", process.versions.node, "pnpm"];
    const run = (args: string[], timeout: number): Buffer => {
      const argv = [...prefix, ...args];
      const result = spawnSync(cli, argv, {
        cwd: root,
        env: {
          ...process.env,
          CI: "true",
          PATH: `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH ?? ""}`,
          GIT_CEILING_DIRECTORIES: path.dirname(root),
        },
        timeout,
        maxBuffer: 256 * 1024 * 1024,
      });
      (receipt.commands as unknown[]).push({
        executable: cli,
        argv,
        cwd: root,
        timeout,
        maxBuffer: 256 * 1024 * 1024,
        status: result.status,
        signal: result.signal,
        stdoutBase64: result.stdout?.toString("base64") ?? null,
        stderrBase64: result.stderr?.toString("base64") ?? null,
        error: result.error ? String(result.error) : null,
      });
      save();
      // Directory kind/mode are protected; child additions legitimately change size/mtime.
      const after = before.map((entry) => observe(root, entry.path));
      (receipt.predecessorChecks as unknown[]).push(after);
      save();
      assertPinnedFixtureFiles(root, source);
      for (let index = 0; index < before.length; index++) {
        if (!pmOwned(before[index], installRoots))
          assert.deepEqual(
            after[index],
            before[index],
            `predecessor changed: ${before[index].path}`,
          );
      }
      assert.ifError(result.error);
      assert.equal(result.signal, null, "package manager terminated by signal");
      assert.equal(result.status, 0, "package manager command failed; see full command receipt");
      return result.stdout;
    };
    assert.equal(
      run(["--version"], 120_000).toString("utf8").trim(),
      "11.5.0",
      "actual pnpm version must match authored pin",
    );
    run(
      [
        "--filter",
        "vben-admin-monorepo...",
        "--fail-if-no-match",
        "install",
        "--frozen-lockfile",
        "--ignore-scripts",
        "--prefer-offline",
      ],
      900_000,
    );
    const expected = fs.realpathSync(path.join(root, "internal/tsconfig/web-app.json"));
    const rootRoute = path.join(root, "node_modules/@vben/tsconfig/web-app.json");
    receipt.rootConfigurationRoute = { path: rootRoute };
    const rootRealPath = fs.realpathSync(rootRoute);
    assert.equal(
      rootRealPath,
      expected,
      "root dependency must resolve the authored workspace config",
    );
    receipt.rootConfigurationRoute = { path: rootRoute, realPath: rootRealPath };
    const resolved = createRequire(path.join(root, "playground/package.json")).resolve(
      "@vben/tsconfig/web-app.json",
    );
    const actual = fs.realpathSync(resolved);
    assert.equal(actual, expected, "playground must resolve the authored workspace config");
    const bytes = fs.readFileSync(actual);
    const ownerPath = path.join(root, "internal/tsconfig/package.json");
    receipt.resolvedConfigOwner = {
      path: ownerPath,
      contentsBase64: fs.readFileSync(ownerPath).toString("base64"),
    };
    receipt.playgroundResolution = {
      origin: path.join(root, "playground/package.json"),
      request: "@vben/tsconfig/web-app.json",
      resolved,
      realPath: actual,
      sha256: sha256(bytes),
      contentsBase64: bytes.toString("base64"),
    };
    assertPinnedFixtureFiles(root, source);
    receipt.complete = true;
  } catch (error) {
    receipt.error = String(error);
    throw error;
  } finally {
    save();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const registry = JSON.parse(
    fs.readFileSync(path.join(repo, "tests/_fixtures/vue-ecosystem-fixtures.json"), "utf8"),
  ) as { projects: { id: string; revision: string }[] };
  const project = registry.projects.find((entry) => entry.id === "vue-vben-admin");
  assert.ok(project, "Tier-L fixture must be registered");
  prepareTierLFixtureReadiness(
    path.resolve(repo, process.env.VIZE_TIER_L_FIXTURE ?? "tests/_fixtures/_git/vue-vben-admin"),
    project.revision,
    path.resolve(
      repo,
      process.env.VIZE_TIER_L_METRICS_DIR ?? "target/vize-tests/metrics/vben-batch-incremental",
    ),
  );
}
