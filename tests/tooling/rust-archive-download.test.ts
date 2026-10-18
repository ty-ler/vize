import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { runInNewContext } from "node:vm";
import {
  requireDownload,
  selectArchive,
  validateArchive,
} from "../../tools/support/compat/github/rust-archive-download.ts";
import { readRepoFile, guardedCohortPackaging } from "./support/github-workflows.ts";
import { RUST_TEST_COHORT_IDS } from "../../tools/support/compat/github/rust-test-cohorts.ts";

const context = { run: "123", sha: "a".repeat(40), repository: "owner/repo" };
const artifact = {
  id: 99,
  name: `rust-test-archive-123-${context.sha}`,
  digest: `sha256:${"b".repeat(64)}`,
  expired: false,
  workflow_run: { id: 123, head_sha: context.sha },
};

test("archive selection rejects ambiguous, expired, foreign and missing digest identities", () => {
  assert.deepEqual(selectArchive([artifact], context), { id: 99, digest: artifact.digest });
  assert.throws(() => selectArchive([], context));
  assert.throws(() => selectArchive([artifact, artifact], context));
  for (const changed of [
    null,
    {},
    { ...artifact, workflow_run: null },
    { ...artifact, id: 0 },
    { ...artifact, expired: true },
    { ...artifact, digest: "missing" },
    { ...artifact, name: "another-source" },
    { ...artifact, workflow_run: { id: 124, head_sha: context.sha } },
    { ...artifact, workflow_run: { id: 123, head_sha: "c".repeat(40) } },
  ])
    assert.throws(() => validateArchive(changed, context));
});

test("cohort selectors never fall back to the common or another cohort archive", () => {
  const all = RUST_TEST_COHORT_IDS.map((cohort, index) => ({
    ...artifact,
    id: index + 1,
    name: `${artifact.name}-${cohort}`,
  }));
  for (const cohort of RUST_TEST_COHORT_IDS) {
    const own = all.find((item) => item.name.endsWith(`-${cohort}`))!;
    const current = { ...context, cohort };
    assert.deepEqual(selectArchive(all, current), { id: own.id, digest: own.digest });
    assert.throws(() => selectArchive([artifact], current));
    assert.throws(() =>
      selectArchive(
        all.filter((item) => item.id !== own.id),
        current,
      ),
    );
    assert.throws(() => selectArchive([...all, own], current));
    assert.throws(() => validateArchive({ ...own, digest: undefined }, current));
  }
  for (const cohort of ["", "unknown", "compiler/../../other"])
    assert.throws(() => selectArchive(all, { ...context, cohort }));
});

test("only a clean first success or a single successful retry can qualify", () => {
  for (const first of ["success", "failure", "cancelled", "skipped", "", undefined]) {
    for (const retry of ["success", "failure", "cancelled", "skipped", "", undefined]) {
      if (
        (first === "success" && retry === "skipped") ||
        (first === "failure" && retry === "success")
      )
        assert.doesNotThrow(() => requireDownload(first, retry));
      else assert.throws(() => requireDownload(first, retry));
    }
  }
});

test("workflow bounds both attempts, pins the same ID and requires cleanup plus every original gate", () => {
  const workflow = parse(readRepoFile(".github", "workflows", "pr-rust-products.yml"));
  const job = workflow.jobs["pr-rust-shard"];
  const first = job.steps.find((step: { id?: string }) => step.id === "rust-archive-first");
  const retry = job.steps.find((step: { id?: string }) => step.id === "rust-archive-retry");
  assert.equal(
    job.steps.filter((step: { uses?: string }) =>
      step.uses?.startsWith("actions/download-artifact@"),
    ).length,
    2,
  );
  for (const step of [first, retry]) {
    assert.equal(step["timeout-minutes"], 3);
    assert.deepEqual(step.with, {
      "artifact-ids": "${{ steps.rust-archive.outputs.id }}",
      path: ".artifacts/rust-test-archive",
      "digest-mismatch": "error",
    });
  }
  assert.equal(first["continue-on-error"], true);
  assert.equal(retry["continue-on-error"], undefined);
  assert.equal(first.if, "${{ github.event_name == 'merge_group' }}");
  assert.equal(
    retry.if,
    "${{ !cancelled() && steps.rust-archive-first.outcome == 'failure' && steps.rust-archive-clean.outcome == 'success' }}",
  );
  const clean = job.steps.find((step: { id?: string }) => step.id === "rust-archive-clean");
  assert.equal(clean.run, "node tools/support/compat/github/rust-archive-download.ts clean-retry");
  assert.equal(clean.if, "${{ !cancelled() && steps.rust-archive-first.outcome == 'failure' }}");
  assert.ok(job.steps.indexOf(clean) > job.steps.indexOf(first));
  assert.ok(job.steps.indexOf(retry) > job.steps.indexOf(clean));
  const required = job.steps.find(
    (step: { name?: string }) => step.name === "Require completed immutable archive download",
  );
  assert.equal(
    required.run,
    "node tools/support/compat/github/rust-archive-download.ts verify-cohort",
  );
  assert.equal(required.if, "${{ !cancelled() && github.event_name == 'merge_group' }}");
  assert.equal(required["continue-on-error"], undefined);
  const receipt = job.steps.find(
    (step: { name?: string }) => step.name === "Verify Rust archive identity",
  );
  assert.equal(
    receipt.run,
    'node tools/support/compat/github/rust-test-archive.ts verify-cohort .artifacts/rust-test-archive/tests.tar.zst .artifacts/rust-test-archive/receipt.json "$COHORT"',
  );
  assert.ok(job.steps.indexOf(receipt) > job.steps.indexOf(required));
  const run = job.steps.find(
    (step: { name?: string }) => step.name === "Run Rust test cohort without rebuilding",
  );
  assert.ok(
    run.run.includes(
      'cargo nextest run --archive-file .artifacts/rust-test-archive/tests.tar.zst --extract-to "$GITHUB_WORKSPACE" --extract-overwrite --workspace-remap "$GITHUB_WORKSPACE" --profile "$NEXTEST_PROFILE" -E "$NEXTEST_FILTER" --no-tests=pass',
    ),
  );
  assert.equal(job.strategy["fail-fast"], false);
  assert.equal(job["timeout-minutes"], 20);
});

test("actual selector cleans partial files and rejects metadata changes after a successful transfer", async (t) => {
  const workspace = mkdtempSync(join(tmpdir(), "vize-bounded-archive-"));
  t.after(() => rmSync(workspace, { recursive: true, force: true }));
  let current = artifact;
  const server = createServer((request, response) => {
    assert.equal(request.headers.authorization, "Bearer unit-token");
    response.setHeader("content-type", "application/json");
    response.end(
      JSON.stringify(
        request.url?.includes("/runs/") ? { total_count: 1, artifacts: [current] } : current,
      ),
    );
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  t.after(() => server.close());
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const env = {
    ...process.env,
    GITHUB_WORKSPACE: workspace,
    GITHUB_RUN_ID: context.run,
    GITHUB_SHA: context.sha,
    GITHUB_REPOSITORY: context.repository,
    GITHUB_API_URL: `http://127.0.0.1:${address.port}`,
    GH_TOKEN: "unit-token",
    GITHUB_OUTPUT: join(workspace, "outputs"),
    RUST_ARCHIVE_ID: "99",
    RUST_ARCHIVE_DIGEST: artifact.digest,
    RUST_ARCHIVE_FIRST_OUTCOME: "failure",
    RUST_ARCHIVE_RETRY_OUTCOME: "success",
  };
  const command = new URL(
    "../../tools/support/compat/github/rust-archive-download.ts",
    import.meta.url,
  );
  const run = (mode: string) =>
    promisify(execFile)(process.execPath, [fileURLToPath(command), mode], { env });
  const destination = join(workspace, ".artifacts/rust-test-archive");
  mkdirSync(destination, { recursive: true });
  writeFileSync(join(destination, "partial"), "incomplete archive");
  await run("select");
  assert.equal(existsSync(destination), false);
  assert.equal(readFileSync(env.GITHUB_OUTPUT, "utf8"), `id=99\ndigest=${artifact.digest}\n`);
  mkdirSync(destination);
  writeFileSync(join(destination, "partial"), "another incomplete archive");
  await run("clean-retry");
  assert.equal(existsSync(destination), false);
  await run("verify");
  current = { ...artifact, digest: `sha256:${"c".repeat(64)}` };
  await assert.rejects(run("verify"), /ID\/digest changed/);
});

void test("cohort probe and all five payload uploads retain the selected Rust truth table", () => {
  const products = parse(readRepoFile(".github", "workflows", "pr-rust-products.yml")) as {
    jobs: Record<string, Parameters<typeof guardedCohortPackaging>[0]>;
  };
  const producer = products.jobs["merge-rust-source"];
  const guarded = guardedCohortPackaging(producer);
  for (const event of ["merge_group", "pull_request", "workflow_dispatch"])
    for (const runRust of [true, false])
      for (const qualification of ["", "nonempty-qualification"]) {
        // The complete exact three-variable producer predicate was validated above.
        const selected = event === "merge_group" && runRust && qualification === "";
        assert.deepEqual(
          guarded.map(() => selected && runRust),
          Array(6).fill(selected),
        );
      }
  for (const original of guarded) {
    for (const mutation of [
      { if: undefined },
      { if: "${{ always() }}" },
      { "continue-on-error": true },
    ]) {
      const changed = structuredClone(producer);
      const index = producer.steps!.indexOf(original);
      Object.assign(changed.steps![index], mutation);
      assert.throws(() => guardedCohortPackaging(changed));
    }
  }
});

test("actual job selectors keep ordinary workers and source checks while only footprint products can skip", () => {
  const rustWorkflow = (name: string) =>
    parse(readRepoFile(".github", "workflows", name)) as { jobs: Record<string, { if: string }> };
  const source = rustWorkflow("pr-rust-checks.yml").jobs;
  const products = rustWorkflow("pr-rust-products.yml").jobs;
  const selector =
    (job: { if: string }) =>
    (context: Record<string, string | boolean>): unknown =>
      runInNewContext(
        `(${job.if
          .slice(3, -2)
          .replaceAll("github.event_name", "event")
          .replaceAll("inputs.run-rust", "runRust")
          .replaceAll("inputs.product-qualification", "product")
          .replaceAll("needs.merge-rust-source.result", "result")
          .replaceAll("always()", "true")
          .replaceAll("cancelled()", "cancelled")})`,
        context,
      );
  const archive = selector(products["merge-rust-source"]),
    cohort = selector(products["pr-rust-shard"]);
  const clippy = selector(source["pr-rust-build"]),
    differential = selector(source["merge-rust-differential"]);
  for (const event of ["pull_request", "merge_group"])
    for (const runRust of [true, false])
      for (const product of ["", "untrusted-nonempty"])
        for (const result of ["success", "failure", "skipped"])
          for (const cancelled of [true, false]) {
            const args = { event, runRust, product, result, cancelled };
            assert.equal(archive(args), event === "merge_group" && runRust && product === "");
            assert.equal(
              cohort(args),
              !cancelled &&
                runRust &&
                product === "" &&
                (event === "pull_request" || result === "success"),
            );
            assert.equal(clippy(args), runRust);
            assert.equal(differential(args), event === "merge_group" && runRust);
          }
});
