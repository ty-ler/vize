import assert from "node:assert/strict";
import { test } from "node:test";
import { parse } from "yaml";

import { readRepoFile } from "./support/github-workflows.ts";

type Step = {
  name?: string;
  id?: string;
  if?: string;
  uses?: string;
  run?: string;
  env?: Record<string, string>;
  with?: Record<string, string | number>;
  "continue-on-error"?: boolean;
};
const history = parse(
  readRepoFile(".github", "actions", "test-js-packages-with-history", "action.yml"),
) as { runs: { steps: Step[] } };
const jsChecks = parse(readRepoFile(".github", "workflows", "pr-js-checks.yml")) as {
  jobs: Record<string, { steps: Step[] }>;
};
const inputJs = "${{ inputs.run-js }}";
const evidenceJs = "${{ always() && inputs.run-js }}";
const [, qualification, upload, style, oxlint, cleanup, fault] = history.runs.steps;

void test("each PR package group uploads the main suite's evidence under a per-group name", () => {
  const groupJob = jsChecks.jobs["pr-js-package-tests"];
  const groupStep = (name: string) => groupJob.steps.find((step) => step.name === name);
  const perGroup = (name: string) =>
    name.replace(/\$\{\{ github\.job \}\}$/u, "${{ github.job }}-${{ matrix.group }}");
  const stagingPath = "target/oxlint-original-project-transport/**\n";
  for (const original of [upload, style, oxlint, fault]) {
    const step = groupStep(original.name!.replace("bridge locations", "package locations"));
    assert.ok(step, original.name);
    assert.equal(step.if, evidenceJs);
    assert.equal(step.uses, original.uses);
    assert.equal(step["continue-on-error"], undefined);
    assert.deepEqual(step.with, {
      ...original.with,
      name: perGroup(String(original.with!.name)),
      // Only the qualification job writes project qualification staging.
      path: String(original.with!.path).replace(stagingPath, ""),
    });
  }
  const names = groupJob.steps.flatMap((step) => (step.with?.name ? [step.with.name] : []));
  assert.equal(new Set(names).size, names.length);
});

void test("the PR qualification job keeps the original command, guards and evidence", () => {
  const qualify = jsChecks.jobs["pr-oxlint-project-qualification"].steps;
  const index = (predicate: (step: Step) => boolean) => qualify.findIndex(predicate);
  const build = index((step) => step.run === "vp run --workspace-root build:oxlint-qualification");
  const run = index((step) => step.id === qualification.id);
  const native = index((step) => step.name === upload.name);
  const evidence = index((step) => step.id === oxlint.id);
  const clean = index((step) => step.name === cleanup.name);
  assert.ok(0 < build && build < run && run < native && native < evidence && evidence < clean);
  assert.equal(qualify[build].if, inputJs);
  assert.deepEqual(
    { ...qualify[run] },
    {
      name: qualification.name,
      id: qualification.id,
      if: inputJs,
      // Only fixed process counts over the same staged binary are added.
      env: {
        ...qualification.env,
        VIZE_N8N_BASELINE_PARTITIONS: "12",
        VIZE_OXLINT_MIXED_WORKERS: "6",
        VIZE_N8N_HOST_REFERENCE_SLICES: "6",
      },
      run: qualification.run,
    },
  );
  for (const [step, original] of [
    [qualify[native], upload],
    [qualify[evidence], oxlint],
  ]) {
    assert.equal(step.if, evidenceJs);
    assert.equal(step.uses, original.uses);
    assert.deepEqual(step.with, original.with);
  }
  assert.equal(qualify[evidence].id, oxlint.id);
  assert.deepEqual(
    { ...qualify[clean] },
    { name: cleanup.name, if: cleanup.if, env: cleanup.env, run: cleanup.run },
  );
});
