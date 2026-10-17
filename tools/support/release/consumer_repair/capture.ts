/** Read-only supplemental proof; never publishes, reruns, closes a PR, or writes a ref. */
import assert from "node:assert/strict";
import { mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { captureIo } from "./io.ts";
import { executeImmutableFixture } from "./fixture.ts";
import {
  object,
  policyPaths,
  repair457,
  sha256,
  verifyOperator,
  verifyOriginalJobs,
  verifyOriginalLog,
  verifyOriginalRun,
  verifyTuple,
  type ObjectValue,
} from "./contract.ts";

const output = resolve(process.env.RUNNER_TEMP!, "release-457-consumer-repair");
mkdirSync(output, { recursive: false });
const { json, command, api } = captureIo(output);
const base = `repos/${repair457.repository}`;
async function original() {
  const run = await api(`${base}/actions/runs/${repair457.run}`);
  verifyOriginalRun(run);
  const response = await api(
    `${base}/actions/runs/${repair457.run}/jobs?filter=latest&per_page=100`,
  );
  assert.equal(response.total_count, 56);
  assert.ok(Array.isArray(response.jobs));
  verifyOriginalJobs(response.jobs as ObjectValue[]);
  return { run, jobs: response.jobs };
}

verifyTuple({
  sourcePr: process.env.RELEASE_SOURCE_PR,
  head: process.env.RELEASE_SOURCE_HEAD,
  tag: process.env.RELEASE_SOURCE_TAG,
  run: process.env.RELEASE_RUN,
  cut: repair457.cut,
});
assert.equal(process.env.RELEASE_OPERATION, "consumer-repair");
assert.equal(process.env.RELEASE_ORIGINAL_OPERATOR_RUN, "");
assert.equal(process.env.RELEASE_SOURCE_CUT, "");
assert.equal(process.env.GITHUB_REPOSITORY, repair457.repository);
assert.equal(process.env.GITHUB_REF, "refs/heads/main");
assert.equal(process.env.GITHUB_ACTOR, repair457.maintainer);
assert.equal(process.env.GITHUB_TRIGGERING_ACTOR, repair457.maintainer);
const policyHead = process.env.GITHUB_SHA!;
assert.equal(
  (await command("policy-head", "git", ["rev-parse", "HEAD"])).toString().trim(),
  policyHead,
);
const operator = await api(`${base}/actions/runs/${process.env.GITHUB_RUN_ID}`);
verifyOperator(operator, policyHead, false);
assert.equal(String(operator.id), process.env.GITHUB_RUN_ID);
const authorization = await api(
  `${base}/actions/runs/${String(operator.id)}/jobs?filter=latest&per_page=100`,
);
assert.equal(authorization.total_count, 2);
assert.ok(Array.isArray(authorization.jobs));
const jobs = authorization.jobs as ObjectValue[];
assert.equal(
  jobs.filter(
    (job) =>
      job.name === repair457.authorizationJobName &&
      job.status === "completed" &&
      job.conclusion === "success",
  ).length,
  1,
);
assert.equal(
  jobs.filter((job) => job.name === repair457.jobName && job.status === "in_progress").length,
  1,
);

const before = await original();
const failureLog = await command("original-deno-log", "gh", [
  "api",
  "--allow-escape-sequences",
  `${base}/actions/jobs/${repair457.failedJob}/logs`,
]);
verifyOriginalLog(failureLog);
const tagRef = await api(`${base}/git/ref/tags/${repair457.tag}`);
assert.equal(object(tagRef.object).sha, repair457.tagObject);
assert.equal(object(tagRef.object).type, "tag");
const tag = await api(`${base}/git/tags/${repair457.tagObject}`);
assert.equal(object(tag.object).sha, repair457.head);
assert.equal(object(tag.object).type, "commit");
assert.equal(tag.tag, repair457.tag);
const source = await api(`${base}/pulls/${repair457.sourcePr}`);
assert.equal(source.state, "open");
assert.equal(source.draft, true);
assert.equal(source.merged, false);
assert.equal(source.merged_at, null);
assert.equal(object(source.head).sha, repair457.head);
assert.equal(object(source.head).ref, `release/${repair457.tag}`);
assert.equal(object(object(source.head).repo).full_name, repair457.repository);
assert.equal(object(source.base).ref, "main");
assert.equal(object(object(source.base).repo).full_name, repair457.repository);
const body = String(source.body);
for (const [name, value] of Object.entries({
  "vize-release-pin": "immutable-v1",
  "vize-release-pin-cut": repair457.cut,
  "vize-release-pin-head": repair457.head,
  "vize-release-integration": "9197",
})) {
  assert.equal(body.split(`<!-- ${name}: `).length, 2);
  assert.ok(body.includes(`<!-- ${name}: ${value} -->`));
}
const files = [];
for (const path of policyPaths) {
  const committed = await command("policy-file", "git", ["show", `${policyHead}:${path}`]);
  assert.deepEqual(committed, readFileSync(path), "policy checkout changed after dispatch");
  files.push({ path, sha256: sha256(committed) });
}
const consumer = await command("immutable-consumer", "git", [
  "show",
  `${repair457.head}:tools/support/release/jsr/consumer.ts`,
]);
assert.equal(sha256(consumer), repair457.consumerSha256);
const fixture = await executeImmutableFixture({ json, command, api }, consumer);
const after = await original();
// Both complete packets were revalidated against the immutable attempt-4 contract.
// Unrelated repository metadata may legitimately move while other work merges.
assert.deepEqual(
  await api(`${base}/git/ref/tags/${repair457.tag}`),
  tagRef,
  "immutable tag changed",
);
assert.deepEqual(
  await api(`${base}/git/tags/${repair457.tagObject}`),
  tag,
  "annotated tag changed",
);
const sourceAfter = await api(`${base}/pulls/${repair457.sourcePr}`);
for (const key of ["state", "draft", "merged", "merged_at", "body"])
  assert.deepEqual(sourceAfter[key], source[key]);
assert.equal(object(sourceAfter.head).sha, repair457.head);
assert.equal(object(sourceAfter.head).ref, `release/${repair457.tag}`);
assert.equal(object(object(sourceAfter.head).repo).full_name, repair457.repository);
json("accepted-consumer", {
  schema: "vize-457-consumer-repair-v1",
  originalReleaseConclusion: "failure",
  original: { ...repair457, config: undefined, before, after },
  operator,
  policyHead,
  files,
  fixture,
  success: true,
  permittedMutations: [],
  scope:
    "Supplemental Deno consumer only. No source closure, publication, version admission, or change to original Release status.",
});
console.log(
  "Supplemental immutable consumer passed; original Release remains failed. No publication or source closure performed.",
);
