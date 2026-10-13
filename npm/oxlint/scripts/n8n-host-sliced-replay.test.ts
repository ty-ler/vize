import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { TestContext } from "node:test";
import { qualifyN8nHost } from "./n8n-host-replay.mjs";
import { qualifyN8nHostSliced } from "./n8n-host-sliced-replay.ts";

const sha256 = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
// Byte and directory-walk order disagree inside "assistant*", as in n8n.
const files = [
  "packages/a/App.vue",
  "packages/a/assistant-at-mentions/Picker.vue",
  "packages/a/assistant-at-mentions/Trail.vue",
  "packages/a/assistant/Modal.vue",
  "packages/a/assistant/components/Card.vue",
  "packages/a/assistant/components/Trace.vue",
  "packages/a/b.vue",
  "packages/b/One.vue",
  "packages/b/Two.vue",
  "packages/c/Three.vue",
  "packages/c/x/Four.vue",
  "packages/d/Five.vue",
].sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)));

// A controlled host for every entrypoint: it walks `packages` in directory
// order, records one load and one call per input in the owned ledger, finds a
// foreign error in every input whose name contains "T", and refuses
// override settings the way both pinned hosts do.
const host = `
import fs from "node:fs";
import path from "node:path";
const args = process.argv.slice(2);
const config = fs.readFileSync(args[args.indexOf("-c") + 1], "utf8");
const custody = JSON.parse(fs.readFileSync(process.env.VIZE_N8N_NATIVE_CUSTODY, "utf8"));
const phase = process.env.VIZE_N8N_REPLAY_PHASE;
const record = (row) => fs.appendFileSync(custody.calls, JSON.stringify({ pid: process.pid, phase, entry: path.basename(process.argv[1]), ...row }) + "\\n");
record({ kind: "load" });
if (/"overrides"[\\s\\S]*"settings"/u.test(config)) {
  process.stdout.write("Failed to parse config: unknown field \`settings\`\\n");
  process.exit(1);
}
const walk = (directory) => fs.readdirSync(directory, { withFileTypes: true })
  .sort((a, b) => Buffer.compare(Buffer.from(a.name), Buffer.from(b.name)))
  .flatMap((entry) => entry.isDirectory() ? walk(path.join(directory, entry.name)) : [path.join(directory, entry.name)]);
const linted = walk(path.join(process.cwd(), "packages"));
const diagnostics = [];
for (const file of linted) {
  record({ kind: "call", filename: file });
  const filename = path.relative(process.cwd(), file);
  if (path.basename(file).includes("T"))
    diagnostics.push({ filename, code: "vue(no-dupe-keys)", severity: "error", message: "dupe " + filename, labels: [{ span: { offset: 0, length: 1 } }] });
}
process.stdout.write(JSON.stringify({ diagnostics, number_of_files: linted.length, number_of_rules: 81, threads_count: 1, start_time: Date.now() / 1000 }));
process.exit(diagnostics.length ? 1 : 0);
`;

function fixture(t: TestContext) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "vize-n8n-sliced-host-")));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const corpus = path.join(root, "fixture");
  for (const file of files) {
    fs.mkdirSync(path.dirname(path.join(corpus, file)), { recursive: true });
    fs.writeFileSync(path.join(corpus, file), `<template>${file}</template>\n`);
  }
  const inventory = {
    fixture: corpus,
    files: files.map((file) => ({ file, sha256: sha256(`<template>${file}</template>\n`) })),
    disabledFiles: [],
  };
  const entrypoints = Object.fromEntries(
    ["oxlint", "wrapper", "reference-wrapper"].map((name) => {
      const file = path.join(root, "bin", `${name}.mjs`);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, host);
      return [name, file];
    }),
  );
  const run = (name: string) => {
    const n8n = path.join(root, name, "n8n");
    const output = path.join(n8n, "1.78.0");
    fs.mkdirSync(path.join(n8n, "bridge"), { recursive: true });
    fs.mkdirSync(output, { recursive: true });
    fs.writeFileSync(
      path.join(n8n, "bridge/bridge-vectors.jsonl"),
      files
        .map((file) => JSON.stringify({ mode: "scopedPerRule", file, cold: [] }) + "\n")
        .join(""),
    );
    const custody = {
      calls: path.join(output, "native-calls.jsonl"),
      sources: path.join(output, "sources"),
    };
    const custodyPath = path.join(output, "custody.json");
    fs.writeFileSync(custodyPath, JSON.stringify(custody));
    return { output, custody, environment: { VIZE_N8N_NATIVE_CUSTODY: custodyPath } };
  };
  const reference = {
    plugin: "/reference/dist/index.mjs",
    wrapper: entrypoints["reference-wrapper"],
  };
  const options = { verify: () => inventory, wrapper: entrypoints.wrapper };
  return { root, inventory, engine: entrypoints.oxlint, reference, options, run };
}

const events = (ledger: string) =>
  fs
    .readFileSync(ledger, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
// Process identity and owned temporary roots are the only run-specific fields.
const calls = (ledger: string) =>
  events(ledger)
    .filter(({ kind }) => kind === "call")
    .map(({ phase, entry, filename }) => ({
      phase,
      entry,
      file: filename.slice(filename.indexOf("/packages/") + 1),
    }));
const reports = (output: string, mode: string) =>
  JSON.parse(fs.readFileSync(path.join(output, "host-results.json"), "utf8"))
    .filter((row: { mode: string }) => row.mode === mode)
    .map((row: { stdout: string }) => JSON.parse(row.stdout));

void test("sliced reference replay aggregates exactly as the serial host replay", async (t) => {
  const f = fixture(t);
  const serialRun = f.run("serial");
  const serial = qualifyN8nHost(
    f.engine,
    "1.78.0",
    serialRun.output,
    serialRun.environment,
    f.reference,
    f.options,
  );
  for (const count of [2, 4]) {
    const slicedRun = f.run(`sliced-${count}`);
    const sliced = await qualifyN8nHostSliced(
      f.engine,
      "1.78.0",
      slicedRun.output,
      slicedRun.custody,
      slicedRun.environment,
      f.reference,
      count,
      f.options,
    );
    assert.equal(sliced.referenceSlices.length, count);
    assert.deepEqual(
      sliced.referenceSlices.flatMap(({ start, end }) => files.slice(start, end)),
      files,
    );
    for (const root of [sliced.original, ...sliced.referenceSlices.map(({ root }) => root)])
      assert.ok(!fs.existsSync(root), "owned roots are removed");
    const { modes: serialModes, ...serialSummary } = serial;
    const { modes: slicedModes, ...slicedSummary } = sliced;
    const comparable = ({
      original: _o,
      referenceSlices: _r,
      ...summary
    }: Record<string, unknown>) => summary;
    assert.deepEqual(comparable(slicedSummary), comparable(serialSummary));
    // One row per slice; the joined status is the highest slice status.
    type Mode = { mode: string; status: number };
    const collapse = (modes: Mode[]) =>
      modes.reduce<Mode[]>(
        (rows, { mode, status }) =>
          rows.at(-1)?.mode === mode
            ? [...rows.slice(0, -1), { mode, status: Math.max(rows.at(-1)!.status, status) }]
            : [...rows, { mode, status }],
        [],
      );
    assert.equal(slicedModes.filter(({ mode }: Mode) => mode === "reference").length, count);
    assert.deepEqual(
      collapse(slicedModes),
      serialModes.map(({ mode, status }: Mode) => ({ mode, status })),
    );
    // The joined reference report is the whole-project report.
    const [whole] = reports(serialRun.output, "reference");
    const parts = reports(slicedRun.output, "reference");
    assert.deepEqual(
      parts.flatMap((part: { diagnostics: unknown[] }) => part.diagnostics),
      whole.diagnostics,
    );
    // The joined ledger holds the serial run's calls in the serial order;
    // only one load per extra reference process is added.
    assert.deepEqual(calls(slicedRun.custody.calls), calls(serialRun.custody.calls));
    const loads = (ledger: string) => events(ledger).filter(({ kind }) => kind === "load").length;
    assert.equal(loads(slicedRun.custody.calls), loads(serialRun.custody.calls) + count - 1);
    const index = JSON.parse(
      fs.readFileSync(path.join(slicedRun.output, "ledgers/ledgers.json"), "utf8"),
    );
    assert.equal(index.joined.sha256, sha256(fs.readFileSync(slicedRun.custody.calls)));
    assert.equal(
      index.parts.reduce((sum: number, part: { bytes: number }) => sum + part.bytes, 0),
      index.joined.bytes,
    );
    assert.deepEqual(
      fs.readdirSync(slicedRun.custody.sources).sort(),
      [...new Set(f.inventory.files.map(({ sha256: digest }) => `${digest}.vue`))].sort(),
    );
  }
});

void test("a failed slice refuses the host after every slice settles and retains evidence", async (t) => {
  const f = fixture(t);
  const broken = path.join(f.root, "bin", "broken-reference.mjs");
  fs.writeFileSync(
    broken,
    `if (process.cwd().length) { process.stderr.write("refused slice"); process.exit(2); }`,
  );
  const slicedRun = f.run("sliced-broken");
  await assert.rejects(
    qualifyN8nHostSliced(
      f.engine,
      "1.78.0",
      slicedRun.output,
      slicedRun.custody,
      slicedRun.environment,
      { ...f.reference, wrapper: broken },
      3,
      f.options,
    ),
    AggregateError,
  );
  const rows = JSON.parse(
    fs.readFileSync(path.join(slicedRun.output, "host-results.json"), "utf8"),
  );
  assert.equal(rows.filter(({ mode }: { mode: string }) => mode === "reference").length, 3);
  assert.ok(rows.some(({ mode }: { mode: string }) => mode === "effective-original"));
  assert.ok(!fs.existsSync(slicedRun.custody.calls), "no joined ledger without every phase");
});
