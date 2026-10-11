import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parse } from "yaml";

const read = (file) => readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
const source = parse(read(".github/workflows/pr-source-checks.yml"));
const upload = parse(read(".github/actions/upload-formatter-api-corpus-evidence/action.yml"));

void test("passive Docker capture keeps original tooling commands, full gates and failure artifacts", () => {
  const job = source.jobs["pr-tooling-scripts"];
  assert.equal(job["runs-on"], "blacksmith-32vcpu-ubuntu-2404");
  assert.equal(job["timeout-minutes"], 35);
  assert.equal(job.strategy["fail-fast"], false);
  assert.equal(
    job.env.VIZE_DOCKER_PHASE_CAPTURE,
    "${{ github.event_name == 'pull_request' && contains(github.event.pull_request.labels.*.name, 'ci-docker-phase-diagnostic') }}",
  );
  const steps = job.steps;
  const original = ["Test selected PR tooling scripts", "Test tooling scripts"];
  for (const [index, name] of original.entries()) {
    const step = steps.find((candidate) => candidate.name === name);
    assert.equal(step.run, `vp run --workspace-root test:scripts:${index ? "planned" : "pr"}`);
    assert.equal(step["continue-on-error"], undefined);
    assert.equal(
      step.env.VIZE_TOOLING_TEST_SHARD,
      "${{ format('{0}/{1}', matrix.index, matrix.total) }}",
    );
  }
  const prepare = steps.find((step) => step.name === "Prepare the pinned plugin isolation runtime");
  const plan = steps.find((step) => step.name === "Regenerate tooling plan");
  assert.match(
    plan.run,
    /plan-tooling-tests\.mjs.*&& if \[\[ "\$VIZE_DOCKER_PHASE_CAPTURE" == true \]\]; then python3 tools\/support\/compat\/github\/docker-phase-evidence\.py prepare; fi/,
  );
  assert(steps.indexOf(plan) < steps.indexOf(prepare));
  assert.equal(
    prepare.run,
    'vp exec node tools/support/compat/davinci/plugin-sandbox-image.mjs && if [[ "$VIZE_DOCKER_PHASE_CAPTURE" == true ]]; then python3 tools/support/compat/github/docker-phase-evidence.py start; fi',
  );
  const [product, finish, diagnostic] = upload.runs.steps;
  assert.equal(product.name, "Upload differential product corpus evidence");
  assert.equal(product.with.path, "target/differential/\ntarget/ci/vize.differential-build.json\n");
  assert.equal(product.with["if-no-files-found"], "warn");
  assert.equal(finish.if, "${{ always() && env.VIZE_DOCKER_PHASE_CAPTURE == 'true' }}");
  assert.equal(diagnostic.if, finish.if);
  assert.equal(finish.run, "python3 tools/support/compat/github/docker-phase-evidence.py finish");
  assert.equal(diagnostic.with.path, "target/ci-docker-phase/");
  assert.equal(diagnostic.with["if-no-files-found"], "error");
  assert.equal(source.jobs["source-report"].if, "${{ always() }}");
  assert(source.jobs["source-report"].needs.includes("pr-tooling-scripts"));
});

void test("real Python process/source refusal controls retain bounded passive authority", () => {
  const output = execFileSync("python3", ["tests/tooling/fixtures/docker_phase_laws.py"], {
    cwd: new URL("../../", import.meta.url),
    encoding: "utf8",
    timeout: 15000,
  });
  assert.equal(output, "");
});
