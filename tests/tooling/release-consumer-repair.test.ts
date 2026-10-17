import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { gunzipSync } from "node:zlib";
import { parse } from "yaml";
import {
  object,
  policyPaths,
  repair457,
  verifyOperator,
  verifyOperatorJobs,
  verifyOriginalJobs,
  verifyOriginalLog,
  verifyOriginalRun,
  verifyTuple,
  type ObjectValue,
} from "../../tools/support/release/consumer_repair/contract.ts";
import { verifyConsumerRepair } from "../../tools/support/release/consumer_repair/verify.ts";
import { captureIo } from "../../tools/support/release/consumer_repair/io.ts";
import {
  closureIntent,
  requireClosureMutation,
  verifyFrozenCustody,
} from "../../tools/support/release/consumer_repair/closure-contract.ts";
import { verifyAdditionalPublicProof } from "../../tools/support/release/consumer_repair/public-proof.ts";
import type { PublicationPlan } from "../../tools/support/release/public_acceptance/plan.ts";
import { verifyGithub } from "../../tools/support/release/public_acceptance/github.ts";

const copy = <T>(value: T): T => structuredClone(value);
const policyHead = "b".repeat(40),
  operatorId = 987654321;
const originalJobs = JSON.parse(
  readFileSync(
    new URL("../../tools/support/release/consumer_repair/original-457-jobs.json", import.meta.url),
    "utf8",
  ),
) as ObjectValue[];
const actor = { login: "ubugeeei", id: 71201308, type: "User" };
function originalRun() {
  return {
    id: repair457.run,
    repository: { full_name: repair457.repository },
    head_repository: { full_name: repair457.repository },
    head_sha: repair457.head,
    head_branch: "release/v0.457.0",
    path: ".github/workflows/release.yml",
    event: "workflow_dispatch",
    display_title: `Pinned Release v0.457.0 PR #9196 @ ${repair457.head}`,
    status: "completed",
    conclusion: "failure",
    run_attempt: 4,
  };
}
function operator() {
  return {
    id: operatorId,
    repository: { full_name: repair457.repository },
    head_repository: { full_name: repair457.repository },
    head_sha: policyHead,
    head_branch: "main",
    path: ".github/workflows/release-operator.yml",
    event: "workflow_dispatch",
    actor,
    triggering_actor: actor,
    status: "completed",
    conclusion: "success",
    run_attempt: 1,
  };
}
function operatorJobs() {
  return [
    {
      id: 98,
      name: repair457.authorizationJobName,
      run_id: operatorId,
      run_attempt: 1,
      head_sha: policyHead,
      status: "completed",
      conclusion: "success",
    },
    {
      id: 99,
      name: repair457.jobName,
      run_id: operatorId,
      run_attempt: 1,
      head_sha: policyHead,
      status: "completed",
      conclusion: "success",
    },
  ];
}
const options = {
  sourcePr: 9196,
  cut: repair457.cut,
  head: repair457.head,
  tag: "v0.457.0",
  run: repair457.run,
};
function fixture() {
  const base = `https://api.github.com/repos/${repair457.repository}`;
  const runUrl = `${base}/actions/runs/${operatorId}`;
  const responses = new Map<string, ObjectValue>([
    [runUrl, operator()],
    [`${runUrl}/jobs?filter=latest&per_page=100`, { total_count: 2, jobs: operatorJobs() }],
    [
      `${base}/commits/${policyHead}`,
      {
        sha: policyHead,
        parents: [{ sha: "a".repeat(40) }],
        commit: { verification: { verified: true, reason: "valid" } },
      },
    ],
    [`${base}/compare/${policyHead}...main?per_page=1`, { merge_base_commit: { sha: policyHead } }],
    [
      `${runUrl}/artifacts?per_page=100`,
      {
        total_count: 1,
        artifacts: [
          {
            id: 12,
            name: repair457.artifactName,
            expired: false,
            size_in_bytes: 123,
            digest: `sha256:${"c".repeat(64)}`,
            workflow_run: { id: operatorId, head_sha: policyHead },
          },
        ],
      },
    ],
    [`${base}/actions/runs/${repair457.run}`, originalRun()],
    [
      `${base}/actions/runs/${repair457.run}/jobs?filter=latest&per_page=100&page=1`,
      { total_count: 56, jobs: originalJobs },
    ],
    [
      `${base}/git/ref/tags/v0.457.0`,
      { ref: "refs/tags/v0.457.0", object: { type: "tag", sha: repair457.tagObject } },
    ],
    [
      `${base}/git/tags/${repair457.tagObject}`,
      {
        sha: repair457.tagObject,
        tag: repair457.tag,
        object: { type: "commit", sha: repair457.head },
        message: `Release v0.457.0\nRelease-Mode: pinned\nRelease-PR: #9196\nValidated-run: ${repair457.run}\nValidated-head: ${repair457.head}\nValidated-base: ${repair457.cut}\n`,
      },
    ],
    [
      `${base}/pulls/9196`,
      {
        number: 9196,
        merged: false,
        merged_at: null,
        state: "open",
        head: {
          sha: repair457.head,
          ref: "release/v0.457.0",
          repo: { full_name: repair457.repository },
        },
        base: { ref: "main", repo: { full_name: repair457.repository } },
        body: `<!-- vize-release-pin: immutable-v1 -->\n<!-- vize-release-pin-cut: ${repair457.cut} -->\n<!-- vize-release-pin-head: ${repair457.head} -->\n<!-- vize-release-integration: 9197 -->`,
      },
    ],
    [
      `${base}/releases/tags/v0.457.0`,
      {
        id: 1,
        tag_name: "v0.457.0",
        draft: false,
        prerelease: false,
        published_at: "2026-10-15T21:45:00Z",
      },
    ],
  ]);
  for (const path of policyPaths) {
    const bytes = readFileSync(new URL(`../../${path}`, import.meta.url));
    const sha = createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
    responses.set(`${base}/contents/${path}?ref=${policyHead}`, {
      path,
      type: "file",
      encoding: "base64",
      content: bytes.toString("base64"),
      sha,
    });
  }
  let reads = 0;
  return {
    base,
    runUrl,
    responses,
    get reads() {
      return reads;
    },
    json: async (url: string) => {
      reads++;
      assert.ok(responses.has(url), `unexpected network route ${url}`);
      return copy(responses.get(url)!);
    },
  };
}

test("the complete original 56-job failure is retained and only its exact tuple is eligible", () => {
  verifyTuple({ ...options });
  verifyOriginalRun(originalRun());
  verifyOriginalJobs(originalJobs);
  assert.equal(originalJobs.length, 56);
  assert.deepEqual(
    originalJobs.filter((j) => j.conclusion === "failure").map((j) => j.id),
    [repair457.failedJob],
  );
  for (const [key, value] of Object.entries(options))
    assert.throws(() => verifyTuple({ ...options, [key]: `${value}-other` }));
  for (const [key, value] of Object.entries(originalRun())) {
    const bad = { ...originalRun(), [key]: typeof value === "object" ? {} : "changed" };
    assert.throws(() => verifyOriginalRun(bad), key);
  }
  for (const alter of [
    (rows: ObjectValue[]) => rows.pop(),
    (rows: ObjectValue[]) => rows.push(copy(rows[0]!)),
    (rows: ObjectValue[]) => {
      rows[0]!.conclusion = "failure";
    },
    (rows: ObjectValue[]) => {
      rows[0]!.conclusion = "skipped";
    },
    (rows: ObjectValue[]) => {
      rows[0]!.head_sha = policyHead;
    },
    (rows: ObjectValue[]) => {
      rows[0]!.run_attempt = 5;
    },
    (rows: ObjectValue[]) => {
      rows.find((j) => j.id === repair457.failedJob)!.conclusion = "success";
    },
  ]) {
    const rows = copy(originalJobs);
    alter(rows);
    assert.throws(() => verifyOriginalJobs(rows));
  }
});

test("the authentic whole attempt-4 failure log is required without substring classification", () => {
  const bytes = gunzipSync(
    readFileSync(new URL("./fixtures/release-457-deno-attempt4.log.gz", import.meta.url)),
  );
  verifyOriginalLog(bytes);
  assert.match(bytes.toString(), /Could not find a matching package for 'npm:vize@0\.457\.0'/);
  assert.throws(() => verifyOriginalLog(Buffer.concat([bytes, Buffer.from("different failure")])));
  assert.throws(() =>
    verifyOriginalLog(Buffer.from("Could not find a matching package for 'npm:vize@0.457.0'")),
  );
});

test("successful original publication remains mandatory unless the explicit narrow supplement is supplied", async () => {
  const f = fixture();
  await assert.rejects(verifyGithub(options, f.json), /terminal own-repository/);
  const proof = await verifyGithub(
    { ...options, consumerRepair: { run: operatorId, policyHead } },
    f.json,
  );
  assert.equal(proof.releaseRun.conclusion, "failure");
  assert.equal(proof.jobs.length, 56);
  assert.equal(proof.jobs.filter((j) => j.conclusion === "failure").length, 1);
  assert.equal(proof.consumerRepair?.schema, "vize-457-composite-consumer-v1");
});

test("the supplement requires a single successful protected owning operator and exact captured policy", async () => {
  const f = fixture();
  const good = await verifyConsumerRepair(
    options,
    { run: operatorId, policyHead },
    originalRun(),
    f.json,
  );
  assert.equal(good.originalRelease.conclusion, "failure");
  for (const key of [
    "path",
    "event",
    "head_branch",
    "head_sha",
    "run_attempt",
    "conclusion",
    "status",
    "actor",
    "triggering_actor",
  ]) {
    const bad = {
      ...operator(),
      [key]: key.includes("actor") ? { ...actor, login: "someone" } : "changed",
    };
    assert.throws(() => verifyOperator(bad, policyHead, true), key);
  }
  assert.throws(() => verifyOperatorJobs([], operatorId, policyHead));
  assert.throws(() =>
    verifyOperatorJobs([...operatorJobs(), ...operatorJobs()], operatorId, policyHead),
  );
  assert.throws(() =>
    verifyOperatorJobs(
      [{ ...operatorJobs()[0], name: "Run the official pinned release operator" }],
      operatorId,
      policyHead,
    ),
  );
  const changes: [string, (value: ObjectValue) => void][] = [
    [
      `${f.runUrl}/jobs?filter=latest&per_page=100`,
      (v) => {
        v.jobs = [];
      },
    ],
    [
      `${f.base}/commits/${policyHead}`,
      (v) => {
        object(object(v.commit).verification).verified = false;
      },
    ],
    [
      `${f.base}/compare/${policyHead}...main?per_page=1`,
      (v) => {
        object(v.merge_base_commit).sha = "a".repeat(40);
      },
    ],
    [
      `${f.base}/contents/${policyPaths[0]}?ref=${policyHead}`,
      (v) => {
        v.content = Buffer.from("foreign workflow").toString("base64");
      },
    ],
    [
      `${f.runUrl}/artifacts?per_page=100`,
      (v) => {
        object((v.artifacts as unknown[])[0]).expired = true;
      },
    ],
    [
      `${f.runUrl}/artifacts?per_page=100`,
      (v) => {
        object((v.artifacts as unknown[])[0]).digest = "unhashed";
      },
    ],
    [
      `${f.runUrl}/artifacts?per_page=100`,
      (v) => {
        v.total_count = 2;
      },
    ],
  ];
  for (const [url, alter] of changes) {
    const prior = copy(f.responses.get(url)!);
    const bad = copy(prior);
    alter(bad);
    f.responses.set(url, bad);
    await assert.rejects(
      verifyConsumerRepair(options, { run: operatorId, policyHead }, originalRun(), f.json),
    );
    f.responses.set(url, prior);
  }
});

test("a second original failure, missing job, or rerun race never inherits the Deno supplement", async () => {
  const f = fixture();
  const repair = { run: operatorId, policyHead };
  const jobsUrl = `${f.base}/actions/runs/${repair457.run}/jobs?filter=latest&per_page=100&page=1`;
  const packet = copy(f.responses.get(jobsUrl)!);
  const rows = packet.jobs as ObjectValue[];
  rows[0]!.conclusion = "failure";
  f.responses.set(jobsUrl, packet);
  await assert.rejects(
    verifyGithub({ ...options, consumerRepair: repair }, f.json),
    /terminal exact-H/,
  );
  f.responses.set(jobsUrl, { total_count: 55, jobs: originalJobs.slice(1) });
  await assert.rejects(
    verifyGithub({ ...options, consumerRepair: repair }, f.json),
    /56-job packet/,
  );
  f.responses.set(jobsUrl, { total_count: 56, jobs: originalJobs });
  let originalReads = 0;
  await assert.rejects(
    verifyGithub({ ...options, consumerRepair: repair }, async (url) => {
      const value = await f.json(url);
      if (url === `${f.base}/actions/runs/${repair457.run}` && ++originalReads === 2)
        value.run_attempt = 5;
      return value;
    }),
    /attempt changed/,
  );
});

test("the operator keeps the existing protected user authority and a read-only, unscheduled consumer operation", () => {
  const text = readFileSync(
    new URL("../../.github/workflows/release-operator.yml", import.meta.url),
    "utf8",
  );
  const workflow = parse(text);
  assert.equal(workflow.permissions.contents, "read");
  assert.deepEqual(Object.keys(workflow.on), ["workflow_dispatch"]);
  assert.equal(workflow.jobs.operator.environment, "release-operator");
  assert.equal(workflow.concurrency.group, "release-operator");
  assert.equal(workflow.concurrency["cancel-in-progress"], false);
  assert.match(text, /login.*GITHUB_ACTOR.*GITHUB_TRIGGERING_ACTOR/);
  assert.match(text, /maintain\|admin/);
  const capture = readFileSync(
    new URL("../../tools/support/release/consumer_repair/capture.ts", import.meta.url),
    "utf8",
  );
  assert.match(capture, /verifyOriginalLog\(failureLog\)/);
  assert.equal(JSON.parse(repair457.config).nodeModulesDir, "none");
  assert.deepEqual(Object.keys(JSON.parse(repair457.config)), ["nodeModulesDir"]);
  assert.doesNotMatch(capture, /"(?:--minimum-dependency-age|--no-check|--unstable)[^"\n]*"/);
  assert.doesNotMatch(capture, /"(?:gh|git)", \["(?:publish|rerun|close|push|update-ref)"/);
  assert.equal(workflow.jobs["supplemental-consumer"].needs, "operator");
  assert.equal(workflow.jobs["supplemental-consumer"].environment, undefined);
  assert.deepEqual(workflow.jobs["supplemental-consumer"].permissions, {
    contents: "read",
    actions: "read",
  });
  assert.doesNotMatch(JSON.stringify(workflow.jobs["supplemental-consumer"]), /secrets\./);
});

function custody() {
  const tree = { sha: "e2d1150ff4aa1aa5d8dc6a82ecb2fa43da56ac78" };
  const delivery = "b4be3b70977b80a689c8e5ada62d05283e86b868";
  const tagFields = {
    "Release-Mode": "pinned",
    "Release-PR": "#9196",
    "Validated-run": String(repair457.run),
    "Validated-head": repair457.head,
    "Validated-base": repair457.cut,
    "Integration-PR": "#9197",
    "Integration-head": "2c8a83c6858e8e46424ce578b5cfa7a0b1dbeafb",
    "Integration-merge": delivery,
    "Integration-parent": repair457.cut,
    "Protected-candidate": delivery,
  };
  return {
    source: {
      number: 9196,
      state: "open",
      draft: true,
      merged: false,
      merged_at: null,
      head: {
        sha: repair457.head,
        ref: "release/v0.457.0",
        repo: { full_name: repair457.repository },
      },
      base: { ref: "main", repo: { full_name: repair457.repository } },
      body: `<!-- vize-release-pin: immutable-v1 -->\n<!-- vize-release-pin-cut: ${repair457.cut} -->\n<!-- vize-release-pin-head: ${repair457.head} -->\n<!-- vize-release-integration: 9197 -->`,
    },
    sourceBranch: { object: { sha: repair457.head } },
    tagRef: { object: { sha: repair457.tagObject, type: "tag" } },
    tag: {
      tag: repair457.tag,
      object: { sha: repair457.head, type: "commit" },
      message: Object.entries(tagFields)
        .map(([name, value]) => `${name}: ${value}`)
        .join("\n"),
    },
    head: { tree, parents: [{ sha: repair457.cut }] },
    integration: { number: 9197, merged: true, merge_commit_sha: delivery },
    delivery: {
      sha: delivery,
      tree,
      parents: [{ sha: repair457.cut }],
      verification: { verified: true, reason: "valid" },
    },
    pin: { object: { sha: "e".repeat(40) } },
    pinCommit: {
      sha: "e".repeat(40),
      tree,
      parents: [{ sha: repair457.head }],
      message: `Source-PR: #9196\nSource-head: ${repair457.head}\nSource-cut: ${repair457.cut}\nTag: v0.457.0\nIntegration-PR: #9197`,
    },
    release: { id: 414307189, tag_name: "v0.457.0", draft: false, prerelease: false },
  } satisfies Record<string, ObjectValue>;
}

test("source closure requires immutable H/tag/pin/signed integration, with no mutation beyond own intent and close", () => {
  const good = custody();
  verifyFrozenCustody(good);
  const paths: string[][] = [];
  function leaves(value: unknown, path: string[] = []) {
    if (value && typeof value === "object")
      for (const [key, child] of Object.entries(value)) leaves(child, [...path, key]);
    else paths.push(path);
  }
  leaves(good);
  for (const path of paths) {
    const bad = copy(good);
    let owner = bad as unknown as ObjectValue;
    for (const key of path.slice(0, -1)) owner = owner[key] as ObjectValue;
    owner[path.at(-1)!] = "changed";
    assert.throws(() => verifyFrozenCustody(bad), path.join("."));
  }
  const intent = closureIntent(100, operatorId, policyHead);
  requireClosureMutation("POST", "issues/9196/comments", { body: intent }, intent);
  requireClosureMutation("PATCH", "pulls/9196", { state: "closed" }, intent);
  for (const [method, path, payload] of [
    ["PATCH", "pulls/9196", { state: "closed", head: policyHead }],
    ["PUT", "pulls/9196/merge", {}],
    ["PATCH", "pulls/9197", { state: "closed" }],
    ["POST", "actions/workflows/release-operator.yml/dispatches", { ref: "main" }],
    ["PATCH", "git/refs/tags/v0.457.0", { sha: policyHead }],
    ["POST", "issues/9196/comments", { body: "generic success" }],
  ] as const)
    assert.throws(() => requireClosureMutation(method, path, payload, intent));
  assert.match(intent, /Original Release #38805261385 attempt 4 remains failed/);
});

test("raw process capture drains arbitrary bytes before rejecting nonzero, signal and spawn failure", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "vize-repair-io-"));
  t.after(() => rmSync(root, { recursive: true }));
  const io = captureIo(root);
  const code =
    "process.stdout.write(Buffer.alloc(1048577, 255)); process.stderr.write(Buffer.from([0, 128, 255]));";
  const out = await io.command("positive", process.execPath, ["-e", code]);
  assert.equal(out.length, 1048577);
  assert.ok(out.every((byte) => byte === 255));
  await assert.rejects(
    io.command("nonzero", process.execPath, ["-e", code + "process.exitCode = 17;"]),
  );
  await assert.rejects(
    io.command("signal", process.execPath, [
      "-e",
      "process.stdout.write(Buffer.alloc(1048577, 255), () => process.stderr.write(Buffer.from([0, 128, 255]), () => process.kill(process.pid, 'SIGTERM')));",
    ]),
  );
  await assert.rejects(io.command("missing", join(root, "not-an-executable"), []));
  for (const name of ["1-positive", "2-nonzero", "3-signal"]) {
    assert.equal(readFileSync(join(root, `${name}.stdout`)).length, 1048577);
    assert.deepEqual(readFileSync(join(root, `${name}.stderr`)), Buffer.from([0, 128, 255]));
  }
  assert.equal(JSON.parse(readFileSync(join(root, "2-nonzero.json"), "utf8")).code, 17);
  assert.equal(JSON.parse(readFileSync(join(root, "3-signal.json"), "utf8")).signal, "SIGTERM");
  assert.ok(readdirSync(root).every((name) => !name.includes("accepted")));
});

function publicProofFixture() {
  const keys = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const name = "vize",
    integrity = `sha512-${Buffer.alloc(64, 5).toString("base64")}`;
  const signature = sign(
    "SHA256",
    Buffer.from(`${name}@0.457.0:${integrity}`),
    keys.privateKey,
  ).toString("base64");
  const pem = keys.publicKey.export({ type: "spki", format: "pem" }).toString();
  const statement = {
    predicateType: "https://slsa.dev/provenance/v1",
    subject: [{ digest: { sha512: Buffer.alloc(64, 5).toString("hex") } }],
    predicate: {
      buildDefinition: {
        resolvedDependencies: [{ digest: { gitCommit: String(repair457.head) } }],
        externalParameters: {
          workflow: {
            ref: "refs/heads/release/v0.457.0",
            repository: `https://github.com/${repair457.repository}`,
            path: ".github/workflows/release.yml",
          },
        },
      },
      runDetails: {
        metadata: {
          invocationId: "https://github.com/ubugeeei-prod/vize/actions/runs/38805261385/attempts/1",
        },
      },
    },
  };
  const attestation = () => ({
    bundle: { payload: Buffer.from(JSON.stringify(statement)).toString("base64") },
  });
  const exports = { ".": "./mod.ts" };
  const responses = new Map<string, ObjectValue>([
    [
      "https://registry.npmjs.org/-/npm/v1/keys",
      { keys: [{ keyid: "key", key: pem.split("\n").slice(1, -2).join("\n") }] },
    ],
    [
      "https://registry.npmjs.org/vize/0.457.0",
      {
        name,
        version: "0.457.0",
        dist: {
          integrity,
          attestations: { url: "https://registry.npmjs.org/proof" },
          signatures: [{ keyid: "key", sig: signature }],
        },
      },
    ],
    [
      "https://jsr.io/@vizejs/vize/0.457.0_meta.json",
      { exports, manifest: { "/mod.ts": { checksum: `sha256-${"a".repeat(64)}`, size: 21 } } },
    ],
  ]);
  const base = [
    "cli.tar.gz",
    "vize.vsix",
    "zed-vize-extension.tar.gz",
    "nvim-vize-extension.tar.gz",
    "vim-vize-extension.tar.gz",
    "helix-vize-extension.tar.gz",
    "emacs-vize-extension.tar.gz",
  ];
  const signed = [...base, "vize-v0.457.0-cyclonedx.sbom.json", "vize-v0.457.0-spdx.sbom.json"];
  const names = [
    ...signed,
    ...signed.flatMap((n) => [n + ".sig", n + ".pem", n + ".cosign.bundle"]),
    ...base.map((n) => n + ".sha256"),
  ];
  const release = {
    assets: names.map((n) => ({
      name: n,
      size: 1,
      state: "uploaded",
      digest: `sha256:${"c".repeat(64)}`,
    })),
  };
  const plan = {
    head: repair457.head,
    version: "0.457.0",
    npm: [{ name, version: "0.457.0" }],
  } as PublicationPlan;
  const reader = {
    json: async (url: string) => {
      if (url === "https://registry.npmjs.org/proof") return attestation();
      assert.ok(responses.has(url));
      return copy(responses.get(url)!);
    },
    download: async () => ({ sha256: "a".repeat(64), bytes: 21 }),
  };
  const readBlob = (path: string) =>
    Buffer.from(
      path.endsWith("channel.json")
        ? '{"enabled":true}'
        : path.endsWith("jsr.json")
          ? JSON.stringify({ name: "@vizejs/vize", exports })
          : 'archive: "cli.tar.gz"',
    );
  return { plan, reader, release, readBlob, responses, statement };
}

test("fresh closure proof checks real ECDSA plus exact decoded source/digest/workflow and JSR/assets", async () => {
  const f = publicProofFixture();
  const proof = await verifyAdditionalPublicProof(f.plan, f.release, f.readBlob, f.reader);
  assert.equal(proof.npm[0]!.signaturesVerified, 1);
  assert.equal(proof.npm[0]!.sigstoreVerified, false);
  const metadata = f.responses.get("https://registry.npmjs.org/vize/0.457.0")!;
  const dist = object(metadata.dist),
    signatures = dist.signatures as ObjectValue[];
  const original = signatures[0]!.sig;
  signatures[0]!.sig = Buffer.alloc(64).toString("base64");
  await assert.rejects(
    verifyAdditionalPublicProof(f.plan, f.release, f.readBlob, f.reader),
    /signature mismatch/,
  );
  signatures[0]!.sig = original;
  f.statement.predicate.buildDefinition.resolvedDependencies[0]!.digest.gitCommit = policyHead;
  await assert.rejects(verifyAdditionalPublicProof(f.plan, f.release, f.readBlob, f.reader));
  f.statement.predicate.buildDefinition.resolvedDependencies[0]!.digest.gitCommit = repair457.head;
  f.statement.predicate.runDetails.metadata.invocationId =
    "https://github.com/foreign/repo/actions/runs/38805261385/attempts/1";
  await assert.rejects(verifyAdditionalPublicProof(f.plan, f.release, f.readBlob, f.reader));
  f.statement.predicate.runDetails.metadata.invocationId =
    "https://github.com/ubugeeei-prod/vize/actions/runs/38805261385/attempts/1";
  await assert.rejects(
    verifyAdditionalPublicProof(f.plan, f.release, f.readBlob, {
      ...f.reader,
      download: async () => ({ sha256: "b".repeat(64), bytes: 21 }),
    }),
  );
  f.release.assets.pop();
  await assert.rejects(
    verifyAdditionalPublicProof(f.plan, f.release, f.readBlob, f.reader),
    /missing release asset/,
  );
});
