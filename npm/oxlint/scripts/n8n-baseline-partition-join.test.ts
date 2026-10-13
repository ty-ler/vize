import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { TestContext } from "node:test";
import { joinBaselinePartitions } from "./n8n-baseline-join.mjs";
import {
  admittedPartition,
  baselineModes,
  baselinePartitionCount,
  baselinePartitions,
} from "./n8n-baseline-partitions.mjs";
import { effectiveRules, manifest } from "./n8n-replay-inputs.mjs";

type Range = { index: number; start: number; end: number; controls: boolean };
type Job = { partition: Range; output: string; configuration: string; calls: string };

const sha256 = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
const files = [
  "packages/frontend/@n8n/design-system/src/A.vue",
  "packages/frontend/editor-ui/src/B.vue",
  "packages/frontend/editor-ui/src/nested/C.vue",
  "packages/nodes-base/D.vue",
  "packages/nodes-base/E.vue",
  "packages/workflow/F.vue",
  "packages/workflow/G.vue",
];
const inventory = {
  fixture: "/controlled/n8n",
  files: files.map((file) => ({ file, sha256: sha256(file) })),
  disabledFiles: ["packages/frontend/editor-ui/src/B.vue"],
};
const custody = { schema: "vize.oxlint.n8n-source-native", binary: { sha256: "controlled" } };
const limits = ["controlled limit"];
const rulesFor = (file: string, mode: string) =>
  mode.startsWith("frozen") ? manifest.adoption.rules : effectiveRules(file);

// The same ordered rows, ledger lines and controls the real full-replay test
// writes for its admitted range: one input at a time, six modes per input.
function replayRange(start: number, end: number, controls: boolean, pid = 1) {
  const rows = [];
  // Each worker process records its own addon load before its calls.
  const ledger = [JSON.stringify({ kind: "load", pid })];
  for (const entry of inventory.files.slice(start, end))
    for (const [order, mode] of baselineModes.entries()) {
      const cold = [{ rule: "vue/no-v-html", diagnostics: [{ message: `${entry.file}/${mode}` }] }];
      rows.push({
        file: entry.file,
        sourceSha256: entry.sha256,
        mode,
        rules: rulesFor(entry.file, mode),
        cold,
        warm: structuredClone(cold),
        coldCalls: mode.endsWith("PerRule") ? 51 : 1,
        warmCalls: 0,
        elapsedMs: order + 1,
        cache: { capacity: 128, entries: 1 },
      });
      ledger.push(JSON.stringify({ kind: "call", pid, phase: mode, file: entry.file }));
    }
  const totals: Record<string, { coldCalls: number; warmCalls: number; elapsedMs: number }> = {};
  for (const row of rows) {
    const total = (totals[row.mode] ??= { coldCalls: 0, warmCalls: 0, elapsedMs: 0 });
    total.coldCalls += row.coldCalls;
    total.warmCalls += row.warmCalls;
    total.elapsedMs += row.elapsedMs;
  }
  const vectors = rows.map((row) => JSON.stringify(row) + "\n").join("");
  return {
    vectors,
    totals,
    ledger: ledger.map((line) => line + "\n").join(""),
    controls: controls ? '{"name":"cold","calls":1}\n' : undefined,
  };
}

function writeJob(root: string, partition: Range): Job {
  const output = path.join(root, `baseline-worker-${partition.index}`);
  const bridge = path.join(output, "bridge");
  fs.mkdirSync(bridge, { recursive: true });
  const replay = replayRange(
    partition.start,
    partition.end,
    partition.controls,
    100 + partition.index,
  );
  fs.writeFileSync(path.join(bridge, "inventory.json"), JSON.stringify(inventory));
  fs.writeFileSync(path.join(bridge, "catalog.json"), '[{"name":"vue/no-v-html"}]\n');
  fs.writeFileSync(path.join(bridge, "bridge-vectors.jsonl"), replay.vectors);
  if (replay.controls) fs.writeFileSync(path.join(bridge, "cache-controls.jsonl"), replay.controls);
  fs.writeFileSync(
    path.join(bridge, "bridge-summary.json"),
    JSON.stringify({
      totals: replay.totals,
      partition,
      files: inventory.files.length,
      scriptless: manifest.corpus.scriptlessFiles.length,
      disabledFiles: inventory.disabledFiles,
      vectorSha256: sha256(replay.vectors),
      limits,
    }),
  );
  const calls = path.join(output, "native-calls.jsonl");
  fs.writeFileSync(calls, replay.ledger);
  const configuration = path.join(output, "custody.json");
  fs.writeFileSync(configuration, JSON.stringify({ ...custody, calls }));
  return { partition, output, configuration, calls };
}

function join(t: TestContext, count: number) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vize-n8n-partition-join-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const jobs = baselinePartitions(inventory.files.length, count).map((partition: Range) =>
    writeJob(root, partition),
  );
  const output = path.join(root, "n8n");
  fs.mkdirSync(path.join(output, "bridge"), { recursive: true });
  const calls = path.join(output, "native-calls.jsonl");
  joinBaselinePartitions(inventory, { ...custody, calls }, jobs, output, {
    count,
    verify: () => inventory,
  });
  const read = (file: string) => fs.readFileSync(path.join(output, file), "utf8");
  return {
    jobs,
    vectors: read("bridge/bridge-vectors.jsonl"),
    ledger: fs.readFileSync(calls, "utf8"),
    controls: read("bridge/cache-controls.jsonl"),
    summary: JSON.parse(read("bridge/bridge-summary.json")),
  };
}

void test("fixed partition counts cover every input once, in order, with one controls owner", () => {
  for (const count of [2, 3, 5, 7]) {
    const parts = baselinePartitions(inventory.files.length, count);
    assert.equal(parts.length, count);
    assert.deepEqual(
      parts.flatMap((part: Range) =>
        Array.from({ length: part.end - part.start }, (_, i) => part.start + i),
      ),
      inventory.files.map((_, index) => index),
    );
    assert.deepEqual(
      parts.map((part: Range) => part.controls),
      parts.map((_: Range, index: number) => index === count - 1),
    );
  }
  // Two partitions keep the original 685/684 split of the 1369 inputs.
  assert.deepEqual(
    baselinePartitions(1369, 2).map((part: Range) => [part.start, part.end]),
    [
      [0, 685],
      [685, 1369],
    ],
  );
  assert.equal(baselinePartitionCount({}), 2);
  assert.equal(baselinePartitionCount({ VIZE_N8N_BASELINE_PARTITIONS: "12" }), 12);
  for (const raw of ["1", "33", "0", "-2", "2.5", " 4", "four"])
    assert.throws(() => baselinePartitionCount({ VIZE_N8N_BASELINE_PARTITIONS: raw }), raw);
  assert.throws(() => baselinePartitions(3, 4), "every partition needs one input");
  const environment = { VIZE_N8N_BASELINE_PARTITIONS: "3" };
  const expected = baselinePartitions(inventory.files.length, 3)[2];
  assert.deepEqual(
    admittedPartition(inventory, {
      ...environment,
      VIZE_N8N_BASELINE_PARTITION: JSON.stringify(expected),
    }),
    expected,
  );
  for (const candidate of [
    { ...expected, index: 3 },
    { ...expected, start: 0 },
  ])
    assert.throws(() =>
      admittedPartition(inventory, {
        ...environment,
        VIZE_N8N_BASELINE_PARTITION: JSON.stringify(candidate),
      }),
    );
  // A child that reads a different count than its parent refuses the range.
  assert.throws(() =>
    admittedPartition(inventory, { VIZE_N8N_BASELINE_PARTITION: JSON.stringify(expected) }),
  );
});

// Process identity is the only ledger difference: one load record per worker.
const calls = (ledger: string) =>
  ledger
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line))
    .filter((event) => event.kind === "call")
    .map(({ pid: _pid, ...event }) => event);
const loads = (ledger: string) =>
  ledger
    .trim()
    .split("\n")
    .filter((line) => JSON.parse(line).kind === "load").length;

void test("joined partitions equal the serial replay's vectors, calls, controls and totals", (t) => {
  const serial = replayRange(0, inventory.files.length, true);
  for (const count of [2, 3, 5, 7]) {
    const joined = join(t, count);
    assert.equal(joined.vectors, serial.vectors, `${count}: ordered vector bytes`);
    assert.deepEqual(calls(joined.ledger), calls(serial.ledger), `${count}: ordered native calls`);
    assert.equal(loads(joined.ledger), count, `${count}: one addon load per worker`);
    assert.equal(joined.controls, serial.controls, `${count}: controls exactly once`);
    assert.deepEqual(joined.summary.totals, serial.totals, `${count}: totals`);
    assert.equal(joined.summary.vectorSha256, sha256(serial.vectors));
    assert.equal(joined.summary.files, inventory.files.length);
  }
});

void test("a missing, duplicated or miscounted partition refuses the join", (t) => {
  const tamper = (count: number, mutate: (jobs: Job[]) => void, expected: RegExp | object) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "vize-n8n-partition-refusal-"));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const jobs = baselinePartitions(inventory.files.length, count).map((partition: Range) =>
      writeJob(root, partition),
    );
    mutate(jobs);
    const output = path.join(root, "n8n");
    fs.mkdirSync(path.join(output, "bridge"), { recursive: true });
    assert.throws(
      () =>
        joinBaselinePartitions(
          inventory,
          { ...custody, calls: path.join(output, "native-calls.jsonl") },
          jobs,
          output,
          { count, verify: () => inventory },
        ),
      expected,
    );
  };
  const refused = { name: "AssertionError" };
  tamper(3, (jobs) => jobs.pop(), refused);
  tamper(3, (jobs) => jobs.splice(1, 1, jobs[0]), refused);
  tamper(
    3,
    (jobs) => {
      const vectors = path.join(jobs[1].output, "bridge/bridge-vectors.jsonl");
      const rows = fs.readFileSync(vectors, "utf8").split("\n").slice(0, -1);
      rows.pop();
      fs.writeFileSync(vectors, rows.map((row) => row + "\n").join(""));
    },
    refused,
  );
  tamper(
    3,
    (jobs) => fs.rmSync(path.join(jobs[2].output, "bridge/cache-controls.jsonl")),
    /all original controls exactly once/u,
  );
});
