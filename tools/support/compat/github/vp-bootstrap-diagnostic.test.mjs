import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectLogs } from "./vp-bootstrap-diagnostic-report.mjs";
import { test } from "node:test";
import { createRequire } from "node:module";
const yaml = createRequire(import.meta.url)("yaml");
import {
  cacheKey,
  cachePaths,
  defaultBootstrapEnvironment,
  context,
  hash,
  latestLts,
  ownedRef,
  verifyCustody,
  versions,
} from "./vp-bootstrap-diagnostic.mjs";

const env = {
  GITHUB_EVENT_NAME: "workflow_dispatch",
  VIZE_DIAG_REQUESTED: "true",
  GITHUB_REF: ownedRef,
  RUNNER_OS: "Linux",
  RUNNER_ARCH: "X64",
  GITHUB_SHA: "a".repeat(40),
  GITHUB_RUN_ID: "123456",
  GITHUB_RUN_ATTEMPT: "1",
  GITHUB_REPOSITORY: "ubugeeei-prod/vize",
};
const identity = context(env, "x64");
const workflow = readFileSync(
  new URL("../../../../.github/workflows/check.yml", import.meta.url),
  "utf8",
);
const action = readFileSync(
  new URL("../../../../.github/actions/diagnose-vp-bootstrap/action.yml", import.meta.url),
  "utf8",
);
const originalProjectionSha = "7f641f4d3abc74b9f5db4a89cfdccecd9703fd88912a2090c1d7e67514473a4f";
const diagnosticWorkflow = readFileSync(
  new URL("../../../../.github/workflows/vp-bootstrap-diagnostic.yml", import.meta.url),
  "utf8",
);
function jobBlocks(source) {
  return [
    ...source
      .slice(source.indexOf("jobs:\n") + 6)
      .matchAll(/^  ([a-z][a-z0-9-]*):\n([\s\S]*?)(?=^  [a-z][a-z0-9-]*:\n|$(?![\s\S]))/gm),
  ].map((match) => ({ name: match[1], text: match[0] }));
}

void test("manual opt-in and owned branch fail closed for other events, refs and images", () => {
  for (const event of [
    "push",
    "pull_request",
    "pull_request_target",
    "merge_group",
    "schedule",
    "workflow_run",
  ]) {
    assert.throws(() => context({ ...env, GITHUB_EVENT_NAME: event }, "x64"));
  }
  for (const ref of ["refs/heads/main", "refs/pull/1/merge", "refs/heads/ci/other"]) {
    assert.throws(() => context({ ...env, GITHUB_REF: ref }, "x64"));
  }
  for (const patch of [
    { VIZE_DIAG_REQUESTED: "false" },
    { GITHUB_RUN_ID: "" },
    { GITHUB_SHA: "unknown" },
    { RUNNER_OS: "Darwin" },
    { RUNNER_ARCH: "ARM64" },
  ])
    assert.throws(() => context({ ...env, ...patch }, "x64"));
});

void test("latest LTS is the highest stable LTS, not newest non-LTS or first entry", () => {
  assert.equal(
    latestLts([
      { version: "v26.9.0", lts: false },
      { version: "v24.9.0", lts: "Krypton" },
      { version: "v24.15.0", lts: "Krypton" },
      { version: "v22.99.0", lts: "Jod" },
    ]),
    "24.15.0",
  );
  assert.throws(() => latestLts([{ version: "v26.1.0", lts: false }]));
});

void test("cache key separates run, attempt, source, arch and bootstrap versions", () => {
  const key = cacheKey(identity, "24.15.0");
  assert(key.length < 512);
  for (const name of ["run", "attempt", "sha", "arch"]) {
    assert.notEqual(
      cacheKey({ ...identity, [name]: name === "arch" ? "arm64" : "b" }, "24.15.0"),
      key,
    );
  }
  assert.notEqual(cacheKey(identity, "24.16.0"), key);
  for (const value of Object.values(versions)) assert(key.includes(value));
  assert.throws(() =>
    cacheKey({ ...identity, versions: { ...versions, vp: "latest" } }, "24.15.0"),
  );
  assert.throws(() => cacheKey(identity, "../../other"));
});

void test("snapshot contains only exact Node and bootstrap pnpm install directories", () => {
  assert.deepEqual(cachePaths("/home/runner", "24.15.0"), [
    "/home/runner/.vite-plus/js_runtime/node/24.15.0",
    "/home/runner/.vite-plus/js_runtime/node/24.14.0",
    "/home/runner/.vite-plus/package_manager/pnpm/10.33.0",
  ]);
  assert.equal(cachePaths("/home/runner", "24.14.0").length, 2);
});

void test("warm custody rejects different source, run, version, key and artifact digest", () => {
  const sources = { "package.json": "source-digest" };
  const cold = { identity, sources, bootstrapLts: "24.15.0", key: cacheKey(identity, "24.15.0") };
  const digest = hash(JSON.stringify(cold));
  verifyCustody(cold, identity, sources, cold.key, digest);
  assert.throws(() =>
    verifyCustody(cold, { ...identity, attempt: "2" }, sources, cold.key, digest),
  );
  assert.throws(() =>
    verifyCustody(cold, identity, { "package.json": "changed" }, cold.key, digest),
  );
  assert.throws(() => verifyCustody(cold, identity, sources, cold.key + "other", digest));
  assert.throws(() => verifyCustody(cold, identity, sources, cold.key, "0".repeat(64)));
  assert.throws(() =>
    verifyCustody({ ...cold, bootstrapLts: "24.16.0" }, identity, sources, cold.key, digest),
  );
});

void test("all original full Check jobs, events, conditions, needs and commands remain exact", () => {
  const input =
    "      vp-bootstrap-diagnostic:\n        description: Add isolated cold/warm Vite+ diagnostics on the owned branch; full Check still runs\n        type: boolean\n        default: false\n";
  assert(workflow.includes(input));
  let original = workflow.replace(input, "");
  const diagnostics = jobBlocks(workflow).filter((job) => job.name === "vp-bootstrap-diagnostic");
  assert.equal(diagnostics.length, 1);
  for (const job of diagnostics) original = original.replace(job.text, "");
  const projected = yaml.parse(original);
  const originalText = original
    .split("\n")
    .filter((line) => line.trim() && !/^ {0,8}#/.test(line))
    .join("\n");
  assert.equal(
    hash(originalText),
    "430e386170ad88a4ec30b48e41f2cc7194036a85b9a1a534ff3e1a86f5064b9b",
    "original non-comment source and command bytes changed",
  );
  assert.equal(
    hash(JSON.stringify(projected)),
    originalProjectionSha,
    "original complete Check YAML projection changed",
  );
  assert.equal(workflow.split("\n").length, 691, "existing Check line budget grew");
});

void test("diagnostic graph requires ownership, cold custody and completed raw SDK logs", () => {
  const jobs = Object.fromEntries(jobBlocks(diagnosticWorkflow).map((job) => [job.name, job.text]));
  assert.match(jobs["vp-bootstrap-diagnostic-guard"], /inputs\.requested && 'true' \|\| 'false'/);
  assert.match(jobs["vp-bootstrap-diagnostic-guard"], /vp-bootstrap-diagnostic\.mjs guard/);
  assert.match(
    workflow,
    /github\.event_name == 'workflow_dispatch' && inputs\.vp-bootstrap-diagnostic/,
  );
  assert.match(jobs["vp-bootstrap-diagnostic-cold"], /needs: \[vp-bootstrap-diagnostic-guard\]/);
  assert.match(jobs["vp-bootstrap-diagnostic-warm"], /needs: \[vp-bootstrap-diagnostic-cold\]/);
  assert.match(
    jobs["vp-bootstrap-diagnostic-warm"],
    /cold-plan-hash: \$\{\{ needs\.vp-bootstrap-diagnostic-cold\.outputs\.plan-hash \}\}/,
  );
  assert.match(
    jobs["vp-bootstrap-diagnostic-report"],
    /always\(\) && needs\.vp-bootstrap-diagnostic-guard\.result == 'success'/,
  );
  assert.match(jobs["vp-bootstrap-diagnostic-report"], /vp-bootstrap-diagnostic\.mjs logs/);
});

void test("real SDK install uses no production stores, fallbacks or mutable mounts", () => {
  assert.match(action, /version: "1\.1\.0"\n        node-version-file: package\.json/);
  assert.match(action, /cache: false\n        run-install: true/);
  const setup = yaml
    .parse(action)
    .runs.steps.find((step) => step.uses?.startsWith("voidzero-dev/setup-vp@"));
  assert.deepEqual(setup.env, { VP_HOME: "${{ steps.plan.outputs.vp-home }}" });
  assert.match(action, /digest-mismatch: error/);
  assert.match(action, /lookup-only: \$\{\{ inputs\.lane == 'cold' \}\}/);
  assert.match(
    action,
    /name: Save only exact cold installed-runtime directories\n      if: \$\{\{ inputs\.lane == 'cold' \}\}/,
  );
  for (const forbidden of [
    "restore-keys:",
    "stickydisk",
    "node_modules",
    "actions/cache@",
    "VP_NODE_SKIP_SIGNATURE_VERIFY",
  ]) {
    assert(!action.includes(forbidden));
  }
});

void test("bootstrap keeps default logging and dependency preparation in both lanes", () => {
  defaultBootstrapEnvironment({});
  for (const name of ["VP_LOG", "VP_SKIP_DEPS_INSTALL", "VP_NODE_MANAGER", "VP_PM_MANAGER"]) {
    for (const value of ["debug", "yes", "no", ""]) {
      assert.throws(() => defaultBootstrapEnvironment({ [name]: value }), new RegExp(name));
    }
  }
});

void test("failed cold and skipped warm retain complete comparison and raw cold evidence", async () => {
  const scratch = mkdtempSync(join(tmpdir(), "vize-vp-diagnostic-test-"));
  const values = {
    ...env,
    RUNNER_ARCH: process.arch === "x64" ? "X64" : "ARM64",
    RUNNER_TEMP: scratch,
  };
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  const originalFetch = globalThis.fetch;
  try {
    Object.assign(process.env, values);
    globalThis.fetch = async (url) =>
      (typeof url === "string" ? url : url instanceof URL ? url.href : url.url).includes("/jobs?")
        ? Response.json({
            total_count: 2,
            jobs: [
              {
                id: 1,
                name: "Vite+ bootstrap diagnostic / Vite+ bootstrap diagnostic (cold)",
                conclusion: "failure",
                steps: [],
              },
              {
                id: 2,
                name: "Vite+ bootstrap diagnostic / Vite+ bootstrap diagnostic (warm)",
                conclusion: "skipped",
                steps: [],
              },
            ],
          })
        : new Response("2026-10-13T03:49:51.2003689Z partial cold SDK log\n");
    await assert.rejects(collectLogs(), /diagnostic incomplete/);
    const result = JSON.parse(
      readFileSync(join(scratch, "vp-bootstrap-report/comparison.json"), "utf8"),
    );
    assert.equal(result.identity.run, env.GITHUB_RUN_ID);
    assert.equal(result.lanes.cold.conclusion, "failure");
    assert.equal(result.lanes.warm.conclusion, "skipped");
    assert.equal(result.errors.length, 2);
    assert.match(
      readFileSync(join(scratch, "vp-bootstrap-report/cold.job.raw.log"), "utf8"),
      /partial cold SDK log/,
    );
    globalThis.fetch = async () => new Response("unavailable", { status: 503 });
    await assert.rejects(collectLogs(), /diagnostic incomplete/);
    assert.match(
      readFileSync(join(scratch, "vp-bootstrap-report/comparison.json"), "utf8"),
      /metadata request failed: 503/,
    );
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(scratch, { recursive: true });
  }
});
