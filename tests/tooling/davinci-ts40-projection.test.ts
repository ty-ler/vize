import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

import {
  loadProjectionMatrix,
  validateProjectionMatrix,
  verifyProjectionDigest,
  type ProjectionDigest,
} from "./support/davinci-ts40-projection.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("TS-40 current-projection fixture matrix is explicit and non-vacuous", () => {
  const matrix = loadProjectionMatrix(root);
  validateProjectionMatrix(root, matrix);
  assert.ok(matrix.fixtures.length >= 10, "TS-40 matrix must contain at least 10 fixtures");
  assert.ok(
    matrix.unproven.some((item) => item.includes("Davinci or L2")),
    "TS-40 matrix must explicitly leave Davinci or L2 parity unproven",
  );
  assert.ok(
    matrix.normalization.some((item) => item.includes("preserve generation order")),
    "TS-40 normalization must explicitly preserve generation order",
  );
});

test("TS-40 matrix reports the fixture id when a source fixture is missing", () => {
  const matrix = loadProjectionMatrix(root);
  const fixture = matrix.fixtures[0];
  assert.ok(fixture, "TS-40 matrix must contain a fixture for the missing-source oracle");
  const missingFile = "tests/_fixtures/davinci-ts40-projection/missing.vue";

  assert.throws(
    () =>
      validateProjectionMatrix(root, {
        ...matrix,
        fixtures: [{ ...fixture, file: missingFile }, ...matrix.fixtures.slice(1)],
      }),
    {
      name: "Error",
      message: `${fixture.id} source fixture is missing: ${missingFile}`,
    },
  );
});

test("TS-40 verifier fails closed on mapping drift", () => {
  const baseline = digest();
  assert.throws(
    () => verifyProjectionDigest(baseline, { ...baseline, mappingsSha256: "f".repeat(64) }),
    /TS-40 mapping drift/,
  );
});

test("TS-40 verifier fails closed on diagnostic drift", () => {
  const baseline = digest();
  assert.throws(
    () => verifyProjectionDigest(baseline, { ...baseline, diagnosticsSha256: "f".repeat(64) }),
    /TS-40 diagnostic drift/,
  );
});

test("TS-40 baselines are wired into exact Content Mapper CI", () => {
  const workflow = fs.readFileSync(
    path.join(root, ".github/workflows/content-mapper-conformance.yml"),
    "utf8",
  );
  const parsed = parse(workflow) as {
    on: {
      schedule?: Array<{ cron: string }>;
      workflow_dispatch?: unknown;
    };
    env?: { CONTENT_MAPPER_TYPESCRIPT_SHA?: string };
    jobs?: {
      "exact-tsgo-project"?: {
        steps?: Array<{
          name?: string;
          run?: string;
          with?: { repository?: string; ref?: string };
        }>;
      };
    };
  };
  assert.deepEqual(Object.keys(parsed.on).toSorted(), ["schedule", "workflow_dispatch"]);
  assert.deepEqual(parsed.on.schedule, [{ cron: "21 4 * * *" }]);
  assert.equal(
    parsed.env?.CONTENT_MAPPER_TYPESCRIPT_SHA,
    "d6c4afddb2c55f4a9dea7b59293a99a8fdea1799",
  );

  const steps = parsed.jobs?.["exact-tsgo-project"]?.steps ?? [];
  const upstreamCheckout = steps.filter(
    (step) => step.name === "Checkout exact TypeScript Content Mapper revision",
  );
  assert.equal(upstreamCheckout.length, 1, "exact upstream checkout must run once");
  assert.equal(upstreamCheckout[0].with?.repository, "microsoft/TypeScript");
  assert.equal(upstreamCheckout[0].with?.ref, "${{ env.CONTENT_MAPPER_TYPESCRIPT_SHA }}");

  const baselineSteps = steps.filter(
    (step) => step.name === "Run TS-40 current-projection baselines",
  );
  assert.equal(baselineSteps.length, 1, "TS-40 baselines must run once in exact conformance");
  assert.deepEqual(
    baselineSteps[0].run
      ?.trim()
      .split("\n")
      .map((line) => line.trim()),
    [
      "cargo test -p vize --test davinci_ts40_projection_cli -- --nocapture",
      "cargo test -p vize_maestro --test davinci_ts40_projection -- --nocapture",
      'VIZE_TEMPLATE_EMIT_TS40_CAPTURE="$RUNNER_TEMP/content-mapper-smoke/ts40-legacy" cargo test -p vize_maestro --features legacy --test davinci_ts40_projection -- --nocapture',
      "node --test tests/tooling/davinci-ts40-projection.test.ts tests/tooling/content-mapper-manifest.test.ts",
    ],
  );
});

function digest(): ProjectionDigest {
  return {
    diagnosticsSha256: "d".repeat(64),
    mappingsSha256: "a".repeat(64),
  };
}

test("exact Content Mapper stress retains provider and whole native streams before strict failure upload", () => {
  const workflow = parse(
    fs.readFileSync(path.join(root, ".github/workflows/content-mapper-conformance.yml"), "utf8"),
  ) as {
    jobs: Record<
      string,
      {
        steps: Array<{
          name?: string;
          run?: string;
          env?: Record<string, string>;
          if?: string;
          uses?: string;
        }>;
      }
    >;
  };
  const steps = workflow.jobs["exact-tsgo-project"].steps;
  const named = (name: string) => {
    const matches = steps.filter((step) => step.name === name);
    assert.equal(matches.length, 1);
    return matches[0];
  };
  const provider = named("Preserve exact editor provider");
  const stress = named("Stress exact editor lifecycle");
  const capture = named("Preserve exact editor lifecycle streams");
  const upload = named("Preserve installed Content Mapper smoke evidence");
  assert.deepEqual(stress.env, {
    TSGO_PATH: "${{ runner.temp }}/tsgo",
    VIZE_TEST_CONTENT_MAPPER_TSGO: "${{ runner.temp }}/tsgo",
    NEXTEST_PROFILE: "full",
  });
  assert.deepEqual(stress.run?.trim().split("\n"), [
    "for iteration in $(seq 1 20); do",
    "  cargo test -p vize_maestro -- --quiet",
    '  echo "Content Mapper Maestro lifecycle cycle $iteration/20 passed"',
    "done",
  ]);
  assert.deepEqual(provider.run?.trim().split("\n"), [
    'evidence="$RUNNER_TEMP/content-mapper-smoke/native-editor"',
    'mkdir -p "$evidence"',
    'cp "$RUNNER_TEMP/tsgo" "$evidence/tsgo"',
    'sha256sum "$RUNNER_TEMP/tsgo" "$evidence/tsgo" > "$evidence/provider.sha256"',
    'go version -m "$evidence/tsgo" > "$evidence/go-build-info.txt"',
  ]);
  assert.equal(capture.if, "always()");
  assert.deepEqual(capture.run?.trim().split("\n"), [
    'evidence="$RUNNER_TEMP/content-mapper-smoke/native-editor"',
    'mkdir -p "$evidence"',
    "if [ -d target/nextest/full/native-proxy-termination ]; then",
    '  cp -R target/nextest/full/native-proxy-termination "$evidence/"',
    "fi",
  ]);
  assert.equal(upload.if, "always()");
  assert.deepEqual(
    [provider, stress, capture, upload].map((step) => steps.indexOf(step)),
    [
      steps.indexOf(stress) - 1,
      steps.indexOf(stress),
      steps.indexOf(stress) + 1,
      steps.indexOf(stress) + 2,
    ],
  );
});
