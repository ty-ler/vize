import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { rejectOverrides } from "./installed.ts";
import {
  cliPacket,
  config,
  policyCase,
  policySource,
  save,
  unchanged,
  write,
  type ComponentCase,
} from "./component_inputs.ts";

function invoke(binary: string, root: string, filename: string, selection: string[]) {
  rejectOverrides();
  const args = [
    "lint",
    filename,
    "--format",
    "json",
    "--locale",
    "en",
    "--help-level",
    "full",
    ...selection,
  ];
  const actual = spawnSync(binary, args, {
    cwd: root,
    timeout: 30_000,
    maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, NO_COLOR: "1" },
  });
  return {
    args,
    status: actual.status,
    signal: actual.signal,
    stdout: actual.stdout?.toString("utf8") ?? "",
    stderr: actual.stderr?.toString("utf8") ?? "",
    stdoutBase64: actual.stdout?.toString("base64") ?? "",
    stderrBase64: actual.stderr?.toString("base64") ?? "",
    error: actual.error ? String(actual.error) : null,
  };
}
function requirePacket(actual: ReturnType<typeof invoke>, expected: unknown) {
  assert.equal(actual.error, null);
  assert.equal(actual.signal, null);
  assert.equal(actual.status, 0);
  assert.equal(actual.stderr, "");
  assert.equal(
    Buffer.from(actual.stdout).toString("base64"),
    actual.stdoutBase64,
    "complete valid UTF-8 CLI stdout",
  );
  assert.equal(actual.stderrBase64, "");
  assert.deepEqual(JSON.parse(actual.stdout), expected);
}
export function observeCli(
  binary: string,
  workspace: string,
  output: string,
  entries: ComponentCase[],
) {
  const observations = [];
  for (const entry of entries) {
    const root = path.join(workspace, entry.id),
      settings = JSON.stringify(config(entry));
    write(root, entry.filename, entry.source);
    write(root, "vize.config.json", settings);
    for (const selection of [[], ["--config", "vize.config.json"], ["--config", "."]])
      for (const repeat of [1, 2]) {
        observations.push({
          caseId: entry.id,
          source: entry.source,
          config: config(entry),
          repeat,
          expected: cliPacket(entry),
          actual: invoke(binary, root, entry.filename, selection),
        });
        save(output, "cli-transport.json", { executable: binary, observations });
      }
    unchanged(root, entry.filename, entry.source);
    unchanged(root, "vize.config.json", settings);
  }
  assert.equal(observations.length, 180);
  for (const { actual, expected } of observations) requirePacket(actual, expected);
  return { packets: observations.length };
}
export function observeOneEvaluation(binary: string, workspace: string, output: string) {
  const settings = `import {readFileSync,writeFileSync,existsSync} from 'node:fs';
const file = new URL('./evaluations.txt', import.meta.url);
const previous = existsSync(file) ? Number(readFileSync(file, 'utf8')) : 0;
writeFileSync(file, String(previous + 1));
export default {
  compiler: {customElements: ['my-owned']},
  linter: {preset: 'incremental', rules: {'vue/require-component-registration': 'warn'}}
};
`;
  write(workspace, "Evaluation.vue", policySource);
  write(workspace, "vize.config.mjs", settings);
  const expected = cliPacket(policyCase(["my-owned"]), "Evaluation.vue"),
    observations = [];
  for (const selection of [[], ["--config", "vize.config.mjs"], ["--config", "."]])
    for (const repeat of [1, 2]) {
      const actual = invoke(binary, workspace, "Evaluation.vue", selection);
      let evaluations: string | null = null,
        counterError: string | null = null;
      try {
        evaluations = readFileSync(path.join(workspace, "evaluations.txt"), "utf8");
      } catch (error) {
        counterError = error instanceof Error ? error.message : JSON.stringify(error);
      }
      observations.push({
        repeat,
        actual,
        evaluations,
        counterError,
      });
      save(output, "cli-one-evaluation.json", {
        source: policySource,
        settings,
        expected,
        observations,
      });
    }
  assert.equal(observations.length, 6);
  for (const [index, observation] of observations.entries()) {
    assert.equal(observation.counterError, null);
    assert.equal(observation.evaluations, String(index + 1));
    requirePacket(observation.actual, expected);
  }
  unchanged(workspace, "Evaluation.vue", policySource);
  unchanged(workspace, "vize.config.mjs", settings);
  return { packets: observations.length };
}
