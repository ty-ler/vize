import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { TestContext } from "node:test";
import { parse } from "yaml";

import {
  collapseModes,
  compareQualifications,
} from "../../tools/support/compat/github/compare-oxlint-qualifications.ts";
import { readRepoFile } from "./support/github-workflows.ts";

type Step = { id?: string; name?: string; if?: string; run?: string; uses?: string } & {
  env?: Record<string, string>;
  with?: Record<string, string | number>;
};
const workflow = parse(
  readRepoFile(".github", "workflows", "oxlint-qualification-parallelism.yml"),
);
const pullRequest = parse(readRepoFile(".github", "workflows", "pr-js-checks.yml"));

void test("one manual build qualifies with the original and the PR CI process counts", () => {
  assert.deepEqual(workflow.on, { workflow_call: null, workflow_dispatch: null });
  const benchmark = parse(readRepoFile(".github", "workflows", "ci-walltime-benchmark.yml"));
  assert.ok(benchmark.on.workflow_dispatch.inputs.component.options.includes("oxlint-parallelism"));
  assert.deepEqual(benchmark.jobs["oxlint-parallelism"], {
    if: "${{ github.event_name == 'workflow_dispatch' && inputs.component == 'oxlint-parallelism' }}",
    uses: "./.github/workflows/oxlint-qualification-parallelism.yml",
  });
  assert.deepEqual(workflow.permissions, { contents: "read" });
  assert.deepEqual(Object.keys(workflow.jobs), ["compare"]);
  const steps: Step[] = workflow.jobs.compare.steps;
  assert.equal(workflow.jobs.compare.env.VIZE_N8N_BASELINE_MODE, "partitioned");
  const index = (predicate: (step: Step) => boolean) => steps.findIndex(predicate);
  const build = index((step) => step.run === "vp run --workspace-root build:oxlint-qualification");
  const previous = index((step) => step.id === "previous");
  const current = index((step) => step.id === "current");
  const compare = index((step) => step.name === "Compare both complete qualifications");
  assert.ok(0 < build && build < previous && previous < current && current < compare);
  for (const arm of [steps[previous], steps[current]])
    assert.equal(arm.run, "node npm/oxlint/scripts/check-project-transport.mjs");
  assert.equal(steps[previous].env, undefined, "the original fixed counts");
  const qualification = pullRequest.jobs["pr-oxlint-project-qualification"].steps.find(
    (step: Step) => step.id === "original-project-qualification",
  );
  const { VIZE_N8N_BASELINE_MODE: mode, ...counts } = qualification.env;
  assert.equal(mode, workflow.jobs.compare.env.VIZE_N8N_BASELINE_MODE);
  assert.deepEqual(steps[current].env, counts, "exactly the PR CI counts");
  assert.deepEqual(steps[compare].env, {
    PREVIOUS: "${{ steps.previous.outputs.staging-directory }}",
    CURRENT: "${{ steps.current.outputs.staging-directory }}",
  });
  const upload = steps.at(-1)!;
  assert.equal(upload.if, "${{ always() }}");
  assert.equal(upload.with?.["if-no-files-found"], "error");
  assert.match(String(upload.with?.path), /target\/oxlint-original-project-transport\//u);
  assert.ok(!steps.some((step) => step.uses?.includes("setup-moonbit")));
});

// Two complete runs of one staged binary: the second slices the reference
// mode and runs with other process counts, PIDs, timings and owned paths.
function runs(t: TestContext) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vize-oxlint-parallelism-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (file: string, value: unknown) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, typeof value === "string" ? value : JSON.stringify(value));
  };
  const report = (files: string[], diagnostics: unknown[]) =>
    JSON.stringify({ diagnostics, number_of_files: files.length, number_of_rules: 81 });
  const finding = (filename: string) => ({ filename, code: "vize(vue/a)", message: filename });
  const make = (name: string, slices: number, run: number) => {
    const directory = path.join(root, name);
    const owned = `/tmp/run-${run}`;
    write(path.join(directory, "qualification.json"), {
      binarySha256: "same",
      qualifications: [{ version: "1.78.0", calls: 74 }],
      mixedDirectory8507: {
        sourceAfter: { cli: 45, native: 8 },
        provider: { lockSha256: "lock", engine: `${owned}/node_modules/oxlint/bin/oxlint` },
      },
    });
    const modes = [
      { mode: "stock", status: 0, elapsedMs: run },
      ...Array.from({ length: slices }, (_, index) => ({
        mode: "reference",
        status: index === slices - 1 ? 1 : 0,
        elapsedMs: run,
      })),
      { mode: "baseline", status: 1, elapsedMs: run },
    ];
    write(path.join(directory, "n8n/qualification.json"), {
      binarySha256: "same",
      files: 2,
      totals: { "host:1.78.0:reference": 102 },
      events: 100 + slices,
      processes: 3 + slices,
      nativeCallsSha256: `ledger-${run}`,
      hosts: [{ version: "1.78.0", files: 2, modes, vectorSha256: "v", original: `${owned}/o` }],
      reference: { source: "pinned", bundles: ["b"], build: { cwd: `${owned}/ref` } },
    });
    const all = ["packages/a.vue", "packages/b.vue"];
    const rows = [
      { mode: "stock", stdout: report(all, []) },
      ...(slices === 1
        ? [{ mode: "reference", stdout: report(all, [finding(all[1])]) }]
        : [
            { mode: "reference", stdout: report([all[0]], []) },
            { mode: "reference", stdout: report([all[1]], [finding(all[1])]) },
          ]),
      { mode: "baseline", stdout: report(all, [finding(all[1])]) },
      { mode: "effective", stdout: "unknown field `settings`" },
    ];
    write(path.join(directory, "n8n/1.78.0/host-results.json"), rows);
    write(
      path.join(directory, "n8n/bridge/bridge-vectors.jsonl"),
      `${JSON.stringify({ file: all[0], mode: "scopedPerRule", elapsedMs: run })}\n`,
    );
    write(
      path.join(directory, "n8n/bridge/cache-controls.jsonl"),
      `${JSON.stringify({ name: "cold", filename: `${owned}/c/Revision.vue`, result: `${owned}/c` })}\n`,
    );
    write(path.join(directory, "phase-walltime.json"), {
      phaseWalltimeMs: { total: run },
      hosts: [{ version: "1.78.0", phaseWalltimeMs: { n8nReplay: run } }],
    });
    return directory;
  };
  return { previous: make("previous", 1, 1), current: make("current", 2, 2), write };
}

void test("complete qualifications compare equal across process counts and owned paths", (t) => {
  const { previous, current } = runs(t);
  const comparison = compareQualifications(previous, current);
  assert.deepEqual(comparison.differences, []);
  assert.equal(comparison.equal, true);
  assert.deepEqual(
    [comparison.previous.processes, comparison.current.processes],
    [4, 5],
    "process topology is reported, not compared",
  );
  assert.deepEqual(
    collapseModes([
      { mode: "reference", status: 0 },
      { mode: "reference", status: 1 },
      { mode: "baseline", status: 1 },
    ]),
    [
      { mode: "reference", status: 1 },
      { mode: "baseline", status: 1 },
    ],
  );
});

void test("any changed result, vector, control, status or report is a difference", (t) => {
  const mutate = (label: string, change: (current: string) => void) => {
    const { previous, current } = runs(t);
    change(current);
    assert.deepEqual(compareQualifications(previous, current).differences, [label], label);
  };
  const edit = (file: string, change: (value: Record<string, unknown>) => void) => {
    const value = JSON.parse(fs.readFileSync(file, "utf8"));
    change(value);
    fs.writeFileSync(file, JSON.stringify(value));
  };
  mutate("qualification.json", (current) =>
    edit(path.join(current, "qualification.json"), (value) => {
      value.qualifications = [{ version: "1.78.0", calls: 73 }];
    }),
  );
  mutate("n8n/qualification.json", (current) =>
    edit(path.join(current, "n8n/qualification.json"), (value) => {
      value.totals = { "host:1.78.0:reference": 101 };
    }),
  );
  mutate("host 1.78.0 mode statuses", (current) =>
    edit(path.join(current, "n8n/qualification.json"), (value) => {
      (value.hosts as Array<{ modes: Array<{ status: number }> }>)[0].modes.at(-1)!.status = 0;
    }),
  );
  mutate("host 1.78.0 reports", (current) => {
    const file = path.join(current, "n8n/1.78.0/host-results.json");
    const rows = JSON.parse(fs.readFileSync(file, "utf8"));
    rows[1].stdout = rows[2].stdout;
    fs.writeFileSync(file, JSON.stringify(rows));
  });
  mutate("n8n bridge vectors", (current) =>
    fs.appendFileSync(path.join(current, "n8n/bridge/bridge-vectors.jsonl"), "{}\n"),
  );
  mutate("n8n cache controls", (current) =>
    fs.writeFileSync(
      path.join(current, "n8n/bridge/cache-controls.jsonl"),
      `${JSON.stringify({ name: "warm", filename: "/tmp/x/Revision.vue" })}\n`,
    ),
  );
});
