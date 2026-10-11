import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
import { dockerPhaseSelection } from "../../tools/support/compat/github/docker-phase-selection.mjs";
import { selectToolingShard } from "../../tools/support/compat/github/tooling-test-shards.ts";

void test("passive Docker selection retains the actual original shard and required consumer refusal", () => {
  const files = [
    "tests/tooling/davinci-plugin-sandbox-native.test.ts",
    "tests/tooling/davinci-plugin-sandbox.test.ts",
    "tests/tooling/ordinary.test.mjs",
    "tests/tooling/other.test.mjs",
  ];
  for (const tier of ["pr", "merge"]) {
    const plan = { version: 1, tier, tests: files };
    for (const index of [1, 2, 3, 4]) {
      const shard = `${index}/4`;
      const selection = dockerPhaseSelection(plan, files, shard);
      assert.deepEqual(selection.selectedTests, selectToolingShard(plan, shard));
      assert.deepEqual(selection.mandatoryDockerTests, index <= 2 ? [files[index - 1]] : []);
    }
    for (const shard of ["", undefined, "1/3", "5/4"]) {
      assert.throws(() => dockerPhaseSelection(plan, files, shard));
    }
    assert.throws(() =>
      dockerPhaseSelection({ ...plan, tests: [...files, files[0]] }, files, "1/4"),
    );
    assert.throws(() => dockerPhaseSelection({ ...plan, tests: ["unknown"] }, files, "1/1"));
    if (tier === "merge") {
      assert.throws(() =>
        dockerPhaseSelection({ ...plan, tests: files.slice(0, 3) }, files, "1/3"),
      );
    }
  }
});

void test("actual Docker finalizer preserves zero, partial, source and required-consumer outcomes", () => {
  const output = execFileSync(
    "python3",
    ["-B", "tests/tooling/fixtures/docker_phase_empty_laws.py"],
    {
      cwd: new URL("../../", import.meta.url),
      encoding: "utf8",
      timeout: 15000,
    },
  );
  assert.equal(output, "");
});
