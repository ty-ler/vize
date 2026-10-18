import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

import { resolveLintEnvironmentCli } from "./lint-fixture-runtime.ts";
import {
  assertPinnedFixtureFiles,
  readPinnedFixtureSource,
  sha256,
  type PinnedFixtureSource,
} from "./pinned-fixture-source.ts";

const commandMaxBuffer = 256 * 1024 * 1024;

type FileIdentity = {
  path: string;
  realPath: string;
  sizeBytes: number;
  sha256: string;
};
type FileEvidence = FileIdentity & { contentsBase64: string };
type RuntimeIdentityOutput = {
  path: string;
  kind: "missing" | "regular" | "symlink" | "other";
  sizeBytes?: number;
  file?: FileEvidence;
};

type DependencyPlan = {
  root: string;
  sourceDir: string;
  source: PinnedFixtureSource;
  declaredCorpus: { blobs: PinnedFixtureSource["blobs"]; inventorySha256: string };
  packageManager: string;
  managerVersion: string;
  originalInputs: FileEvidence[];
  stubs: { directory: string; script: string; output: string }[];
  modules: { importer: string; specifier: string }[];
};

type CommandEvidence = {
  executable: string;
  argv: string[];
  cwd: string;
  status: number | null;
  signal: string | null;
  stdoutBase64: string;
  stderrBase64: string;
  error: string | null;
};

function inside(root: string, file: string): string {
  const relative = path.relative(root, file);
  assert.ok(
    relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative),
    `dependency input escaped the prepared root: ${file}`,
  );
  return relative;
}

function fileIdentity(file: string, bytes = fs.readFileSync(file)): FileIdentity {
  return {
    path: file,
    realPath: fs.realpathSync(file),
    sizeBytes: bytes.length,
    sha256: sha256(bytes),
  };
}

function evidence(file: string): FileEvidence {
  const bytes = fs.readFileSync(file);
  return { ...fileIdentity(file, bytes), contentsBase64: bytes.toString("base64") };
}

function readRuntimeIdentityOutput(file: string): FileEvidence {
  const before = fs.lstatSync(file);
  assert.ok(before.isFile(), "runtime identity output must be a regular file");
  const descriptor = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  try {
    const identity = (stat: fs.Stats) => [
      stat.dev,
      stat.ino,
      stat.mode,
      stat.nlink,
      stat.size,
      stat.mtimeMs,
      stat.ctimeMs,
    ];
    const opened = fs.fstatSync(descriptor);
    assert.ok(opened.isFile());
    assert.equal(opened.nlink, 1, "runtime identity output must be freshly owned");
    assert.deepEqual(identity(opened), identity(before));
    assert.ok(
      opened.size <= commandMaxBuffer,
      "runtime identity output exceeds the subprocess transport limit",
    );
    const bytes = Buffer.allocUnsafe(opened.size);
    let offset = 0;
    while (offset < bytes.length) {
      const count = fs.readSync(descriptor, bytes, offset, bytes.length - offset, null);
      assert.ok(count > 0, "runtime identity output must be complete");
      offset += count;
    }
    assert.equal(
      fs.readSync(descriptor, Buffer.allocUnsafe(1), 0, 1, null),
      0,
      "runtime identity output grew during read",
    );
    assert.deepEqual(identity(fs.fstatSync(descriptor)), identity(before));
    assert.deepEqual(identity(fs.lstatSync(file)), identity(before));
    const output = { ...fileIdentity(file, bytes), contentsBase64: bytes.toString("base64") };
    assert.deepEqual(identity(fs.lstatSync(file)), identity(before));
    return output;
  } finally {
    fs.closeSync(descriptor);
  }
}

/** Authenticate the complete archive before any installer or authored script can run. */
export function readPinnedFixtureDependencyPlan(
  workspaceDir: string,
  sourceDir: string,
  source: PinnedFixtureSource,
  corpusPaths: readonly string[],
): DependencyPlan {
  const root = fs.realpathSync(workspaceDir);
  const upstream = fs.realpathSync(sourceDir);
  assert.notEqual(root, upstream, "dependency preparation must never modify the upstream checkout");
  assert.deepEqual(readPinnedFixtureSource(upstream, source.revision), source);
  assertPinnedFixtureFiles(upstream, source);
  assertPinnedFixtureFiles(root, source);
  assert.equal(
    fs.lstatSync(path.join(root, "node_modules"), { throwIfNoEntry: false }),
    undefined,
    "dependency preparation requires a fresh full archive without foreign node_modules",
  );
  const originals = new Map(source.blobs.map((blob) => [blob.path, blob]));
  assert.equal(new Set(corpusPaths).size, corpusPaths.length, "declared corpus must be unique");
  const blobs = corpusPaths.map((file) => {
    const blob = originals.get(file);
    assert.ok(blob, `declared corpus file must belong to the original source: ${file}`);
    return blob;
  });
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const manager = /^pnpm@([0-9]+\.[0-9]+\.[0-9]+)(?:\+sha(?:224|256|384|512)\.[a-f0-9]+)?$/.exec(
    pkg.packageManager,
  );
  assert.ok(manager, "the original fixture must pin its complete pnpm packageManager");
  assert.ok(originals.has("pnpm-lock.yaml"), "the original frozen dependency lock is required");
  const originalInputs = source.blobs
    .filter(({ path: file }) =>
      /(?:^|\/)(?:package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|\.npmrc|\.pnpmfile\.cjs)$/.test(
        file,
      ),
    )
    .map(({ path: file }) => evidence(path.join(root, file)));
  const stubs: DependencyPlan["stubs"] = [];
  const modules: DependencyPlan["modules"] = [];
  if (pkg.name === "vben-admin-monorepo") {
    for (const [name, script] of [
      ["node-utils", "node ./scripts/build.mjs"],
      ["vite-config", "pnpm exec tsdown"],
    ]) {
      const directory = `internal/${name}`;
      const manifest = JSON.parse(
        fs.readFileSync(path.join(root, directory, "package.json"), "utf8"),
      );
      assert.equal(manifest.name, `@vben/${name}`);
      assert.equal(manifest.scripts.stub, script, "only the reviewed authored stub may execute");
      stubs.push({ directory, script, output: `${directory}/dist` });
    }
    modules.push(
      { importer: "playground/package.json", specifier: "@vben/tsconfig/web-app.json" },
      { importer: "playground/package.json", specifier: "@vben/vite-config" },
      { importer: "internal/vite-config/package.json", specifier: "@vben/node-utils" },
      { importer: "playground/package.json", specifier: "vite" },
    );
  } else if (pkg.name === "create-vue") {
    modules.push({ importer: "package.json", specifier: "@tsconfig/node24/tsconfig.json" });
  } else if (pkg.name === "@vue/router-root") {
    modules.push(
      { importer: "packages/playground/package.json", specifier: "vite" },
      { importer: "packages/playground/package.json", specifier: "@vitejs/plugin-vue" },
      { importer: "packages/playground/package.json", specifier: "vite-plugin-vue-devtools" },
    );
  } else {
    assert.fail(`fixture dependency preparation has no reviewed project: ${pkg.name}`);
  }
  return {
    root,
    sourceDir: upstream,
    source,
    declaredCorpus: { blobs, inventorySha256: sha256(JSON.stringify(blobs)) },
    packageManager: pkg.packageManager,
    managerVersion: manager[1],
    originalInputs,
    stubs,
    modules,
  };
}

function generatedFiles(root: string, directories: string[]): FileEvidence[] {
  const files: string[] = [];
  const visit = (directory: string) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      inside(root, fs.realpathSync(file));
      if (entry.isDirectory()) visit(file);
      else {
        assert.ok(entry.isFile(), `generated stub must be a regular file: ${file}`);
        files.push(file);
      }
    }
  };
  for (const directory of directories) visit(path.join(root, directory));
  return files.sort().map(evidence);
}

function resolveModule(root: string, module: DependencyPlan["modules"][number]) {
  const require = createRequire(path.join(root, module.importer));
  const resolved = require.resolve(module.specifier);
  inside(root, fs.realpathSync(resolved));
  const name = module.specifier.startsWith("@")
    ? module.specifier.split("/").slice(0, 2).join("/")
    : module.specifier.split("/")[0];
  let directory = path.dirname(resolved);
  for (;;) {
    inside(root, directory);
    const manifest = path.join(directory, "package.json");
    if (fs.existsSync(manifest) && JSON.parse(fs.readFileSync(manifest, "utf8")).name === name) {
      inside(root, fs.realpathSync(manifest));
      return { ...module, entrypoint: evidence(resolved), manifest: evidence(manifest) };
    }
    const parent = path.dirname(directory);
    assert.notEqual(parent, directory, `resolved dependency has no owning manifest: ${name}`);
    directory = parent;
  }
}

/** Install and execute only the genuine authored preparation in this same full source root. */
export function preparePinnedFixtureDependencies(
  workspaceDir: string,
  sourceDir: string,
  source: PinnedFixtureSource,
  corpusPaths: readonly string[],
) {
  const plan = readPinnedFixtureDependencyPlan(workspaceDir, sourceDir, source, corpusPaths);
  const { root } = plan;
  const environmentCli = resolveLintEnvironmentCli();
  const prefix = ["env", "exec", "--node", process.versions.node, "pnpm"];
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH ?? ""}`,
    GIT_CEILING_DIRECTORIES: path.dirname(root),
    CI: "true",
  };
  const receiptPath = path.join(root, ".vize-pinned-fixture-dependencies.json");
  assert.equal(fs.existsSync(receiptPath), false, "receipt must not replace an authored input");
  const receipt = {
    schema: "vize.pinned-fixture-dependencies",
    version: 1,
    root,
    sourceDir: plan.sourceDir,
    source: plan.source,
    declaredCorpus: plan.declaredCorpus,
    originalInputs: plan.originalInputs,
    originalFrozenClosure: true,
    packageManager: plan.packageManager,
    node: { version: process.version, executable: fileIdentity(process.execPath) },
    environmentCli: fileIdentity(environmentCli),
    actualManager: "",
    runtimeIdentityOutputs: [] as RuntimeIdentityOutput[],
    authoredStubs: plan.stubs,
    commands: [] as CommandEvidence[],
    generatedStubs: [] as FileEvidence[],
    resolvedModules: [] as ReturnType<typeof resolveModule>[],
    complete: false,
  };
  const save = () => fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  const originalsUnchanged = () => {
    assertPinnedFixtureFiles(plan.sourceDir, source);
    assertPinnedFixtureFiles(root, source);
  };
  const run = (args: string[], timeout: number, commandEnv = env): Buffer => {
    originalsUnchanged();
    const argv = [...prefix, ...args];
    const result = spawnSync(environmentCli, argv, {
      cwd: root,
      env: commandEnv,
      stdio: ["ignore", "pipe", "pipe"],
      timeout,
      maxBuffer: commandMaxBuffer,
    });
    receipt.commands.push({
      executable: environmentCli,
      argv,
      cwd: root,
      status: result.status,
      signal: result.signal,
      stdoutBase64: result.stdout?.toString("base64") ?? "",
      stderrBase64: result.stderr?.toString("base64") ?? "",
      error: result.error?.message ?? null,
    });
    save();
    originalsUnchanged();
    assert.ifError(result.error);
    assert.equal(
      result.status,
      0,
      `authored fixture command failed; full evidence: ${receiptPath}`,
    );
    assert.equal(result.signal, null);
    return result.stdout;
  };
  receipt.actualManager = run(["--version"], 120_000).toString("utf8").trim();
  assert.equal(receipt.actualManager, plan.managerVersion);
  const runtimeDirectory = fs.mkdtempSync(path.join(root, ".vize-node-identity-"));
  const runtimePath = path.join(runtimeDirectory, "runtime.json");
  const runtimeEnvironment = { ...env };
  // pnpm's reader gives this inherited variable priority over the explicit CLI setting.
  delete runtimeEnvironment.pnpm_config_verify_deps_before_run;
  let runtime: { version: string; executable: string };
  try {
    let committed: FileEvidence | undefined;
    let probeSucceeded = false;
    try {
      run(
        [
          "--config.verify-deps-before-run=false",
          "exec",
          "node",
          "-e",
          "const fs=require('node:fs');const target=process.argv[1];" +
            "fs.writeFileSync(target+'.tmp',JSON.stringify({version:process.version,executable:fs.realpathSync(process.execPath)}),{flag:'wx',mode:0o600});" +
            "fs.renameSync(target+'.tmp',target)",
          runtimePath,
        ],
        120_000,
        runtimeEnvironment,
      );
      probeSucceeded = true;
    } finally {
      // Read channel bytes only after verified success; failed children retain metadata only.
      try {
        for (const file of [runtimePath + ".tmp", runtimePath]) {
          const stat = fs.lstatSync(file, { throwIfNoEntry: false });
          const output: RuntimeIdentityOutput = {
            path: file,
            kind: stat
              ? stat.isFile()
                ? "regular"
                : stat.isSymbolicLink()
                  ? "symlink"
                  : "other"
              : "missing",
          };
          if (stat) output.sizeBytes = stat.size;
          receipt.runtimeIdentityOutputs.push(output);
          if (!stat || !probeSucceeded) continue;
          output.file = readRuntimeIdentityOutput(file);
          if (file === runtimePath) committed = output.file;
        }
      } finally {
        save();
      }
    }
    assert.deepEqual(
      fs.readdirSync(runtimeDirectory),
      ["runtime.json"],
      "runtime identity must commit its complete result atomically",
    );
    assert.ok(committed, "runtime identity result is required");
    runtime = JSON.parse(Buffer.from(committed.contentsBase64, "base64").toString("utf8"));
    assert.deepEqual(Object.keys(runtime).sort(), ["executable", "version"]);
    assert.equal(typeof runtime.version, "string");
    assert.equal(typeof runtime.executable, "string");
    assert.ok(path.isAbsolute(runtime.executable));
  } finally {
    fs.rmSync(runtimeDirectory, { recursive: true, force: true });
  }
  assert.equal(
    runtime.version,
    process.version,
    "fixture scripts must retain the actual process Node",
  );
  assert.equal(sha256(fs.readFileSync(runtime.executable)), receipt.node.executable.sha256);
  run(["install", "--frozen-lockfile", "--ignore-scripts", "--prefer-offline"], 900_000);
  for (const stub of plan.stubs) {
    run(["--dir", stub.directory, "run", "stub"], 600_000);
    receipt.generatedStubs = generatedFiles(
      root,
      plan.stubs
        .map(({ output }) => output)
        .filter((output) => fs.existsSync(path.join(root, output))),
    );
    save();
  }
  for (const module of plan.modules) {
    receipt.resolvedModules.push(resolveModule(root, module));
    save();
  }
  const verify = () => {
    originalsUnchanged();
    assert.deepEqual(
      generatedFiles(
        root,
        plan.stubs.map(({ output }) => output),
      ),
      receipt.generatedStubs,
    );
    assert.deepEqual(
      plan.modules.map((module) => resolveModule(root, module)),
      receipt.resolvedModules,
    );
  };
  verify();
  receipt.complete = true;
  save();
  return { root, env, verify, receipt, receiptPath };
}
