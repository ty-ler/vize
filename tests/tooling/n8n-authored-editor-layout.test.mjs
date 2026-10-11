import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import test from "node:test";
import { parse } from "yaml";
import "../../.github/actions/n8n-authored-editor/git-authority.test.mjs";
import "../../.github/actions/n8n-authored-editor/owned-process.test.mjs";
import "../../.github/actions/n8n-authored-editor/bucket-observations.test.mjs";

const before = "b63d18511ce087e5ef9f6b1da17031f258ef7276";
const workflowPath = ".github/workflows/n8n-adoption.yml";
const document = "docs/davinci/decisions/2026-10-11-3952-current-main-qualification.md";
const old = (file) => execFileSync("git", ["show", `${before}:${file}`], { encoding: "utf8" });
const read = (file) => fs.readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");

void test("all five original native commands retain order, conditions, shell, environment and working directory", () => {
  const original = parse(old(workflowPath));
  const current = parse(read(workflowPath));
  const originalJob = original.jobs["authored-editor"];
  const currentJob = current.jobs["authored-editor"];
  const action = parse(read(".github/actions/n8n-authored-editor/action.yml"));
  assert.equal(action.runs.using, "composite");
  const start = originalJob.steps.findIndex(
    (step) => step.name === "Install pinned source and typechecker dependencies",
  );
  assert.ok(start >= 0);
  const five = originalJob.steps.slice(start, start + 5);
  assert.equal(five[4].name, "Preserve ordinary default-export navigation");
  assert.deepEqual(
    action.runs.steps.map((step) => {
      assert.equal(step.shell, "bash -e {0}");
      const { shell: _shell, ...command } = step;
      return command;
    }),
    five,
  );
  assert.deepEqual(current.env, original.env);
  assert.deepEqual(currentJob.env, originalJob.env);
  assert.deepEqual(current.defaults, original.defaults);
  assert.deepEqual(currentJob.defaults, originalJob.defaults);
  const index = currentJob.steps.findIndex(
    (step) => step.uses === "./.github/actions/n8n-authored-editor",
  );
  assert.equal(index, start);
  assert.deepEqual(currentJob.steps[index], { uses: "./.github/actions/n8n-authored-editor" });
  assert.deepEqual(currentJob.steps.slice(0, index), originalJob.steps.slice(0, start));
  const normalize = (steps) =>
    steps.filter((step) => !step.name?.startsWith("Count native fact bucket"));
  assert.deepEqual(
    normalize(currentJob.steps.slice(index + 1)),
    normalize(originalJob.steps.slice(start + 5)),
  );
  const originalDiagnostic = originalJob.steps.find((step) =>
    step.name?.startsWith("Count native fact bucket"),
  );
  const currentDiagnostic = currentJob.steps.find((step) =>
    step.name?.startsWith("Count native fact bucket"),
  );
  const { run: originalRun, ...originalFields } = originalDiagnostic;
  const { run: currentRun, ...currentFields } = currentDiagnostic;
  assert.deepEqual(currentFields, originalFields);
  const first = originalRun.split("\n")[0];
  assert.ok(
    read(".github/actions/n8n-authored-editor/capture-buckets.sh").includes(`\n${first}\n`),
  );
  assert.equal(
    currentRun,
    originalRun
      .split("\n")
      .slice(1)
      .join("\n")
      .replace(/ \\\n\s*/gu, " ")
      .trim(),
  );
  assert.ok(read(workflowPath).split("\n").length - 1 <= 350);
  assert.ok(read(".github/workflows/pr-source-checks.yml").split("\n").length - 1 <= 350);
});

void test("the whole original CPU and exact-input parser record survives the readable companion split", () => {
  const marker = "## Cold graph CPU attribution and measured private bucket successor\n";
  const original = old(document);
  assert.equal(original.split(marker).length, 2);
  const section = original.split(marker)[1];
  const companionPath = "docs/davinci/decisions/2026-10-12-3952-native-graph-cpu-attribution.md";
  const companion = read(companionPath);
  assert.ok(companion.endsWith(section));
  assert.ok(read(document).startsWith(original.split(marker)[0]));
  assert.ok(read(document).includes("./2026-10-12-3952-native-graph-cpu-attribution.md"));
  for (const file of [document, companionPath]) assert.ok(read(file).split("\n").length - 1 <= 350);
});
