import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { report } from "../../tools/support/compat/github/canonical-corpus-step-outage.mjs";
import { observers } from "../../tools/support/compat/github/canonical-corpus-identity.mjs";
import { selectCanonicalWorkers } from "../../tools/support/compat/github/canonical-corpus-workers.mjs";

const sha = "a".repeat(40);
const context = {
  repositoryId: 99,
  providerRepositoryId: 99,
  providerSha: sha,
  repository: "ubugeeei-prod/vize",
  runId: 12,
  attempt: 1,
  sha,
  event: "merge_group",
};
const run = {
  head_repository: { id: 99 },
  id: 12,
  run_attempt: 1,
  head_sha: sha,
  event: "merge_group",
  repository: { full_name: context.repository, id: 99 },
  path: ".github/workflows/check.yml",
};
// What the jobs API returned from 2026-10-13 21:15 UTC: complete jobs, no steps.
const stepless = observers.map((observer, index) => ({
  id: index + 1,
  run_id: 12,
  run_attempt: 1,
  head_sha: sha,
  name: `PR source checks / canonical-corpus / canonical observer (${observer})`,
  status: "completed",
  conclusion: "success",
  started_at: "2026-10-07T11:01:00Z",
  completed_at: "2026-10-07T11:05:00Z",
  runner_id: 8,
  labels: ["linux"],
  steps: [],
}));
const artifacts = observers.map((observer, index) => ({
  id: index + 101,
  name: `canonical-corpus-${observer}-12-1-${sha}`,
  size_in_bytes: 1000,
  expired: false,
  digest: `sha256:${"b".repeat(64)}`,
  created_at: "2026-10-07T11:03:00Z",
  workflow_run: { id: 12, head_sha: sha, repository_id: 99, head_repository_id: 99 },
}));
const select = (jobs = stepless, uploads = artifacts) =>
  selectCanonicalWorkers(context, run, jobs, uploads);

void test("an API that omits every step falls back to the job window and records it", () => {
  const selected = select();
  assert.deepEqual(
    selected.workers.map((worker) => [worker.artifactId, worker.stepEvidence]),
    [
      [101, "unavailable"],
      [102, "unavailable"],
      [103, "unavailable"],
    ],
  );
});

void test("partial step data, late uploads and failed observers still fail closed", () => {
  const reported = { ...stepless[0], id: 9, steps: [{ name: "Plan canonical corpus identity" }] };
  assert.throws(() => select([reported, ...stepless.slice(1)]));
  const late = artifacts.map((artifact) => ({ ...artifact, created_at: "2026-10-07T11:06:00Z" }));
  assert.throws(() => select(stepless, late), /upload window/);
  assert.throws(() => select([{ ...stepless[0], conclusion: "failure" }, ...stepless.slice(1)]));
});

void test("the fallback is written to the job summary, and a normal selection is not", () => {
  const summary = join(mkdtempSync(join(tmpdir(), "canonical-outage-")), "summary.md");
  const selected = select();
  assert.equal(report(selected, { GITHUB_STEP_SUMMARY: summary }), selected);
  assert.match(readFileSync(summary, "utf8"), /Canonical step evidence unavailable/);
  const normal = { workers: selected.workers.map(({ stepEvidence: _, ...worker }) => worker) };
  const quiet = join(mkdtempSync(join(tmpdir(), "canonical-outage-")), "summary.md");
  report(normal, { GITHUB_STEP_SUMMARY: quiet });
  assert.throws(() => readFileSync(quiet));
});
