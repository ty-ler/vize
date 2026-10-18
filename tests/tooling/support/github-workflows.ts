import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

export function normalizeRepoText(content: string): string {
  return content.replace(/\r\n?/g, "\n");
}

export function readRepoFile(...segments: string[]): string {
  return normalizeRepoText(fs.readFileSync(path.join(root, ...segments), "utf8"));
}

/** Inspect the actual caller and its closed full-only callee without rewriting jobs. */
export function checkWorkflowJobSources(
  caller = readRepoFile(".github", "workflows", "check.yml"),
  callee = readRepoFile(".github", "workflows", "full-qualification.yml"),
): string {
  const expectedCaller = `  full-qualification:
    name: Full qualification
    if: \${{ github.event_name == 'schedule' || github.event_name == 'workflow_dispatch' }}
    uses: ./.github/workflows/full-qualification.yml
    with:
      compare-rust-test-profile: \${{ inputs.compare-rust-test-profile == true }}`;
  assert.equal(workflowJobBody(caller, "full-qualification"), expectedCaller);
  const header = `name: Full qualification
on:
  workflow_call:
    inputs:
      compare-rust-test-profile: { type: boolean, default: false }
permissions: { contents: read }
env: { CARGO_TERM_COLOR: always, FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: true }
jobs:
`;
  assert.ok(callee.startsWith(header), "full-only workflow authority changed");
  const jobs = callee.slice(header.length);
  const ids = [...jobs.matchAll(/^  ([a-z0-9-]+):$/gm)].map((match) => match[1]);
  assert.deepEqual(ids, [
    "full-source-cli",
    "tooling-plan",
    "test-scripts",
    "test-scripts-gate",
    "build-js-packages",
    "full-js-package-tests",
    "full-js-original-project",
    "test-js-packages",
    "full-rust-workspace",
    "full-rust-report",
    "rust-clippy-portability",
    "rust-davinci-allocations",
    "rust-native-differential",
    "clippy-and-test",
    "playground-test",
    "editor-extensions",
    "editor-host-smoke",
    "nuxt-module-qualification",
  ]);
  for (const id of ids)
    assert.ok(!caller.includes(`\n  ${id}:\n`), `duplicate caller/callee job: ${id}`);
  // Every returned producer is the original actual job object. The caller's
  // invocation remains visible and is required above to gate all of them.
  return `${caller}\n${jobs}`;
}

export function readGithubYamlFiles(): Array<{ relativePath: string; content: string }> {
  const files: Array<{ relativePath: string; content: string }> = [];
  const visit = (directory: string) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(fullPath);
        continue;
      }
      if (!/\.(ya?ml)$/.test(entry.name)) {
        continue;
      }
      files.push({
        relativePath: path.relative(root, fullPath),
        content: normalizeRepoText(fs.readFileSync(fullPath, "utf8")),
      });
    }
  };
  visit(path.join(root, ".github"));
  return files.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

export function workflowJobBody(workflow: string, jobName: string): string {
  const jobStart = workflow.indexOf(`\n  ${jobName}:\n`);
  assert.notEqual(jobStart, -1, `missing job ${jobName}`);
  const remaining = workflow.slice(jobStart + 1);
  const nextJobMatch = /\n  [a-z0-9-]+:\n/g.exec(remaining.slice(1));
  return remaining.slice(0, nextJobMatch ? nextJobMatch.index + 1 : undefined);
}

/**
 * A top-level job key's value, including any trailing comment. Scoping to the
 * owning job keeps assertions from being satisfied by a different job that
 * happens to carry the expected value.
 */
export function workflowJobField(
  workflow: string,
  jobName: string,
  field: string,
): string | undefined {
  const prefix = `    ${field}:`;
  const line = workflowJobBody(workflow, jobName)
    .split("\n")
    .find((candidate) => candidate.startsWith(prefix));
  return line?.slice(prefix.length).trim();
}

export function workflowJobRunsOn(workflow: string, jobName: string): string | undefined {
  return workflowJobField(workflow, jobName, "runs-on");
}

export function assertReleasePlatformCommandsUseRefEnv(
  workflow: string,
  jobNames: readonly string[],
): void {
  assert.doesNotMatch(
    workflow,
    /release-platforms\.rs (?:github-output|apply-cadence) "\$\{\{ github\.ref_name \}\}"/,
  );
  for (const jobName of jobNames) {
    const job = workflowJobBody(workflow, jobName);
    assert.match(job, /RELEASE_REF_NAME:\s*\$\{\{\s*inputs\.tag_name\s*\}\}/, jobName);
    assert.match(
      job,
      /release-platforms\.ts (?:github-output|apply-cadence) "\$RELEASE_REF_NAME"/,
      jobName,
    );
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// A runner label is a complete YAML scalar, so every pattern below ends at a
// label boundary. Without it the pattern only matches a prefix, and an
// assertion for `ubuntu-24.04` would be satisfied by `ubuntu-24.04-arm` (a
// different architecture) whenever the caller has no closing delimiter of its
// own.
const LABEL_BOUNDARY = "(?![\\w.-])";

// Runner pairs (hosted GitHub label, equivalent Blacksmith label) accepted by
// the workflow-shape tests. Letting either form match keeps the cross-platform
// coverage assertion strict on _which_ platforms are present without pinning the
// runner-pool vendor; switching back to GitHub-hosted shouldn't break the test
// and vice versa.
export function hostedOrBlacksmith(hostedLabel: string): string {
  if (hostedLabel === "ubuntu-22.04") {
    return `ubuntu-22\\.04${LABEL_BOUNDARY}`;
  }
  if (hostedLabel === "ubuntu-22.04-arm") {
    return `ubuntu-22\\.04-arm${LABEL_BOUNDARY}`;
  }
  if (hostedLabel === "ubuntu-24.04") {
    return `(?:ubuntu-24\\.04|blacksmith-\\d+vcpu-ubuntu-2404)${LABEL_BOUNDARY}`;
  }
  if (hostedLabel === "ubuntu-24.04-arm") {
    return `(?:ubuntu-24\\.04-arm|blacksmith-\\d+vcpu-ubuntu-2404-arm)${LABEL_BOUNDARY}`;
  }
  if (hostedLabel === "macos-15") {
    return `(?:macos-15|blacksmith-(?:6|12)vcpu-macos-15)${LABEL_BOUNDARY}`;
  }
  if (hostedLabel === "windows-2025") {
    return `(?:windows-2025|blacksmith-\\d+vcpu-windows-2025)${LABEL_BOUNDARY}`;
  }
  return `${escapeRegExp(hostedLabel)}${LABEL_BOUNDARY}`;
}

/** Match a full runner label, for callers that compare an extracted scalar. */
export function hostedOrBlacksmithExact(hostedLabel: string): RegExp {
  return new RegExp(`^${hostedOrBlacksmith(hostedLabel)}$`);
}

export type DailySourceStep = {
  name?: string;
  if?: string;
  run?: string;
  uses?: string;
  with?: Record<string, string | boolean>;
  "continue-on-error"?: boolean;
};
type DailySourceJob = {
  if?: string;
  outputs?: Record<string, string>;
  with?: Record<string, string | boolean>;
  needs?: string[] | string;
  steps?: DailySourceStep[];
  "continue-on-error"?: boolean;
};
export type DailyRustSourceWorkflow = {
  jobs: Record<string, DailySourceJob>;
  on: {
    workflow_call: {
      inputs: Record<string, { type: string; required: boolean; default?: boolean }>;
    };
  };
};

export function requireDailySourceContracts(
  planWorkflow: { jobs: Record<string, DailySourceJob> },
  rustWorkflow: DailyRustSourceWorkflow,
): number {
  const plan = planWorkflow.jobs["pr-source-plan"];
  assert.equal(plan.outputs?.["source-contracts"], "${{ steps.plan.outputs.source-contracts }}");
  assert.equal(
    planWorkflow.jobs["pr-rust-source"].with?.["run-source-contracts"],
    "${{ needs.pr-source-plan.outputs.source-contracts == 'true' }}",
  );
  assert.deepEqual(rustWorkflow.on.workflow_call.inputs["run-source-contracts"], {
    type: "boolean",
    required: false,
    default: true,
  });
  const job = rustWorkflow.jobs["pr-rust-build"];
  assert.equal(job.if, "${{ inputs.run-rust }}");
  assert.equal(job["continue-on-error"], undefined);
  const steps = job.steps ?? [];
  const contracts = steps.findIndex(
    (step) => step.name === "Require current-tree source, API and reviewed-doc contracts",
  );
  assert.ok(contracts >= 0);
  assert.equal(steps[contracts].if, "${{ inputs.run-source-contracts }}");
  assert.equal(steps[contracts]["continue-on-error"], undefined);
  assert.equal(
    steps[contracts].run,
    [
      "node",
      "--test",
      "--test-concurrency=1",
      "tests/tooling/davinci-assertion-lint.test.ts",
      "tests/tooling/davinci-consumer-migration-surfaces.test.mjs",
      "tests/tooling/docs-reviewed-translations.test.ts",
      "tests/tooling/typecheck-divergence-report-timeout.test.ts",
      "tests/tooling/typecheck-divergence-mutation-oracle.test.ts",
      "tests/tooling/typecheck-fixture-custody.test.ts",
      "tests/tooling/davinci-canonical-corpus-native-walk.test.mjs",
      "tests/tooling/typecheck-divergence-baseline-ambient.test.ts",
      "tests/tooling/typecheck-divergence-baseline-configuration.test.ts",
      "tests/tooling/typecheck-divergence-baseline-support-corpus.test.ts",
      "tests/tooling/typecheck-divergence-baseline-support.test.ts",
      "tests/tooling/typecheck-divergence-baseline.test.ts",
      "tests/tooling/typecheck-divergence-budget.test.ts",
      "tests/tooling/typecheck-divergence-ledger.test.ts",
      "tests/tooling/typecheck-divergence-mutation-delta.test.ts",
      "tests/tooling/typecheck-divergence-report-enforcement.test.ts",
      "tests/tooling/typecheck-divergence-report-ledger.test.ts",
      "tests/tooling/typecheck-divergence-report-rejections.test.ts",
      "tests/tooling/typecheck-divergence-report.test.ts",
      "tests/tooling/typecheck-divergence.test.ts",
      "tests/tooling/typecheck-baseline-usability.test.ts",
    ].join(" "),
  );
  const custody = steps[contracts + 1];
  assert.deepEqual(custody, {
    name: "Retain mutation deadline command and fixture evidence",
    if: "${{ always() && inputs.run-source-contracts }}",
    uses: "actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a",
    with: {
      name: "mutation-deadline-${{ github.run_id }}-${{ github.run_attempt }}-${{ github.job }}",
      path: "target/differential/typecheck-mutation/",
      "include-hidden-files": true,
      "if-no-files-found": "warn",
      "retention-days": 7,
    },
  });
  for (const action of [
    "actions/setup-node@",
    "dtolnay/rust-toolchain@",
    "./.github/actions/setup-rust-sticky-cache",
    "./.github/actions/setup-rust-script",
  ]) {
    const setup = steps.findIndex((step) => step.uses?.startsWith(action));
    assert.ok(setup >= 0 && setup < contracts, action);
    if (action.endsWith("setup-rust-script")) {
      assert.equal(steps[setup].if, "${{ inputs.run-source-contracts }}");
      assert.equal(steps[setup]["continue-on-error"], undefined);
    }
  }
  const report = rustWorkflow.jobs["rust-source-report"];
  assert.ok(report.needs?.includes("pr-rust-build"));
  const gate = report.steps?.find((step) => step.name === "Require the complete Rust tier");
  assert.equal(gate?.run, "node tools/support/compat/github/require-rust-tier.ts --source");
  assert.equal(gate?.["continue-on-error"], undefined);
  assert.ok(
    (plan.steps ?? []).every(
      (step) =>
        !step.uses?.includes("rust-toolchain@") &&
        step.uses !== "./.github/actions/setup-rust-script",
    ),
  );
  return contracts;
}

export function guardedCohortPackaging(producer: { if?: string; steps?: DailySourceStep[] }) {
  assert.equal(
    producer.if,
    "${{ github.event_name == 'merge_group' && inputs.run-rust && inputs.product-qualification == '' }}",
  );
  const steps = producer.steps ?? [];
  const probe = steps.filter(
    (step) => step.name === "Qualify pinned nextest cohort archive resources",
  );
  const uploads = steps.filter((step) =>
    String(step.with?.name ?? "").startsWith(
      "rust-test-archive-${{ github.run_id }}-${{ github.sha }}-",
    ),
  );
  assert.equal(probe.length, 1);
  assert.equal(uploads.length, 5);
  for (const step of [...probe, ...uploads]) {
    assert.equal(step.if, "${{ inputs.run-rust }}");
    assert.equal(step["continue-on-error"], undefined);
  }
  return [...probe, ...uploads];
}

const cohortBuild =
  'node tools/support/compat/github/rust-test-archive.ts build-cohorts "$RUNNER_TEMP/rust-plan.json" target/rust-test-archive';
const originalBuild =
  'node tools/support/compat/github/run-affected-rust.ts "$RUNNER_TEMP/rust-plan.json" cargo nextest archive @packages@ --cargo-profile ci --timings --archive-file target/rust-test-archive/tests.tar.zst';
const corpusWorker =
  'vp node tests/differential/typechecker-shards.ts worker target/nextest/full/typechecker-fixtures .artifacts/rust-test-archive/receipt.json target/nextest/full/junit.xml "$COHORT"';
const corpusAggregate =
  "vp node tests/differential/typechecker-shards.ts aggregate .artifacts/typechecker-workers target/differential/typechecker";

/** Validate each authored payload change before restoring the immutable recipe witness. */
export function restoreCohortArchiveRecipe(
  job: { if?: string; steps?: DailySourceStep[] },
  id: string,
) {
  const steps = job.steps!;
  const one = (name: string) => {
    const selected = steps.filter((step) => step.name === name);
    assert.equal(selected.length, 1, name);
    return selected[0];
  };
  const replace = (step: DailySourceStep, current: string, historical: string) => {
    assert.equal(typeof step.run, "string");
    assert.equal(step.run!.split(current).length, 2);
    step.run = step.run!.replace(current, historical);
  };
  if (id === "merge-rust-source") {
    const [probe, ...uploads] = guardedCohortPackaging(job);
    assert.deepEqual(probe, {
      name: "Qualify pinned nextest cohort archive resources",
      if: "${{ inputs.run-rust }}",
      env: { VIZE_TEST_REAL_COHORT_ARCHIVES: "1" },
      run: "node --test tests/tooling/rust-cohort-archive-integration.test.ts",
    });
    const cohorts = [
      "compiler",
      "typechecker",
      "language-server",
      "lint-and-format",
      "cli-and-integrations",
    ];
    assert.deepEqual(
      uploads,
      cohorts.map((cohort) => ({
        uses: "actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a",
        if: "${{ inputs.run-rust }}",
        with: {
          name: "rust-test-archive-${{ github.run_id }}-${{ github.sha }}-" + cohort,
          overwrite: true,
          path: `target/rust-test-archive/${cohort}/`,
          "if-no-files-found": "error",
          "compression-level": 0,
          "retention-days": 1,
        },
      })),
    );
    const build = one("Build Rust workspace tests");
    assert.ok(steps.indexOf(probe) < steps.indexOf(build));
    assert.ok(steps.indexOf(build) < steps.indexOf(uploads[0]));
    replace(build, cohortBuild, originalBuild);
    replace(
      build,
      '  cp target/rust-test-archive/workspace-tests.json "$timing_dir/workspace-tests.json"\n',
      "",
    );
    replace(
      build,
      '  cp target/rust-test-archive/receipt.json "$timing_dir/archive-receipt.json"',
      '  node tools/support/compat/github/rust-test-archive.mjs stamp target/rust-test-archive/tests.tar.zst target/rust-test-archive/receipt.json\n  cp target/rust-test-archive/receipt.json "$timing_dir/archive-receipt.json"',
    );
    const summary = one("Summarize Rust test timing evidence");
    const env = Reflect.get(summary, "env") as Record<string, string>;
    assert.equal(env.BUILD_COMMAND, cohortBuild);
    env.BUILD_COMMAND = originalBuild;
    for (const step of [probe, ...uploads.slice(1)]) steps.splice(steps.indexOf(step), 1);
    uploads[0].with!.name = "rust-test-archive-${{ github.run_id }}-${{ github.sha }}";
    uploads[0].with!.path = "target/rust-test-archive/";
    steps.splice(steps.indexOf(uploads[0]), 0, {
      name: "List affected source-built tests",
      if: "${{ inputs.run-rust }}",
      run: 'node tools/support/compat/github/run-affected-rust.ts "$RUNNER_TEMP/rust-plan.json" cargo nextest list @packages@ --cargo-profile ci --profile full --message-format json > "$RUNNER_TEMP/rust-test-timings/workspace-tests.json"',
    });
  } else {
    assert.equal(id, "pr-rust-shard");
    for (const [name, current, historical] of [
      [
        "Select immutable Rust test archive",
        "node tools/support/compat/github/rust-archive-download.ts select-cohort",
        "node tools/support/compat/github/rust-archive-download.ts select",
      ],
      [
        "Require completed immutable archive download",
        "node tools/support/compat/github/rust-archive-download.ts verify-cohort",
        "node tools/support/compat/github/rust-archive-download.ts verify",
      ],
      [
        "Verify Rust archive identity",
        'node tools/support/compat/github/rust-test-archive.ts verify-cohort .artifacts/rust-test-archive/tests.tar.zst .artifacts/rust-test-archive/receipt.json "$COHORT"',
        "node tools/support/compat/github/rust-test-archive.mjs verify .artifacts/rust-test-archive/tests.tar.zst .artifacts/rust-test-archive/receipt.json",
      ],
      ["Verify actual typechecker fixture observations", `${corpusWorker} 4\n`, corpusWorker],
    ]) {
      const step = one(name);
      assert.equal(step.run, current);
      step.run = historical;
    }
    const closure = one("Verify the complete cohort and extracted resource closure");
    assert.deepEqual(closure, {
      name: "Verify the complete cohort and extracted resource closure",
      if: "${{ !cancelled() && github.event_name == 'merge_group' }}",
      run: 'node tools/support/compat/github/rust-test-archive.ts verify-files "$GITHUB_WORKSPACE" .artifacts/rust-test-archive/receipt.json "$COHORT" target/nextest/full/junit.xml',
    });
    assert.ok(
      steps.indexOf(closure) > steps.indexOf(one("Run Rust test cohort without rebuilding")),
    );
    steps.splice(steps.indexOf(closure), 1);
  }
}

export function restoreCohortCorpusRecipe(steps: DailySourceStep[]) {
  const selected = steps.filter((step) => step.run?.includes(corpusAggregate));
  assert.equal(selected.length, 1);
  const step = selected[0];
  assert.equal(step.run!.split(`${corpusAggregate} 4`).length, 2);
  step.run = step.run!.replace(`${corpusAggregate} 4`, corpusAggregate);
}
