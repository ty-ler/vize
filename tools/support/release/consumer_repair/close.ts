/** Explicit second official action, after reviewed composite authority is approved.
 * The only writes are one durable own-source intent comment and state=closed.
 * No release dispatch, tag/source rewrite, publication, or automatic retry. */
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { captureIo } from "./io.ts";
import {
  object,
  repair457,
  verifyOperator,
  verifyOriginalJobs,
  verifyOriginalRun,
  verifyTuple,
  type ObjectValue,
} from "./contract.ts";
import { closureIntent, requireClosureMutation, verifyFrozenCustody } from "./closure-contract.ts";
import {
  derivePublicationPlan,
  readRawBlob,
  type PublicationPlan,
} from "../public_acceptance/plan.ts";
import { verifyPublication } from "../public_acceptance/registry.ts";
import { publicReader } from "../public_acceptance/http.ts";
import { verifyAdditionalPublicProof } from "./public-proof.ts";

const output = resolve(process.env.RUNNER_TEMP!, "release-457-composite-acceptance");
mkdirSync(output, { recursive: false });
const { api, command, json } = captureIo(output);
verifyTuple({
  sourcePr: process.env.RELEASE_SOURCE_PR,
  head: process.env.RELEASE_SOURCE_HEAD,
  tag: process.env.RELEASE_SOURCE_TAG,
  run: process.env.RELEASE_RUN,
  cut: repair457.cut,
});
assert.equal(process.env.RELEASE_OPERATION, "accept-consumer-repair");
assert.equal(process.env.RELEASE_SOURCE_CUT, "");
assert.equal(process.env.RELEASE_ORIGINAL_OPERATOR_RUN, "");
assert.equal(process.env.GITHUB_REPOSITORY, repair457.repository);
assert.equal(process.env.GITHUB_REF, "refs/heads/main");
assert.match(process.env.RELEASE_CONSUMER_OPERATOR_RUN!, /^[1-9][0-9]*$/);
const supplementalRun = Number(process.env.RELEASE_CONSUMER_OPERATOR_RUN);
assert.ok(Number.isSafeInteger(supplementalRun));
const policyHead = process.env.RELEASE_CONSUMER_POLICY_SHA!;
assert.match(policyHead, /^[0-9a-f]{40}$/);
const ownRun = Number(process.env.GITHUB_RUN_ID);
assert.ok(Number.isSafeInteger(ownRun) && ownRun > 0 && ownRun !== supplementalRun);
const base = `repos/${repair457.repository}`;
verifyOperator(await api(`${base}/actions/runs/${ownRun}`), process.env.GITHUB_SHA!, false);
const user = await api("user");
assert.equal(user.type, "User");
assert.equal(user.id, repair457.maintainerId);
assert.equal(user.login, repair457.maintainer);
assert.equal(process.env.GITHUB_ACTOR, user.login);
assert.equal(process.env.GITHUB_TRIGGERING_ACTOR, user.login);
const permission = await api(`${base}/collaborators/${repair457.maintainer}/permission`);
assert.ok(permission.role_name === "admin" || permission.role_name === "maintain");
assert.equal(
  (await command("policy-head", "git", ["rev-parse", "HEAD"])).toString().trim(),
  process.env.GITHUB_SHA,
);

async function pages(path: string, key?: string) {
  const rows: ObjectValue[] = [];
  for (let page = 1; page <= 30; page++) {
    const response = await api(
      `${base}/${path}${path.includes("?") ? "&" : "?"}per_page=100&page=${page}`,
    );
    const items = key ? response[key] : response;
    assert.ok(Array.isArray(items));
    rows.push(...(items as ObjectValue[]));
    if (items.length < 100) return rows;
  }
  throw new Error("complete bounded API inventory required");
}
async function noOtherOwner() {
  const operators = await pages("actions/workflows/release-operator.yml/runs", "workflow_runs");
  assert.deepEqual(
    operators.filter((run) => run.status !== "completed" && run.id !== ownRun),
    [],
    "another operator owns release work",
  );
  const releases = await pages("actions/workflows/release.yml/runs", "workflow_runs");
  assert.deepEqual(
    releases.filter((run) => run.status !== "completed"),
    [],
    "Release is still active",
  );
  assert.deepEqual(
    await pages("git/matching-refs/heads/release-operator/"),
    [],
    "a durable operator lease remains; never steal it",
  );
}
async function snapshot() {
  const paths = {
    source: "pulls/9196",
    sourceBranch: "git/ref/heads/release/v0.457.0",
    tagRef: "git/ref/tags/v0.457.0",
    tag: `git/tags/${repair457.tagObject}`,
    head: `git/commits/${repair457.head}`,
    integration: "pulls/9197",
    delivery: "git/commits/b4be3b70977b80a689c8e5ada62d05283e86b868",
    pin: "git/ref/heads/release-pin/v0.457.0",
    release: "releases/tags/v0.457.0",
  };
  const values: Record<string, ObjectValue> = {};
  for (const [name, path] of Object.entries(paths)) values[name] = await api(`${base}/${path}`);
  values.pinCommit = await api(`${base}/git/commits/${String(object(values.pin!.object).sha)}`);
  verifyFrozenCustody(values);
  const run = await api(`${base}/actions/runs/${repair457.run}`);
  verifyOriginalRun(run);
  const jobs = await api(`${base}/actions/runs/${repair457.run}/jobs?filter=latest&per_page=100`);
  assert.equal(jobs.total_count, 56);
  assert.ok(Array.isArray(jobs.jobs));
  verifyOriginalJobs(jobs.jobs as ObjectValue[]);
  const main = await api(`${base}/commits/main`),
    mainHead = String(main.sha);
  assert.match(mainHead, /^[0-9a-f]{40}$/);
  await command("fetch-main", "git", ["fetch", "--no-tags", "origin", mainHead]);
  const ancestry = await api(
    `${base}/compare/b4be3b70977b80a689c8e5ada62d05283e86b868...${mainHead}?per_page=1`,
  );
  assert.equal(object(ancestry.merge_base_commit).sha, "b4be3b70977b80a689c8e5ada62d05283e86b868");
  return { values, run, jobs, mainHead };
}
function catalogShape(plan: PublicationPlan) {
  return {
    version: plan.version,
    npm: [...plan.npm].sort((a, b) => a.name.localeCompare(b.name)),
    crates: [...plan.crates].sort((a, b) => a.name.localeCompare(b.name)),
    editor: plan.editor,
    githubAssets: [...plan.githubAssets].sort(),
  };
}
function sameCatalog(mainHead: string, original: PublicationPlan) {
  assert.deepEqual(
    catalogShape(derivePublicationPlan(process.cwd(), mainHead)),
    catalogShape(original),
    "main shipping catalog/version changed",
  );
  for (const path of ["jsr/vize/jsr.json", "jsr/vize/channel.json"])
    assert.deepEqual(
      readRawBlob(process.cwd(), mainHead, path),
      readRawBlob(process.cwd(), repair457.head, path),
      `JSR catalog changed: ${path}`,
    );
  const native = (head: string) =>
    object(JSON.parse(readRawBlob(process.cwd(), head, "npm/native/package.json").toString()));
  assert.deepEqual(
    object(native(mainHead).napi).targets,
    object(native(repair457.head).napi).targets,
  );
}
await noOtherOwner();
const before = await snapshot();
json("before", before);
const plan = derivePublicationPlan(process.cwd(), repair457.head);
assert.equal(plan.parentCut, repair457.cut);
assert.equal(plan.version, "0.457.0");
sameCatalog(before.mainHead, plan);
const publicProof = await verifyPublication(plan, {
  sourcePr: 9196,
  cut: repair457.cut,
  head: repair457.head,
  tag: repair457.tag,
  run: repair457.run,
  consumerRepair: { run: supplementalRun, policyHead },
});
json("public-publication", publicProof);
const extra = await verifyAdditionalPublicProof(
  plan,
  before.values.release!,
  (path) => readRawBlob(process.cwd(), repair457.head, path),
  publicReader(),
);
json("public-additional", extra);
const after = await snapshot();
json("after", after);
sameCatalog(after.mainHead, plan);
for (const key of ["tagRef", "tag", "pin", "pinCommit"])
  assert.deepEqual(after.values[key], before.values[key]);
assert.equal(after.values.source!.body, before.values.source!.body);
await noOtherOwner();
const comments = await pages("issues/9196/comments");
assert.deepEqual(
  comments.filter((comment) => String(comment.body).includes("<!-- vize-457-composite-close:")),
  [],
  "an earlier durable close intent exists; inspect it instead of retrying",
);
const intent = closureIntent(ownRun, supplementalRun, policyHead);
async function mutate(name: string, method: string, path: string, payload: unknown) {
  requireClosureMutation(method, path, payload, intent);
  json(`${name}-intent`, {
    method,
    path,
    payload,
    originalReleaseConclusion: "failure",
    supplementalRun,
    policyHead,
  });
  // One attempt. Complete failure streams remain retained; never blind-replay.
  const bytes = await command(
    name,
    "gh",
    ["api", `${base}/${path}`, "--method", method, "--input", "-"],
    undefined,
    undefined,
    JSON.stringify(payload),
  );
  return JSON.parse(bytes.toString()) as ObjectValue;
}
const comment = await mutate("durable-close-intent", "POST", "issues/9196/comments", {
  body: intent,
});
assert.equal(comment.body, intent);
assert.equal(object(comment.user).login, repair457.maintainer);
assert.equal(object(comment.user).id, repair457.maintainerId);
// Reauthenticate the exact immutable receipt after creating the durable intent.
const final = await snapshot();
json("before-close", final);
sameCatalog(final.mainHead, plan);
await noOtherOwner();
const closed = await mutate("close-source", "PATCH", "pulls/9196", { state: "closed" });
assert.equal(closed.number, 9196);
assert.equal(closed.state, "closed");
assert.equal(closed.merged, false);
assert.equal(closed.draft, true);
assert.equal(object(closed.head).sha, repair457.head);
json("accepted-composite", {
  schema: "vize-457-composite-acceptance-v1",
  originalReleaseConclusion: "failure",
  originalRun: repair457.run,
  supplementalRun,
  supplementalPolicyHead: policyHead,
  acceptingOperatorRun: ownRun,
  source: closed,
  comment,
  publicProof,
  extra,
  permittedMutations: ["POST issues/9196/comments", "PATCH pulls/9196 state=closed"],
  nextStep:
    "A separate ordinary official start may now evaluate its normal guards. This operation never dispatches a next version.",
});
console.log(
  "Closed only unchanged unmerged source #9196 after composite public verification. Original Release remains failed. No next cut dispatched.",
);
