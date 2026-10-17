import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { parse } from "yaml";
import {
  assertEntry,
  assertFacade,
  assertHistory,
  assertOriginal,
  assertPolicy,
  capturedOriginal,
  consumerEnvironment,
  digest,
  identity,
  type Original,
} from "../../../tools/commands/release/verify-published-0.457.0.ts";

test("captured publication refuses a newer attempt, different failures, omitted gates, changed artifacts and logs", () => {
  const original = capturedOriginal();
  assertOriginal(original);
  for (const change of [
    (v: Original) => {
      v.run.run_attempt++;
    },
    (v: Original) => {
      v.run.head_sha = "a".repeat(40);
    },
    (v: Original) => {
      v.run.conclusion = "success";
    },
    (v: Original) => {
      v.run.head_repository.full_name = "foreign/vize";
    },
    (v: Original) => {
      v.jobs[0].conclusion = "failure";
    },
    (v: Original) => {
      v.jobs[0].conclusion = "skipped";
    },
    (v: Original) => {
      v.jobs.pop();
    },
    (v: Original) => {
      v.jobs.push(v.jobs[0]);
    },
    (v: Original) => {
      v.jobs[0].run_attempt++;
    },
    (v: Original) => {
      v.jobs[0].steps[0].conclusion = "failure";
    },
    (v: Original) => {
      v.artifacts.pop();
    },
    (v: Original) => {
      v.artifacts[0].expired = true;
    },
    (v: Original) => {
      v.artifacts[0].digest = `sha256:${"0".repeat(64)}`;
    },
    (v: Original) => {
      v.artifacts[0].workflow_run.head_sha = "a".repeat(40);
    },
    (v: Original) => {
      v.failureLog = v.failureLog.replace("blocked by", "allowed by");
    },
  ]) {
    const value = structuredClone(original);
    change(value);
    assert.throws(() => assertOriginal(value));
  }
  // A repository profile update during unrelated main pushes is not an R mutation.
  const profile = structuredClone(original);
  Object.assign(profile.run.repository, { pushed_at: "later unrelated main push" });
  assertOriginal(profile);
});

test("the historical supplement cannot substitute H, C, pin, tag, integration or the original catalog", () => {
  const valid = { schema: "vize-published-history-v1", identity, catalog: { npm: {} } };
  assertHistory(valid);
  for (const key of [
    "head",
    "cut",
    "pin",
    "tagObject",
    "integrationMerge",
    "protectedCandidate",
  ] as const) {
    const changed = structuredClone(valid);
    // The deliberate mutation is an unknown historical identity, not a fixture update.
    Object.assign(changed.identity, { [key]: "a".repeat(40) });
    assert.throws(() => assertHistory(changed), key);
  }
  assert.throws(() => assertHistory({ ...valid, catalog: {} }));
});

test("fresh owned versions do not exempt external dependencies or alter the consumer provider mode", () => {
  const config = JSON.parse(
    readFileSync(
      new URL("../../../tools/support/release/jsr/consumer-deno.json", import.meta.url),
      "utf8",
    ),
  );
  assertPolicy(config);
  for (const change of [
    (v: typeof config) => {
      v.minimumDependencyAge.age = 0;
    },
    (v: typeof config) => {
      v.minimumDependencyAge.exclude.push("npm:vue");
    },
    (v: typeof config) => {
      v.minimumDependencyAge.exclude.push("npm:@vizejs/*");
    },
    (v: typeof config) => {
      v.minimumDependencyAge.exclude.push(v.minimumDependencyAge.exclude[0]);
    },
    (v: typeof config) => {
      v.minimumDependencyAge.exclude.pop();
    },
    (v: typeof config) => {
      v.nodeModulesDir = "auto";
    },
    (v: typeof config) => {
      v.imports = { "jsr:@vizejs/vize": "./workspace.ts" };
    },
  ]) {
    const changed = structuredClone(config);
    change(changed);
    assert.throws(() => assertPolicy(changed));
  }
});

test("the real child process receives no workflow credentials, registry redirects or native overrides", () => {
  const directory = mkdtempSync(join(tmpdir(), "vize-consumer-env-"));
  try {
    const env = consumerEnvironment(directory, {
      ...process.env,
      GH_TOKEN: "private",
      GITHUB_TOKEN: "private",
      DENO_AUTH_TOKENS: "private",
      NODE_OPTIONS: "--require forbidden.js",
      NPM_CONFIG_REGISTRY: "https://foreign.invalid",
      VIZE_BINDING_PATH: "/workspace/forged.node",
      NAPI_RS_FORCE_WASI: "1",
    });
    const result = spawnSync(
      process.execPath,
      ["-e", "process.stdout.write(JSON.stringify(process.env))"],
      { env, encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);
    const observed = JSON.parse(result.stdout);
    for (const key of [
      "GH_TOKEN",
      "GITHUB_TOKEN",
      "DENO_AUTH_TOKENS",
      "NODE_OPTIONS",
      "NPM_CONFIG_REGISTRY",
      "VIZE_BINDING_PATH",
      "NAPI_RS_FORCE_WASI",
    ]) {
      assert.equal(observed[key], undefined, key);
    }
    assert.equal(observed.HOME, join(directory, "empty-home"));
    assert.equal(observed.DENO_DIR, join(directory, "empty-cache"));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("the original public facade cannot redirect to another version even with matching replacement metadata", () => {
  const original = Buffer.from(
    '/** Re-exports vize 0.457.0 from npm. */\nexport * from "npm:vize@0.457.0";\n',
  );
  const metadata = { checksum: `sha256-${digest(original)}`, size: original.length };
  assertFacade(original, original, metadata);
  const changed = Buffer.from(original.toString().replaceAll("0.457.0", "0.458.0"));
  assert.throws(() =>
    assertFacade(changed, original, {
      checksum: `sha256-${digest(changed)}`,
      size: changed.length,
    }),
  );
  assert.throws(() =>
    assertFacade(original, original, { ...metadata, checksum: `sha256-${"a".repeat(64)}` }),
  );
  assert.throws(() => assertFacade(original, original, { ...metadata, size: original.length + 1 }));
});

test("entry and workflow bind the exact main policy and keep publication authority out of the supplement", () => {
  const workflow = parse(
    readFileSync(
      new URL("../../../.github/workflows/release-published-0-457-consumer.yml", import.meta.url),
      "utf8",
    ),
  );
  assert.deepEqual(Object.keys(workflow.on), ["workflow_dispatch"]);
  assert.deepEqual(new Set(Object.values(workflow.permissions)), new Set(["read"]));
  assert.match(workflow.jobs.proof.if, /github\.ref == 'refs\/heads\/main'/);
  assert.equal(workflow.jobs.proof.steps[0].with.ref, "${{ github.workflow_sha }}");
  assert.equal(workflow.jobs.proof.steps[0].with["fetch-depth"], 0);
  assert.equal(workflow.jobs.proof.steps[0].with["persist-credentials"], false);
  const deno = workflow.jobs.proof.steps.find((s: { uses?: string }) =>
    s.uses?.startsWith("denoland/setup-deno@"),
  );
  assert.match(deno.uses, /@[0-9a-f]{40}$/);
  assert.equal(deno.with["deno-version"], "2.9.7");
  const retain = workflow.jobs.proof.steps.at(-1);
  assert.equal(retain.if, "always()");
  assert.equal(retain.with.name, "published-v0457-${{ github.run_id }}-${{ github.run_attempt }}");
  assert.equal(retain.with["if-no-files-found"], "error");
  const head = "a".repeat(40);
  const env = {
    GITHUB_REPOSITORY: identity.repository,
    GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_REF: "refs/heads/main",
    GITHUB_WORKFLOW_REF: `${identity.repository}/.github/workflows/release-published-0-457-consumer.yml@refs/heads/main`,
    GITHUB_WORKFLOW_SHA: head,
    GITHUB_SHA: head,
    GITHUB_RUN_ID: "123",
    GITHUB_RUN_ATTEMPT: "1",
  };
  assertEntry(env, head);
  for (const patch of [
    { GITHUB_REF: "refs/heads/fix/recovery" },
    { GITHUB_EVENT_NAME: "pull_request" },
    { GITHUB_REPOSITORY: "foreign/vize" },
    { GITHUB_WORKFLOW_SHA: identity.head },
    { GITHUB_RUN_ATTEMPT: "0" },
    { GITHUB_RUN_ID: "1;touch injected" },
    { NODE_OPTIONS: "--require hook.js" },
  ]) {
    assert.throws(() => assertEntry({ ...env, ...patch }, head));
  }
});
