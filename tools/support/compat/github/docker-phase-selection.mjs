import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { toolingTestCommand } from "./run-tooling-tests.mjs";

const mandatoryDockerTests = [
  "tests/tooling/davinci-plugin-sandbox-native.test.ts",
  "tests/tooling/davinci-plugin-sandbox.test.ts",
];

// This records known mandatory consumers. An empty cohort proves no lifecycle
// outcome and does not claim that unknown future tests cannot invoke Docker.
export function dockerPhaseSelection(plan, available, shard) {
  if (typeof shard !== "string" || !/^[1-4]\/[1-4]$/.test(shard)) {
    throw new Error("Actual tooling shard index/count required");
  }
  const selectedTests = toolingTestCommand(plan, available, shard).slice(2);
  return {
    shard,
    selectedTests,
    mandatoryDockerTests: selectedTests.filter((file) => mandatoryDockerTests.includes(file)),
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [planFile, shard] = process.argv.slice(2);
  const content = readFileSync(planFile);
  if (content.length > 262144) throw new Error("Tooling plan exceeded finite bound");
  process.stdout.write(
    JSON.stringify({
      ...dockerPhaseSelection(JSON.parse(content), undefined, shard),
      planSha256: createHash("sha256").update(content).digest("hex"),
    }),
  );
}
