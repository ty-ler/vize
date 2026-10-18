import assert from "node:assert/strict";
import { parse, stringify } from "yaml";
import { checkWorkflowJobSources, readRepoFile } from "./github-workflows.ts";
import { fullDifferentialProducers } from "../../../tools/support/compat/github/full-rust-differential.ts";

type Step = Record<string, unknown> & {
  name?: string;
  run?: string;
  uses?: string;
  if?: string;
  env?: Record<string, unknown>;
  with?: Record<string, unknown>;
};
type Job = Record<string, unknown> & { steps?: Step[]; env?: Record<string, unknown> };

/** Legacy recipe readers retain their complete assertions after strict actual-topology validation. */
export function serialFullQualificationJobSources() {
  const workflow = parse(checkWorkflowJobSources()) as { jobs: Record<string, Job> };
  restoreSerialFullDifferential(workflow.jobs);
  return stringify(workflow, { lineWidth: 0 });
}
const full = "${{ github.event_name == 'schedule' || github.event_name == 'workflow_dispatch' }}";
const checkout = { uses: "actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd" };
const node = {
  uses: "actions/setup-node@249970729cb0ef3589644e2896645e5dc5ba9c38",
  with: { "node-version-file": "package.json", "package-manager-cache": false },
};

/** Strict finite inverse; every other field still participates in the frozen whole-job hash. */
export function restoreSerialFullDifferential(input: Record<string, unknown>) {
  const jobs = input as Record<string, Job>;
  const fixture = parse(readRepoFile("tests/_fixtures/ci/check-clippy-and-test.original.yml.txt"))[
    "clippy-and-test"
  ] as Job;
  const originalSteps = fixture.steps!;
  const commandStart = originalSteps.findIndex((step) => step.name === "Clippy");
  const tailStart = originalSteps.findIndex(
    (step) => step.name === "Install Pkl CLI and hydrate pinned native fixture",
  );
  assert.ok(commandStart > 0 && tailStart > commandStart);
  const setup = originalSteps.slice(0, commandStart);
  const action = parse(readRepoFile(".github/actions/test-full-rust-differential/action.yml"));
  assert.deepEqual(action.inputs, {
    role: {
      description: "One normative full differential lane or native-navigation or native-ssr",
      required: true,
    },
  });
  assert.equal(action.runs.using, "composite");
  const steps = action.runs.steps as Step[];
  const originalSetup = [...setup.slice(1), originalSteps[tailStart]];
  assert.deepEqual(
    steps.slice(0, originalSetup.length).map((step) => {
      const copy = structuredClone(step);
      if (copy.run) {
        assert.equal(copy.shell, "bash");
        delete copy.shell;
      }
      return copy;
    }),
    originalSetup,
  );
  const recipe = parse(readRepoFile(".github/actions/test-rust-workspace-differential/action.yml"));
  assert.deepEqual(steps[6], recipe.runs.steps[0]);
  for (const [index, role, id, uses] of [
    [7, "native-navigation", "navigation", "./.github/actions/test-native-navigation"],
    [8, "native-ssr", "ssr", "./.github/actions/test-native-ssr"],
  ] as const)
    assert.deepEqual(steps[index], {
      name:
        index === 7
          ? "Test native Program and Vue navigation responses"
          : "Test fresh native SSR modules",
      id,
      if: `\${{ inputs.role == '${role}' }}`,
      env: { VIZE_TEST_REQUIRE_TSGO: "1" },
      uses,
    });
  assert.deepEqual(steps[9], {
    name: "Test complete feature-enabled differential lane",
    id: "features",
    if: "${{ inputs.role != 'native-navigation' && inputs.role != 'native-ssr' }}",
    shell: "bash",
    env: { VIZE_TEST_REQUIRE_TSGO: "1", DIFFERENTIAL_LANE: "${{ inputs.role }}" },
    run: 'node tools/support/compat/github/rust-differential-lanes.ts --full-lane "$DIFFERENTIAL_LANE"',
  });
  assert.deepEqual(steps.slice(10), [
    {
      name: "Record actual full differential outcome",
      if: "${{ always() }}",
      shell: "bash",
      env: {
        VIZE_TEST_REQUIRE_TSGO: "1",
        DIFFERENTIAL_ROLE: "${{ inputs.role }}",
        DIFFERENTIAL_OUTCOME:
          "${{ steps.navigation.outcome != 'skipped' && steps.navigation.outcome || steps.ssr.outcome != 'skipped' && steps.ssr.outcome || steps.features.outcome }}",
      },
      run: 'node tools/support/compat/github/full-rust-differential.ts record "$DIFFERENTIAL_ROLE" "$DIFFERENTIAL_OUTCOME"',
    },
    {
      name: "Preserve source-bound full differential result",
      if: "${{ always() }}",
      uses: "actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a",
      with: {
        name: "full-rust-differential-${{ github.run_id }}-${{ github.run_attempt }}-${{ github.sha }}-${{ inputs.role }}",
        path: "${{ runner.temp }}/full-rust-differential/${{ inputs.role }}.json",
        "if-no-files-found": "error",
        "retention-days": 7,
      },
    },
    {
      uses: "./.github/actions/retain-sfc-runtime",
      if: "${{ always() }}",
      with: { suffix: "-${{ inputs.role }}" },
    },
  ]);
  const base = {
    "runs-on": fixture["runs-on"],
    if: full,
    "timeout-minutes": 45,
    env: fixture.env,
  };
  for (const [id, role] of [
    ["full-native-navigation", "native-navigation"],
    ["full-native-ssr", "native-ssr"],
  ])
    assert.deepEqual(jobs[id], {
      ...base,
      steps: [checkout, { uses: "./.github/actions/test-full-rust-differential", with: { role } }],
    });
  assert.deepEqual(jobs["full-rust-differential"], {
    name: "Full differential (${{ matrix.lane }})",
    ...base,
    needs: ["full-differential-plan"],
    strategy: {
      "fail-fast": false,
      "max-parallel": 4,
      matrix: "${{ fromJSON(needs.full-differential-plan.outputs.matrix) }}",
    },
    steps: [
      checkout,
      {
        uses: "./.github/actions/test-full-rust-differential",
        with: { role: "${{ matrix.lane }}" },
      },
    ],
  });
  assert.deepEqual(jobs["full-differential-plan"], {
    "runs-on": "ubuntu-24.04",
    if: full,
    "timeout-minutes": 5,
    outputs: { matrix: "${{ steps.plan.outputs.matrix }}" },
    steps: [
      checkout,
      node,
      {
        id: "plan",
        run: 'node tools/support/compat/github/full-rust-differential.ts matrix >> "$GITHUB_OUTPUT"',
      },
    ],
  });
  assert.deepEqual(jobs["rust-native-differential"], {
    "runs-on": "ubuntu-24.04",
    if: "${{ always() && (github.event_name == 'schedule' || github.event_name == 'workflow_dispatch') }}",
    "timeout-minutes": 5,
    needs: [...fullDifferentialProducers],
    steps: [
      checkout,
      node,
      {
        name: "Require all native and complete differential producers",
        env: { NEEDS_JSON: "${{ toJSON(needs) }}" },
        run: "node tools/support/compat/github/require-needs-success.ts",
      },
      {
        uses: "actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c",
        with: {
          pattern: "full-rust-differential-${{ github.run_id }}-*-${{ github.sha }}-*",
          path: ".artifacts/full-rust-differential",
        },
      },
      {
        name: "Require every exact-source full differential outcome",
        env: { NEEDS_JSON: "${{ toJSON(needs) }}" },
        run: "node tools/support/compat/github/full-rust-differential.ts verify .artifacts/full-rust-differential",
      },
    ],
  });
  for (const id of ["full-differential-plan", ...fullDifferentialProducers]) delete jobs[id];
  jobs["rust-native-differential"] = {
    ...base,
    steps: [...setup, ...originalSteps.slice(tailStart)],
  };
  // Replacing the existing property retains its original insertion position;
  // the immutable seventeen-job witness also checks every object's order.
}
