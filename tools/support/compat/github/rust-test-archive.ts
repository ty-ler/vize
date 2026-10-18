import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  createReadStream,
  readFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
  statSync,
  lstatSync,
} from "node:fs";
import path, { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import {
  RUST_TEST_COHORTS,
  RUST_TEST_COHORT_IDS,
  isRustTestCohort,
  rustTestCohortForBinary,
  type RustTestCohortId,
} from "./rust-test-cohorts.ts";
import {
  normalizeWorkspaceInventory,
  verifyInventoryJUnit,
  type InventoryBinary,
} from "./rust-workspace-inventory.ts";

type Context = {
  cwd: string;
  nextestVersion: string;
  rustcVersion: string;
  env?: NodeJS.ProcessEnv;
};
type FileIdentity = { path: string; sha256: string };
type Payload = {
  cohort: RustTestCohortId;
  filter: string;
  archiveSha256: string;
  binaryIds: string[];
  binaryFiles: (FileIdentity & { id: string })[];
  files: FileIdentity[];
};
export type CohortBuildReceipt = Awaited<ReturnType<typeof sourceReceipt>> & {
  schemaVersion: 4;
  producerRun: string;
  producerAttempt: number;
  inventory: InventoryBinary[];
  payloads: Payload[];
};

async function digest(path: string) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

function checkout(cwd: string) {
  const git = (...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
  const sha = git("rev-parse", "HEAD");
  const source = git("show", `${sha}:rust-toolchain.toml`);
  const channels = [...source.matchAll(/^channel\s*=\s*"([^"]+)"\s*$/gm)];
  if (channels.length !== 1 || !["1.99.0", "1.99.1"].includes(channels[0][1]))
    throw new Error("Rust archive requires a reviewed committed source toolchain");
  return {
    toolchain: channels[0][1],
    workspaceRoot: resolve(cwd),
    sha,
    tree: git("rev-parse", "HEAD^{tree}"),
  };
}

function sourceReceipt({ cwd, nextestVersion, rustcVersion, env = process.env }: Context) {
  const requireTsgo = Object.hasOwn(env, "VIZE_TEST_REQUIRE_TSGO")
    ? env.VIZE_TEST_REQUIRE_TSGO
    : null;
  const disableTsgo = Object.hasOwn(env, "VIZE_TEST_DISABLE_TSGO")
    ? env.VIZE_TEST_DISABLE_TSGO
    : null;
  const { toolchain, ...source } = checkout(cwd);
  if (
    !rustcVersion?.startsWith(`rustc ${toolchain} `) ||
    !nextestVersion?.includes("0.9.146") ||
    !(
      (requireTsgo === "1" && disableTsgo === null) ||
      (requireTsgo === null && disableTsgo === "1")
    ) ||
    env.VIZE_NUXT_CONFIG_ITERATIONS !== "100"
  )
    throw new Error("Rust archive requires the pinned CI toolchain and TSGO runtime envelope");
  return {
    ...source,
    platform: process.platform,
    arch: process.arch,
    // cargo-binstall may select GNU or musl binaries on identical runners.
    // Their version banners differ, but the pinned nextest release is the
    // compatibility boundary for an archive consumed by another job.
    nextestVersion: "0.9.146",
    rustcVersion,
    cargoProfile: "ci",
    requireTsgo,
    disableTsgo,
    nuxtIterations: env.VIZE_NUXT_CONFIG_ITERATIONS || "",
  };
}

export async function createArchiveReceipt(archive: string, context: Context) {
  return { schemaVersion: 3, ...sourceReceipt(context), archiveSha256: await digest(archive) };
}

export async function verifyArchiveReceipt(
  receipt: Record<string, unknown>,
  archive: string,
  context: Context,
) {
  const actual = await createArchiveReceipt(archive, context);
  for (const key of Object.keys(actual) as Array<keyof typeof actual>) {
    if (receipt[key] !== actual[key]) throw new Error(`Rust test archive ${key} mismatch`);
  }
}

export function validateCohortBuildReceipt(value: unknown): CohortBuildReceipt {
  assert(value && typeof value === "object");
  const receipt = value as CohortBuildReceipt;
  assert.equal(receipt.schemaVersion, 4, "cohort payloads require common schema 4");
  assert.match(receipt.producerRun, /^[1-9]\d*$/);
  assert(Number.isSafeInteger(receipt.producerAttempt) && receipt.producerAttempt > 0);
  assert(Array.isArray(receipt.inventory) && receipt.inventory.length > 0);
  const ids = new Set<string>();
  for (const binary of receipt.inventory) {
    assert(typeof binary.id === "string" && binary.id.length > 0 && !ids.has(binary.id));
    ids.add(binary.id);
    rustTestCohortForBinary(binary.package, binary.binary);
    assert(Array.isArray(binary.cases));
    const names = new Set<string>();
    for (const item of binary.cases) {
      assert(typeof item.name === "string" && item.name.length > 0 && !names.has(item.name));
      assert.equal(typeof item.ignored, "boolean");
      names.add(item.name);
    }
  }
  assert.deepEqual(
    receipt.payloads.map((item) => item.cohort),
    [...RUST_TEST_COHORT_IDS],
  );
  for (const payload of receipt.payloads) {
    assert.equal(
      payload.filter,
      RUST_TEST_COHORTS.find((item) => item.id === payload.cohort)!.filter,
    );
    assert.match(payload.archiveSha256, /^[a-f0-9]{64}$/);
    assert.deepEqual(
      payload.binaryIds,
      receipt.inventory
        .filter((item) => rustTestCohortForBinary(item.package, item.binary) === payload.cohort)
        .map((item) => item.id),
    );
    assert(payload.binaryIds.length > 0, "each workspace cohort needs its real binaries");
    const files = new Set<string>();
    for (const file of payload.files) {
      assert(
        typeof file.path === "string" &&
          file.path.startsWith("target/") &&
          path.posix.normalize(file.path) === file.path &&
          !file.path.includes("\\") &&
          !files.has(file.path),
      );
      assert.match(file.sha256, /^[a-f0-9]{64}$/);
      assert(
        !Object.hasOwn(file, "linkTarget"),
        "archive resources bind regular materialized bytes",
      );
      files.add(file.path);
    }
    assert(files.size >= payload.binaryIds.length, "binary/resource closure is missing");
    assert.deepEqual(
      payload.binaryFiles.map((file) => file.id),
      payload.binaryIds,
    );
    assert.equal(
      new Set(payload.binaryFiles.map((file) => file.path)).size,
      payload.binaryIds.length,
    );
    for (const file of payload.binaryFiles) {
      assert.deepEqual(
        payload.files.find((item) => item.path === file.path),
        { path: file.path, sha256: file.sha256 },
        "test executable is absent from its resource closure",
      );
    }
  }
  return receipt;
}

export function verifyCohortExecution(receipt: CohortBuildReceipt, cohort: string, junit: string) {
  validateCohortBuildReceipt(receipt);
  assert(isRustTestCohort(cohort));
  const binaries = receipt.inventory.filter(
    (item) => rustTestCohortForBinary(item.package, item.binary) === cohort,
  );
  verifyInventoryJUnit(binaries, junit);
}

export async function verifyCohortArchive(
  receipt: unknown,
  archive: string,
  cohort: string,
  context: Context,
) {
  const common = validateCohortBuildReceipt(receipt);
  assert(isRustTestCohort(cohort));
  const actual = sourceReceipt(context);
  for (const key of Object.keys(actual) as Array<keyof typeof actual>)
    assert.deepEqual(common[key], actual[key], `cohort build ${key} mismatch`);
  if (context.env?.GITHUB_RUN_ID) {
    assert.equal(common.producerRun, context.env.GITHUB_RUN_ID);
    assert(common.producerAttempt <= Number(context.env.GITHUB_RUN_ATTEMPT));
  }
  assert.equal(
    await digest(archive),
    common.payloads.find((item) => item.cohort === cohort)!.archiveSha256,
    "cohort archive digest mismatch",
  );
}

export function verifyCohortFiles(receipt: unknown, cohort: string, cwd: string) {
  const common = validateCohortBuildReceipt(receipt);
  assert(isRustTestCohort(cohort));
  for (const file of common.payloads.find((item) => item.cohort === cohort)!.files) {
    const source = resolve(cwd, file.path);
    assert(lstatSync(source).isFile(), `extracted resource must be a regular file: ${file.path}`);
    assert.equal(
      createHash("sha256").update(readFileSync(source)).digest("hex"),
      file.sha256,
      `extracted binary/resource changed: ${file.path}`,
    );
  }
}

type RawSuite = {
  "package-id": string;
  "binary-path": string;
  "package-name": string;
  "binary-name": string;
};
type BuildMeta = {
  "target-directory": string;
  "build-directory": string;
  "non-test-binaries": Record<string, { kind: string; path: string }[]>;
  "build-script-out-dirs": Record<string, string>;
  "linked-paths": string[];
  platforms: { host: { libdir: { status: string; path: string } }; targets: unknown[] };
};

// Mirror nextest 0.9.146's resource ownership; archive creation itself remains
// nextest's job. File hashes verify the actual extracted resources, not just a
// successful tar transfer. Stdlib uses nextest's explicit relocation path.
async function payloadFiles(
  raw: { "rust-suites": Record<string, RawSuite>; "rust-build-meta": BuildMeta },
  cohort: RustTestCohortId,
  cwd: string,
): Promise<FileIdentity[]> {
  const meta = raw["rust-build-meta"];
  assert.equal(meta["target-directory"], resolve(cwd, "target"));
  assert.equal(meta["build-directory"], meta["target-directory"]);
  const files = new Map<string, string>();
  const add = (source: string, destination: string, depth = 0) => {
    const info = lstatSync(source);
    // nextest's pinned tar writer follows file links. Hash their actual
    // referents, not link text; directory links only produce directory headers
    // and cannot establish a file resource closure.
    if (info.isSymbolicLink()) {
      assert(statSync(source).isFile(), `archive symlink must resolve to a file: ${source}`);
      files.set(destination, source);
    } else if (info.isFile()) files.set(destination, source);
    else {
      assert(info.isDirectory());
      if (depth > 0)
        for (const entry of readdirSync(source).sort())
          add(path.join(source, entry), path.posix.join(destination, entry), depth - 1);
    }
  };
  const packages = new Set<string>();
  for (const suite of Object.values(raw["rust-suites"])) {
    if (rustTestCohortForBinary(suite["package-name"], suite["binary-name"]) !== cohort) continue;
    packages.add(suite["package-id"]);
    const relative = path.relative(cwd, suite["binary-path"]);
    assert(relative.startsWith("target/") && !relative.split(path.sep).includes(".."));
    add(suite["binary-path"], relative);
  }
  for (const [pkg, binaries] of Object.entries(meta["non-test-binaries"]))
    for (const binary of binaries) {
      if (binary.kind !== "bin-exe" || packages.has(pkg))
        add(resolve(meta["target-directory"], binary.path), `target/${binary.path}`);
    }
  for (const [pkg, directory] of Object.entries(meta["build-script-out-dirs"]))
    if (packages.has(pkg))
      add(resolve(meta["build-directory"], directory), `target/${directory}`, 1);
  for (const directory of meta["linked-paths"])
    if (statSync(resolve(meta["build-directory"], directory), { throwIfNoEntry: false }))
      add(resolve(meta["build-directory"], directory), `target/${directory}`, 1);
  const host = meta.platforms.host.libdir;
  assert.equal(host.status, "available");
  assert.deepEqual(
    meta.platforms.targets,
    [],
    "native CI archive does not guess cross-target libdirs",
  );
  const standard = readdirSync(host.path).filter((name) => /^libstd-.*\.so$/.test(name));
  assert.equal(standard.length, 1, "one actual native Linux stdlib is required");
  add(path.join(host.path, standard[0]), `target/nextest/libdirs/host/${standard[0]}`);
  const toml = createRequire(import.meta.url)("@iarna/toml");
  const config = toml.parse(readFileSync(resolve(cwd, ".config/nextest.toml"), "utf8"));
  for (const include of config.profile?.default?.archive?.include ?? []) {
    assert.equal(include["relative-to"], "target");
    assert(
      typeof include.path === "string" &&
        !path.isAbsolute(include.path) &&
        !include.path.split("/").includes(".."),
    );
    const source = resolve(meta["target-directory"], include.path);
    const depth = include.depth === "infinite" ? Infinity : (include.depth ?? 16);
    assert(depth === Infinity || (Number.isSafeInteger(depth) && depth >= 0));
    try {
      add(source, `target/${include.path}`, depth);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT" || include["on-missing"] === "error")
        throw error;
    }
  }
  const identities: FileIdentity[] = [];
  for (const [destination, source] of [...files].sort(([a], [b]) => a.localeCompare(b, "en"))) {
    identities.push({
      path: destination,
      sha256: await digest(source),
    });
  }
  return identities;
}

class NextestFailure extends Error {
  readonly status: number;
  constructor(status: number) {
    super(`nextest child exited ${status}`);
    this.status = status;
  }
}

export async function buildCohortArchives(plan: string, output: string, context: Context) {
  const cwd = context.cwd;
  mkdirSync(output, { recursive: true });
  const run = (args: string[], capture?: string) => {
    const result = spawnSync(
      "node",
      ["tools/support/compat/github/run-affected-rust.ts", plan, "cargo", "nextest", ...args],
      {
        cwd,
        env: context.env ?? process.env,
        stdio: capture ? ["ignore", "pipe", "inherit"] : "inherit",
        maxBuffer: 64 * 1024 * 1024,
      },
    );
    if (result.error) throw result.error;
    if (result.status !== 0) throw new NextestFailure(result.status ?? 1);
    assert.equal(result.signal, null);
    if (capture) writeFileSync(capture, result.stdout);
  };
  const inventoryPath = resolve(output, "workspace-tests.json");
  // The initial complete list builds the same unified affected package graph.
  // Ignored identities are inventoried but the worker run policy is unchanged.
  run(
    [
      "list",
      "@packages@",
      "--cargo-profile",
      "ci",
      "--timings",
      "--profile",
      "full",
      "--run-ignored",
      "all",
      "--message-format",
      "json",
    ],
    inventoryPath,
  );
  const raw = JSON.parse(readFileSync(inventoryPath, "utf8"));
  const inventory: InventoryBinary[] = normalizeWorkspaceInventory(raw);
  const payloads: Payload[] = [];
  for (const definition of RUST_TEST_COHORTS) {
    const destination = resolve(output, definition.id);
    mkdirSync(destination, { recursive: true });
    const archive = resolve(destination, "tests.tar.zst");
    // archive cannot reuse metadata; identical full Cargo arguments preserve
    // feature unification. Later packaging calls must reuse fresh compiled units.
    run([
      "archive",
      "@packages@",
      "--cargo-profile",
      "ci",
      "--timings",
      "-E",
      definition.filter,
      "--archive-file",
      archive,
    ]);
    const binaryIds = inventory
      .filter((item) => rustTestCohortForBinary(item.package, item.binary) === definition.id)
      .map((item) => item.id);
    const files = await payloadFiles(raw, definition.id, cwd);
    payloads.push({
      cohort: definition.id,
      filter: definition.filter,
      archiveSha256: await digest(archive),
      binaryIds,
      binaryFiles: binaryIds.map((id) => {
        const file = path.relative(cwd, raw["rust-suites"][id]["binary-path"]);
        const identity = files.find((item) => item.path === file);
        assert(identity, `missing source executable: ${id}`);
        return { id, ...identity };
      }),
      files,
    });
  }
  const env = context.env ?? process.env;
  const common = validateCohortBuildReceipt({
    schemaVersion: 4,
    ...sourceReceipt(context),
    producerRun: env.GITHUB_RUN_ID,
    producerAttempt: Number(env.GITHUB_RUN_ATTEMPT),
    inventory,
    payloads,
  });
  const bytes = JSON.stringify(common, null, 2) + "\n";
  writeFileSync(resolve(output, "receipt.json"), bytes);
  for (const payload of payloads)
    writeFileSync(resolve(output, payload.cohort, "receipt.json"), bytes);
  return common;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [operation, archive, receiptPath, cohort, junit] = process.argv.slice(2);
  if (
    !archive ||
    !receiptPath ||
    !["stamp", "verify", "build-cohorts", "verify-cohort", "verify-files"].includes(operation)
  ) {
    throw new Error(
      "usage: rust-test-archive.ts stamp|verify ARCHIVE RECEIPT | build-cohorts PLAN OUTPUT | verify-cohort ARCHIVE RECEIPT COHORT | verify-files WORKSPACE RECEIPT COHORT JUNIT",
    );
  }
  const context = {
    cwd: process.cwd(),
    rustcVersion: execFileSync("rustc", ["-Vv"], { encoding: "utf8" }).trim(),
    nextestVersion: execFileSync("cargo", ["nextest", "--version"], { encoding: "utf8" }).trim(),
  };
  if (operation === "build-cohorts") {
    try {
      await buildCohortArchives(archive, receiptPath, context);
    } catch (error) {
      if (error instanceof NextestFailure) {
        console.error(error.message);
        process.exit(error.status);
      }
      throw error;
    }
  } else if (operation === "verify-cohort") {
    await verifyCohortArchive(JSON.parse(readFileSync(receiptPath, "utf8")), archive, cohort!, {
      ...context,
      env: process.env,
    });
  } else if (operation === "verify-files") {
    const receipt = JSON.parse(readFileSync(receiptPath, "utf8"));
    verifyCohortFiles(receipt, cohort!, archive);
    assert(junit, "complete cohort JUnit is required");
    verifyCohortExecution(receipt, cohort!, readFileSync(junit, "utf8"));
  } else if (operation === "stamp") {
    writeFileSync(receiptPath, `${JSON.stringify(await createArchiveReceipt(archive, context))}\n`);
  } else {
    await verifyArchiveReceipt(JSON.parse(readFileSync(receiptPath, "utf8")), archive, context);
  }
}
