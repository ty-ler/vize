import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { object, type Json } from "../../tools/support/release/consumer_recovery/policy.ts";
import {
  sameIntegrationSnapshot,
  sameOriginalSnapshot,
  sameRunSnapshot,
} from "../../tools/support/release/consumer_recovery/snapshots.ts";

const fixture = (name: string): Json =>
  JSON.parse(readFileSync(new URL(`../_fixtures/release/${name}.json`, import.meta.url), "utf8"));
const retained = fixture("consumer-recovery");
const delivery = fixture("consumer-recovery-integration");
type Route = (string | number)[];
function at(value: Json, route: Route): Json {
  let current: unknown = value;
  for (const key of route) current = (current as Record<string | number, unknown>)[key];
  return object(current);
}
function frozen(value: Json): Json {
  for (const child of Object.values(value))
    if (child && typeof child === "object") frozen(child as Json);
  return Object.freeze(value);
}
const before = { pushed_at: "2026-10-17T01:30:03Z", updated_at: "2026-10-17T01:25:44Z" };
const after = { pushed_at: "2026-10-17T01:34:38Z", updated_at: "2026-10-17T01:33:25Z" };
const run = structuredClone(object(retained.run));
for (const key of ["repository", "head_repository"]) Object.assign(object(run[key]), before);
const integration = structuredClone({
  integration: delivery.integration,
  merge: delivery.merge,
  gates: delivery.gates,
});
const repositories: Route[] = [
  ["integration", "head", "repo"],
  ["integration", "base", "repo"],
];
for (const [index, gate] of (object(integration.gates).workflow_runs as Json[]).entries()) {
  for (const key of ["repository", "head_repository"]) {
    gate[key] = structuredClone(run[key]);
    repositories.push(["gates", "workflow_runs", index, key]);
  }
}
for (const route of repositories) Object.assign(at(integration, route), before);

for (const [label, original, routes, compare] of [
  ["run", run, [["repository"], ["head_repository"]], sameRunSnapshot],
  ["integration", integration, repositories, sameIntegrationSnapshot],
] as const) {
  test(`${label} permits only repository clock values without changing either raw packet`, () => {
    const current = structuredClone(original);
    for (const route of routes) Object.assign(at(current, [...route]), after);
    assert.notDeepEqual(current, original, "the former raw comparison must reproduce failure");
    const rawBefore = [JSON.stringify(original), JSON.stringify(current)];
    compare(frozen(current), frozen(original), "repository clocks changed");
    assert.deepEqual([JSON.stringify(original), JSON.stringify(current)], rawBefore);
  });

  for (const route of routes) {
    test(`${label} keeps ${route.join(".")} field presence, type and other metadata exact`, () => {
      for (const field of ["pushed_at", "updated_at"]) {
        for (const replacement of [null, 123, {}, undefined]) {
          const current = structuredClone(original);
          const repository = at(current, [...route]);
          if (replacement === undefined) delete repository[field];
          else repository[field] = replacement;
          assert.throws(() => compare(current, original, "repository clock schema changed"));
        }
      }
      for (const [field, replacement] of [
        ["id", 1],
        ["full_name", "foreign/vize"],
        ["created_at", "2026-10-17T02:00:00Z"],
        ["default_branch", "other"],
        ["size", -1],
      ]) {
        const current = structuredClone(original);
        at(current, [...route])[String(field)] = replacement;
        assert.throws(() => compare(current, original, `repository ${field} changed`));
      }
    });
  }
}

const runChanges: [string, unknown][] = [
  ["id", 1],
  ["head_sha", "f".repeat(40)],
  ["run_attempt", 5],
  ["event", "push"],
  ["head_branch", "other"],
  ["path", ".github/workflows/other.yml"],
  ["status", "in_progress"],
  ["conclusion", "success"],
  ["updated_at", after.updated_at],
  ["pushed_at", after.pushed_at],
  ["created_at", after.updated_at],
];
for (const [field, value] of runChanges) {
  test(`original and recovery run comparisons refuse changed ${field}`, () => {
    const current = structuredClone(run);
    current[field] = value;
    assert.throws(() => sameRunSnapshot(current, run, "run changed"));
  });
}

const integrationChanges: [Route, unknown][] = [
  [["integration", "head", "sha"], "f".repeat(40)],
  [["integration", "base", "ref"], "other"],
  [["integration", "merge_commit_sha"], "f".repeat(40)],
  [["integration", "body"], "replacement release receipt"],
  [["integration", "updated_at"], after.updated_at],
  [["merge", "commit", "verification", "verified"], false],
  [["merge", "commit", "verification", "signature"], "replacement signature"],
  [["merge", "parents", 0, "sha"], "f".repeat(40)],
  [["gates", "workflow_runs", 0, "id"], 1],
  [["gates", "workflow_runs", 0, "head_sha"], "f".repeat(40)],
  [["gates", "workflow_runs", 0, "event"], "workflow_dispatch"],
  [["gates", "workflow_runs", 0, "run_attempt"], 2],
  [["gates", "workflow_runs", 0, "status"], "in_progress"],
  [["gates", "workflow_runs", 0, "conclusion"], "cancelled"],
  [["gates", "workflow_runs", 0, "updated_at"], after.updated_at],
  [["gates", "workflow_runs", 0, "actor"], { updated_at: after.updated_at }],
];
for (const [route, value] of integrationChanges) {
  test(`signed integration comparison refuses changed ${route.join(".")}`, () => {
    const current = structuredClone(integration);
    at(current, route.slice(0, -1))[route.at(-1)!] = value;
    assert.throws(() => sameIntegrationSnapshot(current, integration, "integration changed"));
  });
}

test("original custody still compares every retained proof, job, artifact and tag field", () => {
  const original: Json = {
    ...retained,
    run,
    policy: { sha: "a".repeat(40), authority: [{ file: "policy.ts", sha256: "a".repeat(64) }] },
    logIdentity: { sha256: "a".repeat(64), bytes: String(retained.log).length },
    artifacts: [{ id: 123, digest: `sha256:${"a".repeat(64)}`, expired: false }],
    pin: { tagRef: { object: { sha: "a".repeat(40) } }, tagObject: { message: "original" } },
    sourceReceipt: { body: "original", head: { sha: run.head_sha } },
  };
  const current = structuredClone(original);
  for (const field of ["repository", "head_repository"])
    Object.assign(object(object(current.run)[field]), after);
  sameOriginalSnapshot(current, original, "during fresh consumers");
  for (const field of [
    "policy",
    "jobs",
    "failed",
    "log",
    "logIdentity",
    "blobs",
    "artifacts",
    "pin",
    "sourceReceipt",
  ]) {
    const changed = structuredClone(current);
    changed[field] = { replaced: changed[field] };
    assert.throws(() => sameOriginalSnapshot(changed, original, "after requalification"), field);
  }
});

test("unrecognized repository-shaped data and nested clocks remain strict", () => {
  for (const original of [
    { ...run, extra: { repository: before } },
    { ...run, repository: { ...object(run.repository), owner: before } },
  ]) {
    const current: Json = structuredClone(original);
    if (Object.hasOwn(current, "extra"))
      Object.assign(object(object(current.extra).repository), after);
    else Object.assign(object(object(current.repository).owner), after);
    assert.throws(() => sameRunSnapshot(current, original, "unrecognized clock changed"));
  }
});
