/** One incident's supplementary consumer proof; no release lifecycle authority. */
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gunzipSync } from "node:zlib";
import { preparePackage } from "../../support/release/jsr/package.ts";

export const identity = {
  repository: "ubugeeei-prod/vize",
  sourcePr: 9196,
  cut: "014bd42cacdf3d026fb75162cfa80dce76d78315",
  head: "03882089eff75664abe99ba71868e33739496b01",
  tag: "v0.457.0",
  releaseRun: 38805261385,
  releaseAttempt: 3,
  pin: "b5ec1bf30d8da37c50c4100804b5b6f33c18ead7",
  tagObject: "46536212e8e1a16492f9e196d84908286170d57b",
  integrationPr: 9197,
  integrationHead: "2c8a83c6858e8e46424ce578b5cfa7a0b1dbeafb",
  integrationMerge: "b4be3b70977b80a689c8e5ada62d05283e86b868",
  integrationParent: "014bd42cacdf3d026fb75162cfa80dce76d78315",
  protectedCandidate: "b4be3b70977b80a689c8e5ada62d05283e86b868",
} as const;
const workflow = ".github/workflows/release-published-0-457-consumer.yml";
const entry = "tools/commands/release/verify-published-0.457.0.ts";
const consumerPath = "tools/support/release/jsr/consumer.ts";
const policyPath = "tools/support/release/jsr/consumer-deno.json";
const generatorPath = "tools/support/release/jsr/package.ts";
const incidentPath = "tools/support/release/incidents/published-0.457.0.json.gz";
const originalDigest = "9db9805310dff2f7d5bf3363274b7297df49206e0c483ccf7a170e03f1eab8a5";
const failedJob = 116687943513;
export const digest = (value: Uint8Array | string) =>
  createHash("sha256").update(value).digest("hex");
const root = fileURLToPath(new URL("../../../", import.meta.url));
function command(program: string, args: string[]) {
  return execFileSync(program, args, { cwd: root, maxBuffer: 8 * 1024 * 1024, timeout: 300_000 });
}
const git = (...args: string[]) =>
  command("git", ["--no-replace-objects", ...args])
    .toString()
    .trim();
function blob(revision: string, path: string) {
  const record = git("ls-tree", revision, "--", path);
  assert.match(
    record,
    /^100(?:644|755) blob [0-9a-f]{40}\t/,
    `Regular source blob required: ${path}`,
  );
  return command("git", ["--no-replace-objects", "show", `${revision}:${path}`]);
}
const api = <T>(path: string): T =>
  JSON.parse(command("gh", ["api", `repos/${identity.repository}/${path}`]).toString());
type Run = {
  id: number;
  run_attempt: number;
  head_sha: string;
  head_branch: string;
  path: string;
  event: string;
  status: string;
  conclusion: string;
  display_title: string;
  repository: { full_name: string };
  head_repository: { full_name: string };
};
type Job = {
  id: number;
  run_id: number;
  run_attempt: number;
  name: string;
  status: string;
  conclusion: string;
  steps: { number: number; name: string; status: string; conclusion: string }[];
};
type Artifact = {
  id: number;
  name: string;
  digest: string;
  expired: boolean;
  size_in_bytes: number;
  workflow_run: { id: number; head_sha: string; head_branch: string };
};
export type Original = { run: Run; jobs: Job[]; artifacts: Artifact[]; failureLog: string };
type History = { schema: string; identity: typeof identity; catalog: Record<string, unknown> };

/** Capture complete job/artifact inventories; repository profile timestamps are not run identity. */
function projection(value: Original) {
  const r = value.run;
  return {
    run: [
      r.id,
      r.run_attempt,
      r.head_sha,
      r.head_branch,
      r.path,
      r.event,
      r.status,
      r.conclusion,
      r.display_title,
      r.repository.full_name,
      r.head_repository.full_name,
    ],
    jobs: value.jobs
      .map((j) => [
        j.id,
        j.run_id,
        j.run_attempt,
        j.name,
        j.status,
        j.conclusion,
        j.steps.map((s) => [s.number, s.name, s.status, s.conclusion]),
      ])
      .sort((a, b) => Number(a[0]) - Number(b[0])),
    artifacts: value.artifacts
      .map((a) => [
        a.id,
        a.name,
        a.digest,
        a.expired,
        a.size_in_bytes,
        a.workflow_run.id,
        a.workflow_run.head_sha,
        a.workflow_run.head_branch,
      ])
      .sort((a, b) => Number(a[0]) - Number(b[0])),
    failureLog: value.failureLog,
  };
}
export function capturedOriginal(): Original {
  const bytes = gunzipSync(readFileSync(join(root, incidentPath)), {
    maxOutputLength: 1024 * 1024,
  });
  assert.equal(digest(bytes), originalDigest, "Reviewed original incident data changed");
  return JSON.parse(bytes.toString());
}
export function assertOriginal(value: Original) {
  assert.deepEqual(
    projection(value),
    projection(capturedOriginal()),
    "Original run, complete gate/artifact inventory or Deno failure changed",
  );
}
function inventory<T>(path: string, key: "jobs" | "artifacts"): T[] {
  const rows: T[] = [];
  let total: number | undefined;
  for (let page = 1; page <= 4; page++) {
    const response = api<Record<string, unknown>>(
      `${path}${path.includes("?") ? "&" : "?"}per_page=100&page=${page}`,
    );
    assert.ok(Number.isSafeInteger(response.total_count));
    total ??= response.total_count as number;
    assert.equal(response.total_count, total, "Changing inventory pagination");
    const items = response[key];
    assert.ok(Array.isArray(items) && items.length <= 100);
    rows.push(...(items as T[]));
    if (items.length < 100) {
      assert.equal(rows.length, total, "Incomplete inventory");
      return rows;
    }
  }
  throw new Error("Original inventory exceeded its bound");
}
function original(): Original {
  const run = api<Run>(`actions/runs/${identity.releaseRun}`);
  const value = {
    run,
    jobs: inventory<Job>(`actions/runs/${run.id}/jobs?filter=latest`, "jobs"),
    artifacts: inventory<Artifact>(`actions/runs/${run.id}/artifacts`, "artifacts"),
    failureLog: command("gh", [
      "api",
      "--allow-escape-sequences",
      `repos/${identity.repository}/actions/jobs/${failedJob}/logs`,
    ]).toString(),
  };
  assertOriginal(value);
  assertOriginal({ ...value, run: api<Run>(`actions/runs/${run.id}`) });
  return value;
}
export function assertHistory(value: History) {
  assert.equal(value.schema, "vize-published-history-v1");
  assert.deepEqual(value.identity, identity, "Wrong H/C/pin/tag/R/integration identity");
  assert.ok(value.catalog && Object.keys(value.catalog).length > 0);
}
function history(): History {
  const value: History = JSON.parse(
    command("rust-script", [
      "tools/commands/release/pr.rs",
      "published-history",
      String(identity.sourcePr),
      identity.head,
      identity.tag,
      String(identity.releaseRun),
    ]).toString(),
  );
  assertHistory(value);
  return value;
}
export function assertPolicy(value: unknown) {
  const policy = structuredClone(value) as { minimumDependencyAge: { exclude: string[] } };
  policy.minimumDependencyAge.exclude.sort();
  const owned = [
    "vize",
    "@vizejs/native",
    "@vizejs/vite-plugin",
    "@vizejs/unplugin",
    ...[
      "darwin-arm64",
      "darwin-x64",
      "linux-arm64-gnu",
      "linux-arm64-musl",
      "linux-x64-gnu",
      "linux-x64-musl",
      "win32-arm64-msvc",
      "win32-x64-msvc",
    ].map((name) => `@vizejs/native-${name}`),
  ];
  assert.deepEqual(policy, {
    nodeModulesDir: "none",
    minimumDependencyAge: {
      age: "P1D",
      exclude: ["jsr:@vizejs/vize", ...owned.map((name) => `npm:${name}`)].sort(),
    },
  });
}
function sources(policy: string) {
  for (const file of [consumerPath, generatorPath]) {
    assert.deepEqual(
      blob(policy, file),
      blob(identity.head, file),
      `Original program changed: ${file}`,
    );
  }
  assertPolicy(JSON.parse(blob(policy, policyPath).toString()));
  const files = [
    entry,
    workflow,
    incidentPath,
    consumerPath,
    policyPath,
    generatorPath,
    "package.json",
    "tools/commands/release/pr.rs",
    ".github/actions/setup-rust-script/action.yml",
    ".github/actions/setup-rust-script/download-prebuilt.sh",
    ".github/actions/setup-rust-script/extract-prebuilt.sh",
    ...git("ls-tree", "-r", "--name-only", policy, "--", "tools/support/release/")
      .split("\n")
      .filter((path) => /^tools\/support\/release\/pr_[^/]+\.rs$/.test(path)),
  ];
  return Object.fromEntries(
    files
      .sort((left, right) => left.localeCompare(right))
      .map((file) => {
        const bytes = blob(policy, file);
        assert.deepEqual(
          readFileSync(join(root, file)),
          bytes,
          `Working authority changed: ${file}`,
        );
        return [file, digest(bytes)];
      }),
  );
}
async function publicBytes(suffix: string) {
  const url = `https://jsr.io/@vizejs/vize/0.457.0${suffix}`;
  const response = await fetch(url, {
    redirect: "error",
    credentials: "omit",
    signal: AbortSignal.timeout(30_000),
  });
  assert.equal(response.status, 200, `Public version unavailable: ${url}`);
  assert.equal(response.url, url);
  assert.ok(response.body);
  let size = 0;
  const chunks: Uint8Array[] = [];
  for await (const chunk of response.body) {
    size += chunk.length;
    assert.ok(size <= 1024 * 1024);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
async function publicFacades(temporary: string) {
  const snapshot = join(temporary, "source"),
    staged = join(temporary, "package");
  for (const file of [
    "npm/cli/package.json",
    "npm/native/package.json",
    "npm/builder/vite/package.json",
    "jsr/vize/jsr.json",
    "jsr/vize/README.md",
    "LICENSE",
  ]) {
    mkdirSync(dirname(join(snapshot, file)), { recursive: true });
    writeFileSync(join(snapshot, file), blob(identity.head, file), { flag: "wx" });
  }
  preparePackage(staged, { root: snapshot, version: "0.457.0" });
  const metadata = JSON.parse((await publicBytes("_meta.json")).toString());
  const files = readdirSync(staged).sort();
  assert.deepEqual(Object.keys(metadata.manifest).sort(), files.map((file) => `/${file}`).sort());
  assert.deepEqual(
    metadata.exports,
    JSON.parse(readFileSync(join(snapshot, "jsr/vize/jsr.json"), "utf8")).exports,
  );
  const result = [];
  for (const file of files) {
    const bytes = await publicBytes(`/${file}`);
    assertFacade(bytes, readFileSync(join(staged, file)), metadata.manifest[`/${file}`]);
    result.push({ file, sha256: digest(bytes), bytes: bytes.length });
  }
  return result;
}
export function assertFacade(
  actual: Buffer,
  original: Buffer,
  metadata: { checksum: string; size: number },
) {
  assert.deepEqual(actual, original, "Published facade differs from H");
  assert.equal(metadata.checksum, `sha256-${digest(actual)}`);
  assert.equal(metadata.size, actual.length);
}
export function assertEntry(env: NodeJS.ProcessEnv, checkout: string) {
  assert.equal(env.GITHUB_REPOSITORY, identity.repository);
  assert.equal(env.GITHUB_EVENT_NAME, "workflow_dispatch");
  assert.equal(env.GITHUB_REF, "refs/heads/main");
  assert.equal(env.GITHUB_WORKFLOW_REF, `${identity.repository}/${workflow}@refs/heads/main`);
  assert.equal(env.GITHUB_WORKFLOW_SHA, env.GITHUB_SHA);
  assert.match(checkout, /^[0-9a-f]{40}$/);
  assert.equal(checkout, env.GITHUB_SHA);
  for (const key of ["GITHUB_RUN_ID", "GITHUB_RUN_ATTEMPT"]) {
    assert.match(env[key] ?? "", /^[1-9][0-9]*$/);
    assert.ok(Number.isSafeInteger(Number(env[key])));
  }
  for (const key of [
    "NODE_OPTIONS",
    "GIT_REPLACE_REF_BASE",
    "LD_PRELOAD",
    "DYLD_INSERT_LIBRARIES",
  ]) {
    assert.ok(!env[key], `Process override forbidden: ${key}`);
  }
}
export function consumerEnvironment(temporary: string, env: NodeJS.ProcessEnv) {
  return {
    PATH: env.PATH,
    HOME: join(temporary, "empty-home"),
    DENO_DIR: join(temporary, "empty-cache"),
    NO_COLOR: "1",
    TMPDIR: temporary,
  };
}
async function main() {
  const env = process.env,
    policy = git("rev-parse", "HEAD");
  assertEntry(env, policy);
  assert.equal(process.argv.length, 3);
  const out = resolve(process.argv[2]);
  mkdirSync(out);
  const temp = realpathSync(mkdtempSync(join(realpathSync(env.RUNNER_TEMP!), "published-v0457-")));
  assert.ok(!temp.startsWith(realpathSync(root) + sep));
  const report: Record<string, unknown> = {
    schema: "vize-published-0.457.0-consumer-v1",
    status: "running",
    context: {
      repository: identity.repository,
      policy,
      workflow,
      run: env.GITHUB_RUN_ID,
      attempt: env.GITHUB_RUN_ATTEMPT,
    },
    originalDigest,
    authority:
      "Supplementary Deno proof only. This read-only run does not change the source receipt or original R failure; manual current-custody and all-channel review are required.",
  };
  const save = () => writeFileSync(join(out, "proof.json"), `${JSON.stringify(report, null, 2)}\n`);
  try {
    report.sources = sources(policy);
    report.historyBefore = history();
    report.originalBefore = original();
    report.publicFacades = await publicFacades(temp);
    const cwd = join(temp, "consumer"),
      denoDir = join(temp, "empty-cache"),
      home = join(temp, "empty-home");
    for (const path of [cwd, denoDir, home]) mkdirSync(path);
    writeFileSync(join(cwd, "consumer.ts"), blob(identity.head, consumerPath), { flag: "wx" });
    writeFileSync(join(cwd, "deno.json"), blob(policy, policyPath), { flag: "wx" });
    writeFileSync(
      join(cwd, "package.json"),
      '{"name":"vize-jsr-consumer","private":true,"type":"module"}\n',
      { flag: "wx" },
    );
    const runtime = command("deno", ["--version"]).toString().trim();
    assert.match(runtime, /^deno 2\.9\.7 \(stable, release, x86_64-unknown-linux-gnu\)\n/);
    const argv = [
      "run",
      "--config",
      "deno.json",
      "--allow-all",
      "consumer.ts",
      "jsr:@vizejs/vize@0.457.0",
    ];
    const result = spawnSync("deno", argv, {
      cwd,
      encoding: "utf8",
      timeout: 180_000,
      maxBuffer: 1024 * 1024,
      env: consumerEnvironment(temp, env),
    });
    report.execution = {
      runtime,
      argv: ["deno", ...argv],
      cwd,
      denoDir,
      exitCode: result.status,
      stdout: result.stdout,
      stderr: result.stderr,
    };
    save();
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), "Verified jsr:@vizejs/vize@0.457.0 (no flags)");
    report.historyAfter = history();
    assert.deepEqual(report.historyAfter, report.historyBefore, "Historical custody changed");
    report.originalAfter = original();
    report.status = "passed";
    save();
    console.log(
      "Supplementary v0.457.0 Deno assertions passed. Original R remains failed; external review must precede manual finalization.",
    );
  } catch (error) {
    report.status = "failed";
    save();
    throw error;
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  await main();
