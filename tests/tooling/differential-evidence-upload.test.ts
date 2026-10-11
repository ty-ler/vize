import assert from "node:assert/strict";
import { test } from "node:test";
import { parse } from "yaml";
import { readRepoFile } from "./support/github-workflows.ts";

type Step = {
  name?: string;
  if?: string;
  uses?: string;
  run?: string;
  shell?: string;
  with?: Record<string, string>;
};
type Workflow = {
  jobs: Record<string, { steps: Step[]; needs?: string | string[]; uses?: string }>;
};
const actionPath = "./.github/actions/upload-formatter-api-corpus-evidence";
const action = parse(readRepoFile(actionPath.slice(2), "action.yml")) as {
  inputs: { shard: { default: string } };
  runs: { using: string; steps: Step[] };
};

function retainWithoutBuilder(steps: Step[]) {
  assert.equal(
    steps.length,
    3,
    "retention accepts only the original upload and two passive diagnostic steps",
  );
  assert.deepEqual(
    steps.slice(1),
    [
      {
        name: "Finish opted-in passive Docker lifecycle evidence",
        if: "${{ always() && env.VIZE_DOCKER_PHASE_CAPTURE == 'true' }}",
        shell: "bash",
        run: "python3 tools/support/compat/github/docker-phase-evidence.py finish",
      },
      {
        name: "Retain opted-in bounded Docker lifecycle evidence",
        if: "${{ always() && env.VIZE_DOCKER_PHASE_CAPTURE == 'true' }}",
        uses: "actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a",
        with: {
          name: "docker-phase-${{ github.run_id }}-${{ github.run_attempt }}-${{ inputs.shard }}",
          path: "target/ci-docker-phase/",
          "if-no-files-found": "error",
        },
      },
    ],
    "diagnostic retention cannot introduce another build or change default qualification",
  );
}

void test("shared evidence uploader retains every product raw tree and the selected CLI receipt", () => {
  assert.equal(action.runs.using, "composite");
  retainWithoutBuilder(action.runs.steps);
  const upload = action.runs.steps[0];
  assert.match(upload.uses ?? "", /^actions\/upload-artifact@[0-9a-f]{40}$/);
  assert.deepEqual(upload.with?.path.trim().split("\n"), [
    "target/differential/",
    "target/ci/vize.differential-build.json",
  ]);
  assert.equal(upload.with?.["if-no-files-found"], "warn");
  assert.equal(upload.run, undefined);
});

void test("additional builders and unconditional diagnostic retention remain refusals", () => {
  const original = action.runs.steps;
  for (const altered of [
    [...original, { run: "cargo build -p vize" }],
    [
      original[0],
      { ...original[1], run: "cargo build -p vize && " + original[1].run },
      original[2],
    ],
    [original[0], { ...original[1], if: "${{ always() }}" }, original[2]],
  ])
    assert.throws(() => retainWithoutBuilder(altered), assert.AssertionError);
});

void test("evidence artifact identity preserves its prefix and separates jobs, shards and attempts", () => {
  assert.equal(action.inputs.shard.default, "full");
  const template = action.runs.steps[0].with?.name ?? "";
  assert.equal(
    template,
    "formatter-api-corpus-${{ github.run_id }}-${{ github.run_attempt }}-${{ github.job }}-${{ inputs.shard }}",
  );
  const identities = new Set<string>();
  for (const run of ["101", "102"]) {
    for (const attempt of ["1", "2"]) {
      for (const job of ["test-scripts", "pr-tooling-scripts"]) {
        for (const shard of ["full", "1", "2"]) {
          const identity = template
            .replace("${{ github.run_id }}", run)
            .replace("${{ github.run_attempt }}", attempt)
            .replace("${{ github.job }}", job)
            .replace("${{ inputs.shard }}", shard);
          assert.ok(!identities.has(identity), `colliding evidence upload ${identity}`);
          identities.add(identity);
        }
      }
    }
  }
  assert.equal(identities.size, 24);
});

void test("PR and full tooling gates retain failed observations after their tests", () => {
  const full = parse(readRepoFile(".github", "workflows", "check.yml")) as Workflow;
  const pr = parse(readRepoFile(".github", "workflows", "pr-source-checks.yml")) as Workflow;
  const producer = parse(readRepoFile(".github", "workflows", "pr-source-cli.yml")) as Workflow;
  const restore = parse(readRepoFile(".github", "actions", "restore-source-cli", "action.yml")) as {
    runs: { steps: Step[] };
  };
  for (const [job, condition, shard] of [
    [full.jobs["test-scripts"], "${{ always() }}", "full"],
    [
      pr.jobs["pr-tooling-scripts"],
      "${{ always() && needs.pr-source-plan.outputs.tooling == 'true' }}",
      "${{ matrix.index }}",
    ],
  ] as const) {
    const uploads = job.steps.filter((step) => step.uses === actionPath);
    assert.equal(uploads.length, 1);
    assert.equal(uploads[0].if, condition);
    assert.equal(uploads[0].with?.shard ?? action.inputs.shard.default, shard);
    assert.deepEqual(Object.keys(uploads[0].with ?? {}), shard === "full" ? [] : ["shard"]);
    const uploadIndex = job.steps.indexOf(uploads[0]);
    const tests = job.steps.filter((step) => /test:scripts(?::pr)?\b/.test(step.run ?? ""));
    assert.ok(tests.length > 0);
    for (const step of tests) assert.ok(job.steps.indexOf(step) < uploadIndex);
    const shared = job === pr.jobs["pr-tooling-scripts"];
    const build = job.steps.find((step) =>
      shared
        ? step.uses === "./.github/actions/restore-source-cli"
        : /tests\/differential\/build-receipt\.ts/.test(step.run ?? ""),
    );
    assert.ok(build, "uploaded CLI receipt must be made by the actual selected source build");
    assert.ok(job.steps.indexOf(build) < uploadIndex);
    if (shared) {
      assert.deepEqual(job.needs, ["pr-source-plan", "pr-source-cli"]);
      assert.equal(pr.jobs["pr-source-cli"].uses, "./.github/workflows/pr-source-cli.yml");
      assert.deepEqual(build.with, {
        producer: "${{ toJSON(needs.pr-source-cli.outputs) }}",
      });
      const originalBuild = producer.jobs.cli.steps.find((step) =>
        /tests\/differential\/build-receipt\.ts/.test(step.run ?? ""),
      );
      assert.ok(originalBuild, "same-run producer makes the original uploaded receipt");
      assert.match(
        originalBuild.run ?? "",
        /cargo build --profile ci -p vize && vp exec node tests\/differential\/build-receipt\.ts/,
      );
      assert.equal(originalBuild.if, "${{ inputs.run-cli }}");
      const downloads = restore.runs.steps.filter((step) =>
        step.uses?.startsWith("actions/download-artifact@"),
      );
      assert.equal(downloads.length, 1);
      assert.equal(downloads[0].with?.["digest-mismatch"], "error");
      const restoreRun = restore.runs.steps.at(-1)?.run ?? "";
      assert.match(restoreRun, /source-cli-artifact\.ts restore/);
      assert.match(restoreRun, /cat target\/ci\/vize\.differential-build\.json/);
      assert.doesNotMatch(restoreRun, /build-receipt\.ts/);
    }
  }
});
