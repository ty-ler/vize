import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export type ObjectValue = Record<string, unknown>;
export const repair457 = Object.freeze({
  repository: "ubugeeei-prod/vize",
  sourcePr: 9196,
  cut: "014bd42cacdf3d026fb75162cfa80dce76d78315",
  head: "03882089eff75664abe99ba71868e33739496b01",
  tag: "v0.457.0",
  tagObject: "46536212e8e1a16492f9e196d84908286170d57b",
  run: 38805261385,
  attempt: 4,
  failedJob: 117254411511,
  failedJobName: "Release @vizejs/vize to JSR / JSR consumer (deno, ubuntu-24.04)",
  failedLogSha256: "df3ec6ea97cd47a655a0fd46528a4e28f24ae3aac6fa256ff8b7e23a8e778860",
  consumerSha256: "410be5021e5c1bff706191bf68045ddbc2edbaa47b13325ddde3daa22926851c",
  maintainer: "ubugeeei",
  maintainerId: 71201308,
  // No age override or exclusion: retain Deno 2.9.7's default 24-hour policy.
  config: '{\n  "nodeModulesDir": "none"\n}\n',
  authorizationJobName: "Authorize the supplemental Deno consumer",
  jobName: "Verify the supplemental Deno consumer",
  artifactName: "release-457-consumer-repair",
});

export const policyPaths = [
  ".github/workflows/release-operator.yml",
  "tools/support/release/consumer_repair/contract.ts",
  "tools/support/release/consumer_repair/capture.ts",
  "tools/support/release/consumer_repair/io.ts",
  "tools/support/release/consumer_repair/fixture.ts",
  "tools/support/release/consumer_repair/original-457-jobs.json",
  "tools/support/release/consumer_repair/verify.ts",
  "tools/support/release/consumer_repair/close.ts",
  "tools/support/release/consumer_repair/closure-contract.ts",
  "tools/support/release/consumer_repair/public-proof.ts",
  "tools/support/release/public_acceptance/github.ts",
  "tools/support/release/public_acceptance/registry.ts",
  "tools/support/release/public_acceptance/plan.ts",
  "tools/support/release/public_acceptance/http.ts",
] as const;
const originalJobs = JSON.parse(
  readFileSync(new URL("./original-457-jobs.json", import.meta.url), "utf8"),
) as ObjectValue[];
const jobKeys = ["id", "name", "run_id", "run_attempt", "head_sha", "status", "conclusion"];
export const sha256 = (bytes: Uint8Array | string) =>
  createHash("sha256").update(bytes).digest("hex");
export function object(value: unknown): ObjectValue {
  assert.ok(value && typeof value === "object" && !Array.isArray(value), "object required");
  return value as ObjectValue;
}
export function verifyTuple(options: ObjectValue) {
  for (const key of ["sourcePr", "cut", "head", "tag", "run"] as const) {
    assert.equal(String(options[key]), String(repair457[key]), `consumer repair ${key} mismatch`);
  }
}
export function verifyOriginalRun(run: ObjectValue) {
  assert.equal(run.id, repair457.run);
  assert.equal(object(run.repository).full_name, repair457.repository);
  assert.equal(object(run.head_repository).full_name, repair457.repository);
  assert.equal(run.head_sha, repair457.head);
  assert.equal(run.head_branch, `release/${repair457.tag}`);
  assert.equal(run.path, ".github/workflows/release.yml");
  assert.equal(run.event, "workflow_dispatch");
  assert.equal(run.display_title, `Pinned Release ${repair457.tag} PR #9196 @ ${repair457.head}`);
  assert.equal(run.status, "completed");
  assert.equal(run.conclusion, "failure", "original R must remain a failed run");
  assert.equal(run.run_attempt, repair457.attempt, "a newer original attempt needs a new review");
}
export function verifyOriginalJobs(jobs: ObjectValue[]) {
  const project = (rows: ObjectValue[]) =>
    rows
      .map((job) => Object.fromEntries(jobKeys.map((key) => [key, job[key]])))
      .sort((a, b) => Number(a.id) - Number(b.id));
  assert.deepEqual(
    project(jobs),
    project(originalJobs),
    "the complete original 56-job packet changed",
  );
}
export function verifyOriginalLog(bytes: Uint8Array) {
  assert.equal(sha256(bytes), repair457.failedLogSha256, "original Deno failure log changed");
}
export function verifyOperator(run: ObjectValue, policyHead: string, terminal: boolean) {
  assert.match(policyHead, /^[0-9a-f]{40}$/);
  assert.ok(Number.isSafeInteger(run.id) && Number(run.id) > 0);
  assert.equal(object(run.repository).full_name, repair457.repository);
  assert.equal(object(run.head_repository).full_name, repair457.repository);
  assert.equal(run.path, ".github/workflows/release-operator.yml");
  assert.equal(run.event, "workflow_dispatch");
  assert.equal(run.head_branch, "main");
  assert.equal(run.head_sha, policyHead);
  assert.equal(run.run_attempt, 1, "supplements cannot mix rerun attempts");
  for (const name of ["actor", "triggering_actor"]) {
    const actor = object(run[name]);
    assert.equal(actor.login, repair457.maintainer);
    assert.equal(actor.id, repair457.maintainerId);
    assert.equal(actor.type, "User");
  }
  assert.equal(run.status, terminal ? "completed" : "in_progress");
  assert.equal(run.conclusion, terminal ? "success" : null);
}
export function verifyOperatorJobs(jobs: ObjectValue[], runId: number, policyHead: string) {
  assert.equal(jobs.length, 2);
  assert.deepEqual(
    jobs.map((job) => job.name).sort((a, b) => String(a).localeCompare(String(b))),
    [repair457.authorizationJobName, repair457.jobName].sort((a, b) => a.localeCompare(b)),
  );
  assert.equal(new Set(jobs.map((job) => job.id)).size, 2);
  for (const job of jobs) {
    assert.equal(job.run_id, runId);
    assert.equal(job.run_attempt, 1);
    assert.equal(job.head_sha, policyHead);
    assert.equal(job.status, "completed");
    assert.equal(job.conclusion, "success");
  }
}
