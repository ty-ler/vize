import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  object,
  policyPaths,
  repair457,
  verifyOperator,
  verifyOperatorJobs,
  verifyOriginalRun,
  verifyTuple,
  type ObjectValue,
} from "./contract.ts";

export interface ConsumerRepairOptions {
  run: number;
  /** Exact reviewed main policy commit which executed the supplemental operator. */
  policyHead: string;
}

/** Explicit single-release composition, never a generic "accept failed Release" option. */
export async function verifyConsumerRepair(
  options: {
    sourcePr: string | number;
    cut: string;
    head: string;
    tag: string;
    run: string | number;
  },
  repair: ConsumerRepairOptions,
  originalRun: ObjectValue,
  json: (url: string) => Promise<ObjectValue>,
) {
  verifyTuple({ ...options });
  verifyOriginalRun(originalRun);
  assert.ok(Number.isSafeInteger(repair.run) && repair.run > 0 && repair.run !== repair457.run);
  assert.match(repair.policyHead, /^[0-9a-f]{40}$/);
  const base = `https://api.github.com/repos/${repair457.repository}`;
  const runUrl = `${base}/actions/runs/${repair.run}`;
  const run = await json(runUrl);
  verifyOperator(run, repair.policyHead, true);
  assert.equal(run.id, repair.run);
  const jobPage = await json(`${runUrl}/jobs?filter=latest&per_page=100`);
  assert.equal(jobPage.total_count, 2);
  assert.ok(Array.isArray(jobPage.jobs));
  verifyOperatorJobs(jobPage.jobs as ObjectValue[], repair.run, repair.policyHead);
  const commit = await json(`${base}/commits/${repair.policyHead}`);
  assert.equal(commit.sha, repair.policyHead);
  assert.equal(object(object(commit.commit).verification).verified, true);
  assert.equal(object(object(commit.commit).verification).reason, "valid");
  assert.ok(
    Array.isArray(commit.parents) && commit.parents.length === 1,
    "signed main merge required",
  );
  const ancestry = await json(`${base}/compare/${repair.policyHead}...main?per_page=1`);
  assert.equal(
    object(ancestry.merge_base_commit).sha,
    repair.policyHead,
    "reviewed policy is not on main",
  );
  // Match the executing trusted verifier's complete capture policy. A workflow at
  // another main SHA is insufficient if any consumed source byte differs.
  const policy = [];
  for (const path of policyPaths) {
    const expected = readFileSync(new URL(`../../../../${path}`, import.meta.url));
    const file = await json(`${base}/contents/${path}?ref=${repair.policyHead}`);
    assert.equal(file.path, path);
    assert.equal(file.type, "file");
    assert.equal(file.encoding, "base64");
    assert.equal(typeof file.content, "string");
    const bytes = Buffer.from(String(file.content), "base64");
    assert.deepEqual(bytes, expected, `supplemental policy differs: ${path}`);
    const blob = createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
    assert.equal(file.sha, blob);
    policy.push({ path, blob });
  }
  const artifacts = await json(`${runUrl}/artifacts?per_page=100`);
  assert.equal(artifacts.total_count, 1);
  assert.ok(Array.isArray(artifacts.artifacts) && artifacts.artifacts.length === 1);
  const artifact = object(artifacts.artifacts[0]);
  assert.equal(artifact.name, repair457.artifactName);
  assert.equal(artifact.expired, false);
  assert.ok(Number.isSafeInteger(artifact.id) && Number(artifact.id) > 0);
  assert.ok(Number.isSafeInteger(artifact.size_in_bytes) && Number(artifact.size_in_bytes) > 0);
  assert.match(String(artifact.digest), /^sha256:[0-9a-f]{64}$/);
  assert.equal(object(artifact.workflow_run).id, repair.run);
  assert.equal(object(artifact.workflow_run).head_sha, repair.policyHead);
  const final = await json(runUrl);
  verifyOperator(final, repair.policyHead, true);
  assert.equal(final.id, repair.run);
  return {
    schema: "vize-457-composite-consumer-v1",
    originalRelease: {
      run: repair457.run,
      attempt: 4,
      conclusion: "failure",
      failedJob: repair457.failedJob,
    },
    supplementalOperator: {
      run: repair.run,
      policyHead: repair.policyHead,
      conclusion: "success",
      policy,
      artifact,
    },
    scope:
      "Only the original failed Deno consumer is supplemented. Original R remains failure; every other original job and all ordinary public publication checks remain required.",
  };
}
