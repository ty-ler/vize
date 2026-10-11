import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
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
  const checkout = steps.find(({ run }) => run?.includes("--phase checkout"));
  assert(checkout && steps.indexOf(checkout) < steps.indexOf(build[0]));
  assert.equal(
    build[0].run,
    "rust-script tools/commands/ci/github/run-many.rs vp run --filter './npm/native' build:ci -- vp run --filter './npm/cli' build -- vp run --filter './npm/builder/vite' build\nvp run --no-cache --filter './docs' build --output \"$VIZE_DOCS_WORKERS_BUILD_EVIDENCE\"\n",
  );
  for (const step of [
    checkout,
    build[0],
    steps.find(({ id }) => id === "prepare"),
    steps.find(({ run }) => run?.includes("--phase qualify")),
  ])
    assert.equal(
      step.env.VIZE_DOCS_WORKERS_BUILD_EVIDENCE,
      "${{ runner.temp }}/vize-docs-workers/${{ github.run_id }}-${{ github.run_attempt }}/component-previews",
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
    "target/ci-walltime/docs-workers/${{ github.run_id }}-${{ github.run_attempt }}/\ntarget/differential/docs-render-workers/\n${{ runner.temp }}/vize-docs-workers/${{ github.run_id }}-${{ github.run_attempt }}/component-previews/\n",
  );
  assert.equal(upload.with["if-no-files-found"], "error");
  assert.equal(upload.with["retention-days"], 14);
});

void test("real VP forwards the supported output option only to the original final chained proof", async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "vize-docs-build-output-")));
  try {
    await writeFile(
      path.join(root, "package.json"),
      JSON.stringify({
        name: "authored-docs-output-proof",
        private: true,
        scripts: {
          build: "node first.mjs && pnpm check:ui-docs",
          "check:ui-docs": "node last.mjs",
        },
      }),
    );
    await writeFile(
      path.join(root, "first.mjs"),
      'import assert from "node:assert/strict";import{writeFileSync}from"node:fs";assert.deepEqual(process.argv.slice(2),[]);writeFileSync("first.json","[]");if(process.env.AUTHORED_FIRST_FAIL)process.exit(23);',
    );
    await writeFile(
      path.join(root, "last.mjs"),
      'import{parseArgs}from"node:util";import{writeFileSync}from"node:fs";const{values}=parseArgs({options:{output:{type:"string"}}});writeFileSync("last.json",JSON.stringify(values));',
    );
    const output = path.join(root, "original-proof-output");
    const args = ["run", "--no-cache", "build", "--output", output];
    const invoke = (extraEnv = {}) =>
      spawnSync("vp", args, { cwd: root, encoding: "utf8", env: { ...process.env, ...extraEnv } });
    const positive = invoke();
    assert.equal(positive.status, 0, `${positive.stdout}\n${positive.stderr}`);
    assert.deepEqual(JSON.parse(await readFile(path.join(root, "first.json"), "utf8")), []);
    assert.deepEqual(JSON.parse(await readFile(path.join(root, "last.json"), "utf8")), { output });
    await rm(path.join(root, "last.json"));
    const failed = invoke({ AUTHORED_FIRST_FAIL: "true" });
    assert.notEqual(failed.status, 0);
    await assert.rejects(() => readFile(path.join(root, "last.json")), /ENOENT/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
