import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { collectLogs } from "./vp-bootstrap-diagnostic-report.mjs";
import {
  versions,
  hash,
  context,
  latestLts,
  cacheKey,
  cachePaths,
  verifyCustody,
} from "./vp-bootstrap-diagnostic-contract.mjs";
export {
  versions,
  hash,
  context,
  latestLts,
  cacheKey,
  cachePaths,
  verifyCustody,
  ownedRef,
} from "./vp-bootstrap-diagnostic-contract.mjs";

const sourceFiles = [
  "package.json",
  "pnpm-workspace.yaml",
  "pnpm-lock.yaml",
  ".github/workflows/check.yml",
  ".github/actions/diagnose-vp-bootstrap/action.yml",
  ".github/workflows/vp-bootstrap-diagnostic.yml",
  "tools/support/compat/github/vp-bootstrap-diagnostic-contract.mjs",
  "tools/support/compat/github/vp-bootstrap-diagnostic-report.mjs",
  "tests/tooling/vp-bootstrap-diagnostic.test.mjs",
  "tools/support/compat/github/vp-bootstrap-diagnostic.mjs",
  "tests/tooling/l4-original-click-reference.test.ts",
  "tests/tooling/native-root-text-upstream-oracle.test.ts",
];
const json = (path) => JSON.parse(readFileSync(path, "utf8"));
const write = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + "\n");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const evidence = (lane) => join(process.env.RUNNER_TEMP, `vp-bootstrap-${lane}`);
const output = (name, value) => {
  // Only validated identities and absolute paths are emitted, never log text.
  assert(!String(value).includes("\n"));
  writeFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`, { flag: "a" });
};

function command(binary, args, path, { expected = 0, cwd = root, timeout = 120000 } = {}) {
  const started = Date.now();
  const result = spawnSync(binary, args, {
    cwd,
    encoding: "utf8",
    timeout,
    maxBuffer: 16 * 1024 * 1024,
  });
  writeFileSync(path + ".stdout", result.stdout ?? "");
  writeFileSync(path + ".stderr", result.stderr ?? "");
  write(path + ".json", {
    binary,
    args,
    cwd,
    started,
    completed: Date.now(),
    status: result.status,
    signal: result.signal,
    error: result.error?.message ?? null,
  });
  assert.ifError(result.error);
  assert.equal(result.signal, null);
  assert([expected].flat().includes(result.status), `command failed: ${binary} ${args.join(" ")}`);
  return result.stdout;
}

function sources() {
  assert.equal(
    spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).stdout.trim(),
    process.env.GITHUB_SHA,
  );
  const diff = spawnSync("git", ["diff", "HEAD", "--exit-code"], { cwd: root, encoding: "utf8" });
  assert.equal(diff.status, 0, "tracked source changed");
  return Object.fromEntries(
    sourceFiles.map((path) => [path, hash(readFileSync(join(root, path)))]),
  );
}

async function plan(lane) {
  assert(["cold", "warm"].includes(lane));
  const identity = context(process.env);
  assert.match(readFileSync("/etc/os-release", "utf8"), /^VERSION_ID="24\.04"$/m);
  const workspace = json(join(root, "package.json"));
  assert.equal(workspace.devEngines.runtime.version, versions.node);
  assert.equal(workspace.packageManager, `pnpm@${versions.projectPnpm}`);
  for (const variable of [
    "VP_HOME",
    "VP_BIN_DIR",
    "VP_DATA_DIR",
    "VP_CACHE_DIR",
    "VP_NODE_DIST_MIRROR",
    "VP_NODE_SKIP_SIGNATURE_VERIFY",
    "VP_NODE_VERSION",
    "VP_NODE_MANAGER",
    "VP_PM_MANAGER",
    "VP_PR_VERSION",
  ]) {
    assert(!process.env[variable], `unexpected existing environment override: ${variable}`);
  }
  // Fail rather than removing an existing installation or measuring a hidden warm cache.
  assert(
    !existsSync(join(homedir(), ".vite-plus")),
    "diagnostic runner already has a Vite+ installation",
  );
  const dir = evidence(lane);
  mkdirSync(dir, { recursive: true });
  let bootstrapLts;
  let index;
  if (lane === "cold") {
    const url = "https://nodejs.org/dist/index.json";
    const started = Date.now();
    const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
    assert(response.ok, `official Node index request failed: ${response.status}`);
    const body = await response.text();
    writeFileSync(join(dir, "node-index.raw.json"), body);
    index = { url, status: response.status, sha256: hash(body), started, completed: Date.now() };
    bootstrapLts = latestLts(JSON.parse(body));
  } else {
    const cold = json(join(process.env.RUNNER_TEMP, "vp-bootstrap-cold-custody/plan.json"));
    verifyCustody(
      cold,
      identity,
      sources(),
      process.env.VIZE_DIAG_COLD_KEY,
      process.env.VIZE_DIAG_COLD_PLAN_HASH,
    );
    bootstrapLts = cold.bootstrapLts;
    index = cold.index;
  }
  const manifest = {
    schema: 1,
    identity,
    bootstrapLts,
    index,
    sources: sources(),
    key: cacheKey(identity, bootstrapLts),
  };
  write(join(dir, "plan.json"), manifest);
  const paths = cachePaths(homedir(), bootstrapLts);
  write(join(dir, "before.json"), {
    sources: manifest.sources,
    paths,
    present: paths.map(existsSync),
    policy: lane === "cold" ? "lookup-only; must miss" : "restore exact cold snapshot; must hit",
  });
  output("key", manifest.key);
  output("plan-hash", hash(JSON.stringify(manifest)));
  output("vp-home", join(homedir(), ".vite-plus"));
  // Fixed absolute paths are passed as a multiline action input through a delimiter.
  writeFileSync(
    process.env.GITHUB_OUTPUT,
    `paths<<VIZE_VP_DIAG_PATHS\n${paths.join("\n")}\nVIZE_VP_DIAG_PATHS\n`,
    { flag: "a" },
  );
}

function beforeSetup(lane) {
  const manifest = json(join(evidence(lane), "plan.json"));
  const paths = cachePaths(homedir(), manifest.bootstrapLts);
  write(join(evidence(lane), "cache-outcome.json"), {
    requestedKey: manifest.key,
    matchedKey: process.env.VIZE_DIAG_CACHE_MATCHED_KEY,
    hit: process.env.VIZE_DIAG_CACHE_HIT,
    lookupOnly: lane === "cold",
    paths,
    present: paths.map(existsSync),
  });
  if (lane === "cold")
    assert.equal(process.env.VIZE_DIAG_CACHE_MATCHED_KEY, "", "cold namespace already exists");
  else {
    assert.equal(process.env.VIZE_DIAG_CACHE_HIT, "true", "warm must hit exact key");
    assert.equal(process.env.VIZE_DIAG_CACHE_MATCHED_KEY, manifest.key);
  }
  for (const path of paths) {
    assert.equal(existsSync(path), lane === "warm", "runtime snapshot presence differs from lane");
    if (lane === "warm")
      assert(!lstatSync(path).isSymbolicLink(), "restored install directory is a symlink");
  }
  if (lane === "warm") {
    const cold = json(join(process.env.RUNNER_TEMP, "vp-bootstrap-cold-custody/after.json"));
    assert.deepEqual(cold.identity, manifest.identity);
    assert.deepEqual(cold.sources, manifest.sources);
    assert.deepEqual(
      cold.installs.map((install) => install.path),
      paths.map((path) =>
        path.includes("package_manager") ? join(path, "pnpm/bin/pnpm.cjs") : join(path, "bin/node"),
      ),
    );
    for (const install of cold.installs) {
      assert.equal(
        hash(readFileSync(install.path)),
        install.sha256,
        "restored entry differs from cold custody record",
      );
    }
  }
  write(join(evidence(lane), "setup-start.json"), {
    started: Date.now(),
    cacheHit: process.env.VIZE_DIAG_CACHE_HIT,
    paths,
    policy:
      "upstream normal download verification on misses; existing install-state checks on hits",
  });
}

function afterSetup(lane) {
  const dir = evidence(lane);
  const manifest = json(join(dir, "plan.json"));
  const started = json(join(dir, "setup-start.json")).started;
  write(join(dir, "setup-duration.json"), {
    started,
    completed: Date.now(),
    elapsedSeconds: (Date.now() - started) / 1000,
  });
  assert.deepEqual(sources(), manifest.sources);
  assert.equal(
    command("node", ["--version"], join(dir, "node-version")).trim(),
    `v${versions.node}`,
  );
  const versionText = command("vp", ["--version"], join(dir, "vp-version"));
  assert.match(versionText, /^vp v1\.1\.0$/m, "global SDK version differs");
  const current = command("vp", ["env", "current", "--json"], join(dir, "environment"));
  const selected = JSON.parse(current);
  assert.equal(selected.node.version, versions.node);
  assert.equal(selected.package_manager.name, "pnpm");
  assert.equal(selected.package_manager.version, versions.projectPnpm);
  const paths = cachePaths(homedir(), manifest.bootstrapLts);
  const installedNodeVersions = readdirSync(join(homedir(), ".vite-plus/js_runtime/node"), {
    withFileTypes: true,
  })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
  assert.deepEqual(
    installedNodeVersions,
    [...new Set([manifest.bootstrapLts, versions.node])].sort((a, b) => a.localeCompare(b)),
    "bootstrap resolved a different LTS version than the cold/warm manifest",
  );
  const binaries = paths.map((path) =>
    path.includes("package_manager") ? join(path, "pnpm/bin/pnpm.cjs") : join(path, "bin/node"),
  );
  const installs = binaries.map((path) => {
    assert(existsSync(path), `expected install absent: ${path}; bootstrap LTS may have changed`);
    assert(!lstatSync(path).isSymbolicLink(), "runtime entry is a symlink");
    return { path, bytes: lstatSync(path).size, sha256: hash(readFileSync(path)) };
  });
  assert.equal(json(join(paths.at(-1), "pnpm/package.json")).version, versions.bootstrapPnpm);
  write(join(dir, "after.json"), {
    identity: manifest.identity,
    sources: sources(),
    installs,
    integrity:
      lane === "cold"
        ? "normal upstream cold download checks"
        : "ordinary existing-install checks; restored bytes are not freshly PGP/SHA verified",
  });
  const controlsDir = join(dir, "typescript-control");
  mkdirSync(controlsDir);
  const runtimePackage = `@typescript/typescript-linux-${manifest.identity.arch}`;
  const runtimeDir = join(root, "node_modules", runtimePackage);
  const pack = json(join(runtimeDir, "package.json"));
  assert.equal(pack.name, runtimePackage);
  assert.equal(pack.version, versions.typescript);
  const binary = join(runtimeDir, "lib/tsc");
  write(join(dir, "typescript-runtime.json"), {
    name: pack.name,
    version: pack.version,
    binary,
    sha256: hash(readFileSync(binary)),
  });
  const config = join(controlsDir, "tsconfig.json");
  write(config, {
    compilerOptions: {
      strict: true,
      noEmit: true,
      skipLibCheck: true,
      types: [],
      target: "ES2022",
      module: "ESNext",
      moduleResolution: "Bundler",
    },
    files: ["control.ts"],
  });
  writeFileSync(join(controlsDir, "control.ts"), "const count: number = 1;\n");
  assert.equal(
    command(binary, ["--project", config, "--pretty", "false"], join(dir, "typescript-positive")),
    "",
  );
  writeFileSync(join(controlsDir, "control.ts"), 'const count: number = "broken";\n');
  const invalid = command(
    binary,
    ["--project", config, "--pretty", "false"],
    join(dir, "typescript-negative"),
    { expected: [1, 2] },
  );
  assert.equal((invalid.match(/error TS2322:/g) ?? []).length, 1);
  assert.match(invalid, /Type 'string' is not assignable to type 'number'/);
  assert.equal((invalid.match(/error TS\d+:/g) ?? []).length, 1);
  const vue = command(
    "node",
    [
      "--test",
      "--test-reporter=tap",
      "tests/tooling/l4-original-click-reference.test.ts",
      "tests/tooling/native-root-text-upstream-oracle.test.ts",
    ],
    join(dir, "vue-controls"),
  );
  assert.match(vue, /# fail 0\b/);
  assert.match(vue, /# skipped 0\b/);
  assert.match(vue, /# pass 45\b/);
  assert.deepEqual(sources(), manifest.sources);
  write(join(dir, "controls.json"), {
    nativeTypescript: "positive and exactly one TS2322 negative",
    vue: "45 original whole compile/parser/runtime controls; zero skips",
    sources: sources(),
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [mode, lane] = process.argv.slice(2);
  if (mode === "guard") context(process.env);
  else if (mode === "plan") await plan(lane);
  else if (mode === "before") beforeSetup(lane);
  else if (mode === "after") afterSetup(lane);
  else if (mode === "logs") await collectLogs();
  else throw new Error(`unknown diagnostic mode: ${mode}`);
}
