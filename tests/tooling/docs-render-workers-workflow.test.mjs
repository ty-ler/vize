import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { parse } from "yaml";

void test("whole Docs two/four comparison is manual-only, builds once and preserves full failures", () => {
  const yaml = (file) => parse(readFileSync(new URL(`../../${file}`, import.meta.url), "utf8"));
  const workflow = yaml(".github/workflows/ci-walltime-benchmark.yml");
  const job = workflow.jobs["docs-workers"];
  assert.equal(
    job.if,
    "${{ github.event_name == 'workflow_dispatch' && inputs.component == 'docs-workers' }}",
  );
  const admitted = (candidate, event, component) =>
    runInNewContext(candidate.if.slice(3, -3), {
      github: { event_name: event },
      inputs: { component },
    });
  assert.equal(admitted(job, "workflow_dispatch", "docs-workers"), true);
  for (const component of [
    "all",
    "docs",
    "js",
    "rust",
    "native",
    "n8n-baseline",
    "n8n-preparation",
  ])
    assert.equal(admitted(job, "workflow_dispatch", component), false);
  assert.equal(admitted(job, "pull_request", "docs-workers"), false);
  for (const name of ["docs", "js", "rust", "native", "n8n-baseline", "n8n-preparation"])
    assert.equal(admitted(workflow.jobs[name], "workflow_dispatch", "docs-workers"), false);
  assert.equal(job["runs-on"], "blacksmith-32vcpu-ubuntu-2404");
  assert.equal(job["timeout-minutes"], 120);
  assert.deepEqual(job.steps, [
    {
      uses: "actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd",
      with: { ref: "${{ github.sha }}" },
    },
    { uses: "./.github/actions/benchmark-docs-workers" },
  ]);
  const action = yaml(".github/actions/benchmark-docs-workers/action.yml");
  assert.equal(action.runs.using, "composite");
  const steps = action.runs.steps;
  const commands = steps.filter((step) => step.run);
  for (const step of steps) assert.equal(step["continue-on-error"], undefined);
  const build = commands.filter(({ run }) => run.includes("build:ci"));
  assert.equal(build.length, 1);
  assert.equal(
    build[0].run,
    "rust-script tools/commands/ci/github/run-many.rs vp run --filter './npm/native' build:ci -- vp run --filter './npm/cli' build -- vp run --filter './npm/builder/vite' build\nvp run --no-cache --filter './docs' build\n",
  );
  const two = steps.find(({ id }) => id === "two");
  const four = steps.find(({ id }) => id === "four");
  assert(steps.indexOf(build[0]) < steps.indexOf(two) && steps.indexOf(two) < steps.indexOf(four));
  assert.equal(two.if, undefined);
  assert.equal(four.if, "${{ !cancelled() && steps.prepare.outcome == 'success' }}");
  for (const [step, count] of [
    [two, 2],
    [four, 4],
  ]) {
    assert.equal(
      step.run,
      `vp node docs/scripts/verify-navigation-render.ts --workers ${count} --capture-timings --output "$VIZE_DOCS_WORKERS_OUTPUT/workers-${count}"`,
    );
    assert.equal(step.shell, "bash");
    assert.deepEqual(step.env, {
      VIZE_DOCS_WORKERS_OUTPUT:
        "target/ci-walltime/docs-workers/${{ github.run_id }}-${{ github.run_attempt }}",
    });
    assert.doesNotMatch(step.run, /--routes|build|timeout|continue-on-error/);
  }
  const prepare = steps.find(({ id }) => id === "prepare");
  assert(steps.indexOf(prepare) < steps.indexOf(two));
  assert.match(prepare.run, /--phase prepare/);
  const qualification = steps.find(({ run }) => run?.includes("--phase qualify"));
  assert.equal(qualification.if, "${{ !cancelled() }}");
  assert.match(
    qualification.run,
    /--baseline-outcome "\$\{\{ steps.two.outcome \}\}" --candidate-outcome "\$\{\{ steps.four.outcome \}\}"/,
  );
  const upload = steps.at(-1);
  assert.equal(upload.if, "${{ always() }}");
  assert.match(upload.uses, /^actions\/upload-artifact@[a-f0-9]{40}$/);
  assert.equal(
    upload.with.path,
    "target/ci-walltime/docs-workers/${{ github.run_id }}-${{ github.run_attempt }}/\ntarget/differential/docs-render-workers/\n",
  );
  assert.equal(upload.with["if-no-files-found"], "error");
  assert.equal(upload.with["retention-days"], 14);
});
