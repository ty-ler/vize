import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

import { inspectPrepareNode } from "./nuxt-check-runtime.ts";
import { inspectRekaNpx } from "./reka-check-providers.ts";
import { assertNoSourceMutation, git, restoreAuthored } from "./nuxt-check-source.ts";
import {
  inspectArchive,
  observeInstalledArchive,
  type ArchiveEvidence,
} from "../../tools/support/release/consumer_recovery/archive.ts";
import {
  assertSource,
  campaignInventory,
  consumeAppCheckProviders,
  assertUnpreparedSource,
  checkPolicies,
  copyExactGeneratedFile,
  frozenInstallArgs,
  assertFullDependencyInstall,
  observeSource,
  providerInventory,
  validateGeneratedGraph,
  validateManager,
  type GeneratedGraph,
  type Prepared,
  type Policy,
  type ProcessEvidence,
  type Source,
} from "./app-check-custody.ts";

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const readJson = (file: string) => JSON.parse(fs.readFileSync(file, "utf8"));
const pin = /^[a-f0-9]{40}$/;
type Manager = {
  entry: string;
  directory: string;
  version: string;
  integrity: string;
  archive: string;
  evidence: ArchiveEvidence;
};
/** B/H consumers never resolve, install, or regenerate. Both use one physical program. */
export function preparationMode(args: string[]) {
  assert.ok(
    args[0] === "--prepare" || args[0] === "--consume",
    "explicit preparation phase required",
  );
  if (args[0] === "--prepare") assert.equal(args.length, 1, "producer has no consumer override");
  else
    assert.ok(
      args.length === 3 && /^[a-f0-9]{64}$/.test(args[2]),
      "consumer needs independently passed receipt SHA256",
    );
  return args[0];
}

function prepareVoicevoxEnvironment(source: Source) {
  if (source.policy.name !== "voicevox") return;
  // Original 0a7fcc8 README:66 and CONTRIBUTING:134 explicitly prescribe this copy.
  // Preserve even the original engine example bytes; this is no engine/runtime claim.
  const recipe = source.files.find((entry) => entry.file === "README.md")!;
  assert.equal(
    sha(recipe.bytes),
    "74337b6eb18f8d638939773cfe7fccdb0594f035957e1559118132ab5cbeadf1",
  );
  assert.ok(!source.files.some((entry) => entry.file === ".env"), "authored env policy changed");
  assert.equal(git(source.cwd, ["check-ignore", "--", ".env"]).trim(), ".env");
  const example = source.files.find((entry) => entry.file === ".env.example");
  assert.ok(example, "original environment example required");
  copyExactGeneratedFile(example.bytes, path.join(source.cwd, ".env"));
}

function store(directory: string, bytes: Uint8Array) {
  const destination = path.join(directory, "bytes", sha(bytes));
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  if (!fs.existsSync(destination))
    fs.writeFileSync(destination, bytes, { flag: "wx", mode: 0o444 });
  return destination;
}

function command(
  campaign: string,
  executable: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
): ProcessEvidence {
  const directory = fs.mkdtempSync(path.join(campaign, "command-"));
  const result = spawnSync(executable, args, {
    cwd,
    env,
    timeout: 600_000,
    killSignal: "SIGKILL",
    maxBuffer: 128 * 1024 * 1024,
  });
  const stdout = path.join(directory, "stdout.bin"),
    stderr = path.join(directory, "stderr.bin");
  fs.writeFileSync(stdout, result.stdout ?? Buffer.alloc(0));
  fs.writeFileSync(stderr, result.stderr ?? Buffer.alloc(0));
  const environment = Object.fromEntries(
    [
      "PATH",
      "NODE_ENV",
      "VP_NODE_VERSION",
      "NPM_CONFIG_USERCONFIG",
      "NPM_CONFIG_GLOBALCONFIG",
      "NPM_CONFIG_REGISTRY",
      "NPM_CONFIG_CACHE",
    ].map((key) => [key, env[key]]),
  );
  const evidence = {
    executable,
    args,
    cwd,
    status: result.status,
    signal: result.signal,
    error: result.error?.message ?? null,
    stdout,
    stderr,
    stdoutSha256: sha(result.stdout ?? Buffer.alloc(0)),
    stderrSha256: sha(result.stderr ?? Buffer.alloc(0)),
    environment,
  };
  fs.writeFileSync(path.join(directory, "process.json"), JSON.stringify(evidence, null, 2));
  assert.equal(evidence.error, null, `preparation command failed; raw evidence: ${directory}`);
  assert.equal(evidence.signal, null, `preparation command terminated; raw evidence: ${directory}`);
  assert.equal(evidence.status, 0, `preparation command failed; raw evidence: ${directory}`);
  return evidence;
}

export function packageManagerEnvironment(inherited: NodeJS.ProcessEnv, campaign: string) {
  const env = { ...inherited };
  for (const key of Object.keys(env))
    if (/^(npm_config_|pnpm_|corepack_)/i.test(key)) delete env[key];
  const user = path.join(campaign, "user.npmrc"),
    global = path.join(campaign, "global.npmrc");
  for (const file of [user, global]) {
    if (!fs.existsSync(file)) fs.writeFileSync(file, "", { flag: "wx" });
    assert.equal(fs.readFileSync(file, "utf8"), "", "ambient PM configuration refused");
  }
  Object.assign(env, {
    NPM_CONFIG_USERCONFIG: user,
    NPM_CONFIG_GLOBALCONFIG: global,
    NPM_CONFIG_REGISTRY: "https://registry.npmjs.org/",
    NPM_CONFIG_CACHE: path.join(campaign, "npm-cache"),
    HUSKY: "0",
    SKIP_INSTALL_SIMPLE_GIT_HOOKS: "1",
  });
  return env;
}

function runtime(policy: Policy, campaign: string) {
  const binary =
    policy.name === "misskey" ? process.env.VIZE_APP_CHECK_PREPARE_NODE22 : process.execPath;
  assert.ok(binary, "original Misskey preparation requires the provisioned Node 22");
  const selected = inspectPrepareNode(binary, process.env);
  const version = selected.observation.version.slice(1).split(".").map(Number);
  assert.equal(version[0], policy.minimumNode[0], "wrong authored Node major");
  assert.ok(
    version[1] > policy.minimumNode[1] ||
      (version[1] === policy.minimumNode[1] && version[2] >= policy.minimumNode[2]),
    "preparation Node is older than authored engine",
  );
  const env = packageManagerEnvironment(selected.env, campaign);
  fs.writeFileSync(
    path.join(campaign, `${policy.name}-runtime.json`),
    JSON.stringify(selected.observation, null, 2),
  );
  return { ...selected, env };
}

function manager(source: Source, campaign: string, selected: ReturnType<typeof runtime>): Manager {
  const expectedIntegrity = validateManager(source.manifest, source.policy);
  const npm = inspectRekaNpx(selected.env);
  const cli = path.join(path.dirname(npm.cli), "npm-cli.js");
  assert.equal(readJson(npm.manifest).name, "npm");
  store(campaign, fs.readFileSync(cli));
  store(campaign, fs.readFileSync(npm.manifest));
  const directory = path.join(campaign, `${source.policy.name}-manager`);
  fs.mkdirSync(directory);
  const frame = command(
    campaign,
    selected.observation.executable,
    [
      cli,
      "pack",
      `pnpm@${source.policy.manager}`,
      "--json",
      "--ignore-scripts",
      "--pack-destination",
      directory,
    ],
    directory,
    selected.env,
  );
  const packed = JSON.parse(fs.readFileSync(frame.stdout, "utf8"));
  assert.equal(packed.length, 1);
  const [record] = packed;
  assert.equal(record.filename, path.basename(record.filename));
  const archive = path.join(directory, record.filename),
    bytes = fs.readFileSync(archive);
  const evidence = inspectArchive(bytes, record.integrity);
  assert.equal(evidence.archiveManifest.name, "pnpm");
  assert.equal(evidence.archiveManifest.version, source.policy.manager);
  if (expectedIntegrity)
    assert.equal(
      createHash("sha512").update(bytes).digest("hex"),
      expectedIntegrity,
      "authored PM integrity differs",
    );
  command(
    campaign,
    "tar",
    ["-xzf", archive, "--no-same-owner", "--no-same-permissions", "-C", directory],
    directory,
    selected.env,
  );
  const installed = path.join(directory, "package");
  observeInstalledArchive(installed, evidence.archiveEntries);
  const entry = path.join(installed, "bin/pnpm.cjs");
  assert.ok(evidence.archiveEntries.some((row) => row.path === "bin/pnpm.cjs"));
  fs.writeFileSync(
    path.join(directory, "custody.json"),
    JSON.stringify(
      {
        npm,
        archive,
        integrity: record.integrity,
        evidence,
        registry: selected.env.NPM_CONFIG_REGISTRY,
      },
      null,
      2,
    ),
  );
  return {
    entry,
    directory: installed,
    version: source.policy.manager,
    integrity: record.integrity,
    archive,
    evidence,
  };
}

function runManager(
  source: Source,
  campaign: string,
  selected: ReturnType<typeof runtime>,
  pm: Manager,
  args: string[],
  cwd = source.cwd,
) {
  observeInstalledArchive(pm.directory, pm.evidence.archiveEntries);
  const env = {
    ...selected.env,
    PATH: `${path.dirname(selected.observation.executable)}${path.delimiter}${path.dirname(pm.entry)}${path.delimiter}${selected.env.PATH ?? ""}`,
  };
  try {
    return command(campaign, selected.observation.executable, [pm.entry, ...args], cwd, env);
  } finally {
    observeInstalledArchive(pm.directory, pm.evidence.archiveEntries);
    assertSource(source);
    if (cwd !== source.cwd) assertNoSourceMutation(source.files, cwd, true);
  }
}

function resolveNaive(
  source: Source,
  campaign: string,
  selected: ReturnType<typeof runtime>,
  pm: Manager,
): GeneratedGraph {
  assert.equal(source.policy.name, "naive-ui");
  assert.ok(
    !source.files.some((entry) => entry.file === "pnpm-lock.yaml"),
    "upstream gained a lock: review policy",
  );
  const staging = path.join(campaign, "naive-original-source");
  fs.mkdirSync(staging);
  for (const entry of source.files) restoreAuthored(staging, entry);
  const resolution = runManager(
    source,
    campaign,
    selected,
    pm,
    ["install", "--lockfile-only", "--no-frozen-lockfile", "--ignore-scripts", "--prod=false"],
    staging,
  );
  assertNoSourceMutation(source.files, staging, true);
  const bytes = fs.readFileSync(path.join(staging, "pnpm-lock.yaml"));
  const lock = path.join(campaign, "naive-generated-lock.yaml");
  fs.writeFileSync(lock, bytes, { flag: "wx", mode: 0o444 });
  const graph: GeneratedGraph = {
    kind: "generated-fixture-authority",
    fixture: "naive-ui",
    pin: source.policy.pin,
    manager: source.manifest.packageManager,
    source: source.files.map(({ file, mode, oid }) => ({ file, mode, oid })),
    lock: { file: lock, sha256: sha(bytes) },
    registry: "https://registry.npmjs.org/",
    managerIntegrity: pm.integrity,
    managerArchive: pm.archive,
    resolution,
    campaign: fs.realpathSync(campaign),
  };
  validateGeneratedGraph(graph, source, campaign);
  fs.writeFileSync(
    path.join(campaign, "generated-lock-authority.json"),
    JSON.stringify(graph, null, 2),
    { flag: "wx", mode: 0o444 },
  );
  return graph;
}

/** Producer only: all original prerequisites run once before either B/H consumer. */
export function lockedProviders(source: Source) {
  const retained: string[] = [];
  const lock = parse(fs.readFileSync(path.join(source.cwd, "pnpm-lock.yaml"), "utf8"));
  assert.ok(lock.importers && lock.packages, "whole lock including resolved packages required");
  assertFullDependencyInstall(
    parse(fs.readFileSync(path.join(source.cwd, "node_modules/.modules.yaml"), "utf8")),
  );
  for (const entry of source.files.filter((entry) => /(^|\/)package\.json$/.test(entry.file))) {
    const owner = path.dirname(entry.file),
      importer = owner === "." ? "." : owner;
    const manifest = JSON.parse(entry.bytes.toString("utf8"));
    const locked = lock.importers[importer];
    if (!locked) continue; // Non-workspace tool manifests are not package-manager importers.
    for (const section of ["dependencies", "devDependencies"])
      for (const name of Object.keys(manifest[section] ?? {})) {
        const record = locked[section]?.[name];
        if (source.manifest.pnpm?.overrides?.[name] === "-") {
          assert.equal(record, undefined, "authored removed dependency unexpectedly resolved");
          continue;
        }
        assert.ok(record, `missing locked ${importer}:${name}`);
        const logical = path.join(source.cwd, owner, "node_modules", name);
        const physical = fs.realpathSync(logical);
        assert.ok(physical.startsWith(source.cwd + path.sep), `ambient ${name} provider`);
        const packageFile = path.join(logical, "package.json"),
          actual = readJson(packageFile);
        const version = String(record.version).split("(")[0];
        if (version.startsWith("file:")) {
          assert.deepEqual(
            fs.readFileSync(packageFile),
            fs.readFileSync(path.join(source.cwd, owner, version.slice(5), "package.json")),
            "local authored package changed",
          );
        } else if (!version.startsWith("link:")) {
          const alias = version.startsWith("https://") ? null : /^(.*)@(\d[^@]*)$/.exec(version);
          let expectedVersion = alias?.[2] ?? version;
          if (version.startsWith("https://")) {
            const resolved = lock.packages[`${name}@${version}`];
            assert.equal(resolved?.resolution?.tarball, version, "locked tarball locator mismatch");
            assert.ok(typeof resolved.version === "string" && resolved.version.length > 0);
            expectedVersion = resolved.version;
          }
          assert.equal(actual.name, alias?.[1] ?? name);
          assert.equal(actual.version, expectedVersion, `wrong locked ${name}`);
        }
        retained.push(packageFile);
      }
  }
  retained.push(
    path.join(source.cwd, "pnpm-lock.yaml"),
    path.join(source.cwd, "node_modules/.modules.yaml"),
    path.join(source.cwd, "node_modules/.pnpm/lock.yaml"),
  );
  return retained;
}

export function prepareAppCheckProviders(
  authorityRoot = repository,
  captureParent = process.env.RUNNER_TEMP ?? os.tmpdir(),
) {
  authorityRoot = fs.realpathSync(authorityRoot);
  assert.ok(
    !process.env.VIZE_APP_CHECK_BASELINE,
    "baseline must consume an existing graph, never prepare/re-resolve",
  );
  captureParent = fs.realpathSync(captureParent);
  assert.ok(
    captureParent !== authorityRoot && !captureParent.startsWith(authorityRoot + path.sep),
    "campaign custody must be outside product source",
  );
  const campaign = fs.mkdtempSync(path.join(captureParent, "vize-original-check-campaign-"));
  assert.ok(
    !campaign.startsWith(authorityRoot + path.sep),
    "campaign custody must be outside product source",
  );
  const sourceHead = git(authorityRoot, ["rev-parse", "HEAD"]).trim();
  assert.match(sourceHead, pin);
  const fixtures: Prepared["fixtures"] = [];
  let generated: GeneratedGraph | undefined;
  for (const policy of checkPolicies) {
    const source = observeSource(authorityRoot, policy);
    assertUnpreparedSource(source);
    const mutex = path.join(
      os.tmpdir(),
      `vize-original-check-${sha(Buffer.from(source.cwd))}.lock`,
    );
    fs.mkdirSync(mutex);
    try {
      const selected = runtime(policy, campaign),
        pm = manager(source, campaign, selected);
      for (const entry of source.files.filter((entry) =>
        /(?:\.[cm]?[jt]sx?|\.(?:jsonc?|node-version|nvmrc|tool-versions)|README\.md|CONTRIBUTING\.md|\.env\.example|\.gitignore|pnpm-(?:lock|workspace)\.yaml)$|(?:^|\/)\.[^/]*rc$/.test(
          entry.file,
        ),
      ))
        store(campaign, entry.bytes);
      if (policy.name === "naive-ui") {
        generated = resolveNaive(source, campaign, selected, pm);
        const destination = path.join(source.cwd, "pnpm-lock.yaml");
        if (fs.existsSync(destination))
          assert.equal(
            sha(fs.readFileSync(destination)),
            generated.lock.sha256,
            "refuse existing different generated graph",
          );
        else fs.copyFileSync(generated.lock.file, destination, fs.constants.COPYFILE_EXCL);
      } else
        assert.ok(
          source.files.some((entry) => entry.file === "pnpm-lock.yaml"),
          "authored lock missing",
        );
      const lockBefore = fs.readFileSync(path.join(source.cwd, "pnpm-lock.yaml"));
      runManager(source, campaign, selected, pm, frozenInstallArgs());
      prepareVoicevoxEnvironment(source);
      for (const args of policy.hooks) runManager(source, campaign, selected, pm, args);
      assert.deepEqual(
        fs.readFileSync(path.join(source.cwd, "pnpm-lock.yaml")),
        lockBefore,
        "frozen install/hook changed lock",
      );
      for (const file of lockedProviders(source)) store(campaign, fs.readFileSync(file));
      const inventory = providerInventory(source);
      for (const item of inventory)
        if (item.kind === "file" && !item.file.split("/").includes("node_modules"))
          store(campaign, fs.readFileSync(path.join(source.cwd, item.file)));
      fixtures.push({
        name: policy.name,
        pin: policy.pin,
        cwd: source.cwd,
        inventory,
        source: source.files.map(({ file, mode, oid }) => ({ file, mode, oid })),
      });
    } finally {
      fs.rmdirSync(mutex);
    }
  }
  assert.ok(generated, "one original Naive graph required");
  const prepared: Prepared = {
    schema: 1,
    authorityRoot,
    sourceHead,
    campaign,
    generated,
    evidence: campaignInventory(campaign),
    fixtures,
  };
  const receipt = path.join(campaign, "prepared.json");
  const bytes = Buffer.from(JSON.stringify(prepared, null, 2) + "\n");
  fs.writeFileSync(receipt, bytes, { flag: "wx", mode: 0o444 });
  return { receipt, sha256: sha(bytes) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2),
    mode = preparationMode(args);
  const result =
    mode === "--prepare" ? prepareAppCheckProviders() : { receipt: args[1], sha256: args[2] };
  consumeAppCheckProviders(result.receipt, result.sha256);
  if (process.env.GITHUB_ENV) {
    assert.ok(!/[\r\n]/.test(result.receipt));
    fs.appendFileSync(
      process.env.GITHUB_ENV,
      `VIZE_APP_CHECK_PREPARED_RECEIPT=${result.receipt}\nVIZE_APP_CHECK_PREPARED_SHA256=${result.sha256}\n`,
    );
  }
  console.log(
    JSON.stringify({
      ...result,
      authority: "shared prepared original fixture graph; no native diagnostic acceptance",
      campaignDrift:
        "A new producer campaign resolves Naive once; both B/H consumers must use this exact receipt and SHA, never re-run producer.",
    }),
  );
}
