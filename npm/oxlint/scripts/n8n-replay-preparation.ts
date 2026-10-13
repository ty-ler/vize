import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fixturePath } from "./n8n-replay-inputs.mjs";
import { captureProjectCommand } from "./project-command-capture.mjs";

// The qualification scripts' own laws, run before any replay input is read.
export const inputLawTests = [
  "scripts/n8n-replay-inputs.test.mjs",
  "scripts/n8n-native-custody.test.cjs",
  "scripts/ci-host-concurrency.test.mjs",
  "scripts/n8n-baseline-partitions.test.mjs",
  "scripts/n8n-baseline-partition-join.test.ts",
  "scripts/n8n-host-slices.test.ts",
  "scripts/n8n-host-sliced-replay.test.ts",
  "scripts/project-qualification-branches.test.mjs",
  "scripts/project-command-capture.test.mjs",
  "scripts/n8n-preparation-overlap.test.mjs",
  "scripts/n8n-preparation-worker.test.mjs",
  "scripts/n8n-preparation-cancellation.test.mjs",
];

// The input laws and the pinned fixture hydrate are independent, so they run
// together, before any other qualification work. Both complete outcomes are
// saved, then both must pass.
export async function runInputLawsAndHydrate({
  root,
  packageDir,
  output,
}: {
  root: string;
  packageDir: string;
  output: string;
}) {
  fs.mkdirSync(output, { recursive: true });
  const [laws, hydrate] = await Promise.all([
    captureProjectCommand(process.execPath, ["--test", ...inputLawTests], {
      cwd: packageDir,
      encoding: "utf8",
      timeout: 30_000,
      maxBuffer: 32 * 1024 * 1024,
    }),
    captureProjectCommand(
      "git",
      ["submodule", "update", "--init", "--depth", "1", "--", fixturePath],
      {
        cwd: root,
        encoding: "utf8",
        timeout: 180_000,
        maxBuffer: 32 * 1024 * 1024,
      },
    ),
  ]);
  fs.writeFileSync(path.join(output, "input-laws.json"), JSON.stringify(laws, null, 2) + "\n");
  fs.writeFileSync(path.join(output, "hydrate.json"), JSON.stringify(hydrate, null, 2) + "\n");
  for (const result of [laws, hydrate]) {
    assert.equal(result.error, undefined);
    assert.equal(result.signal, null);
    assert.equal(result.status, 0);
  }
}
