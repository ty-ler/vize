import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { joinHostLedgers } from "./n8n-host-sliced-replay.ts";
import {
  hostReferenceSliceCount,
  mergeSliceReports,
  orderSafeBoundaries,
  referenceSlices,
} from "./n8n-host-slices.ts";
import type { HostReport, HostSlice } from "./n8n-host-slices.ts";

// Byte order (the inventory order) and directory-walk order disagree here:
// "assistant-at-mentions/" sorts before "assistant/" by bytes, after it by
// path components. The real pinned corpus has 34 such positions.
const files = [
  "packages/a/App.vue",
  "packages/a/assistant-at-mentions/Picker.vue",
  "packages/a/assistant-at-mentions/Trail.vue",
  "packages/a/assistant/Modal.vue",
  "packages/a/assistant/components/Card.vue",
  "packages/a/assistant/components/Wizard.vue",
  "packages/a/b.vue",
  "packages/b/One.vue",
  "packages/b/Two.vue",
  "packages/c/Three.vue",
  "packages/c/x/Four.vue",
  "packages/d/Five.vue",
].sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)));
const walkOrder = (left: string, right: string) => {
  const a = left.split("/"),
    b = right.split("/");
  for (let index = 0; index < Math.min(a.length, b.length); index++) {
    const order = Buffer.compare(Buffer.from(a[index]), Buffer.from(b[index]));
    if (order !== 0) return order;
  }
  return a.length - b.length;
};
const byteOrder = (left: string, right: string) =>
  Buffer.compare(Buffer.from(left), Buffer.from(right));

// A controlled host: lints only the files it is given, reports them in one
// fixed order, and finds two ordered findings in every `every`-th input.
function lint(
  selected: readonly string[],
  order: typeof byteOrder,
  startTime: number,
  every = 3,
): HostReport {
  return {
    diagnostics: [...selected].sort(order).flatMap((filename) =>
      files.indexOf(filename) % every === 0
        ? [
            { filename, code: "vize(vue/a)", message: `${filename}:1` },
            { filename, code: "vize(vue/b)", message: `${filename}:2` },
          ]
        : [],
    ),
    number_of_files: selected.length,
    number_of_rules: 81,
    threads_count: 1,
    start_time: startTime,
  };
}
const sliced = (slices: HostSlice[], order: typeof byteOrder, every = 3) =>
  mergeSliceReports(
    files,
    slices,
    slices.map(({ start, end }, index) => lint(files.slice(start, end), order, 10 + index, every)),
  );
const withoutTime = ({ start_time: _time, ...report }: HostReport) => report;

void test("order-safe slices join to the whole-project report under either host order", () => {
  for (const order of [byteOrder, walkOrder]) {
    const whole = lint(files, order, 5);
    for (let count = 1; count <= 6; count++) {
      const slices = referenceSlices(files, count);
      assert.equal(slices.length, count);
      assert.deepEqual(withoutTime(sliced(slices, order)), withoutTime(whole), `${count} slices`);
      assert.equal(sliced(slices, order).start_time, 10);
    }
  }
  // An equal-size cut inside the disagreement would reorder walk-order output.
  const unsafe = [
    { index: 0, start: 0, end: 2 },
    { index: 1, start: 2, end: files.length },
  ];
  assert.ok(!orderSafeBoundaries(files).includes(2));
  assert.notDeepEqual(
    sliced(unsafe, walkOrder, 1).diagnostics,
    lint(files, walkOrder, 5, 1).diagnostics,
  );
  for (const order of [byteOrder, walkOrder])
    assert.deepEqual(
      sliced(referenceSlices(files, 2), order, 1).diagnostics,
      lint(files, order, 5, 1).diagnostics,
    );
});

void test("slices cover the ordered inventory once at order-safe boundaries", () => {
  const safe = orderSafeBoundaries(files);
  assert.ok(safe.length > 0 && safe.length < files.length - 1);
  for (let count = 1; count <= 6; count++) {
    const slices = referenceSlices(files, count);
    assert.deepEqual(
      slices.flatMap(({ start, end }) => files.slice(start, end)),
      files,
    );
    for (const { start } of slices.slice(1)) assert.ok(safe.includes(start), `${start} safe`);
  }
  assert.deepEqual(referenceSlices(files, 1), [{ index: 0, start: 0, end: files.length }]);
  assert.throws(() => referenceSlices(files, files.length), /order-safe/u);
  assert.throws(() => orderSafeBoundaries([files[1], files[0]]), /byte order/u);
  assert.equal(hostReferenceSliceCount({}), 1);
  assert.equal(hostReferenceSliceCount({ VIZE_N8N_HOST_REFERENCE_SLICES: "6" }), 6);
  for (const raw of ["0", "17", "1.5", "six"])
    assert.throws(() => hostReferenceSliceCount({ VIZE_N8N_HOST_REFERENCE_SLICES: raw }));
});

void test("a slice that misses, adds or miscounts an input refuses the join", () => {
  const slices = referenceSlices(files, 3);
  const reports = () =>
    slices.map(({ start, end }, index) => lint(files.slice(start, end), byteOrder, index));
  const refuse = (mutate: (candidate: HostReport[]) => void) => {
    const candidate = reports();
    mutate(candidate);
    assert.throws(() => mergeSliceReports(files, slices, candidate));
  };
  refuse((candidate) => candidate.pop());
  refuse((candidate) => {
    candidate[1].number_of_files -= 1;
  });
  refuse((candidate) => {
    candidate[0].diagnostics.push({ filename: files.at(-1) });
  });
  refuse((candidate) => {
    candidate[2].number_of_rules = 80;
  });
  refuse((candidate) => {
    candidate[1].threads_count = 2;
  });
  assert.throws(() =>
    mergeSliceReports(
      files,
      [slices[0], { ...slices[2], index: 1 }, { ...slices[1], index: 2 }],
      reports(),
    ),
  );
});

void test("per-process ledgers join in the serial host phase order with a verified index", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vize-n8n-host-ledgers-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const keys = ["stock", "reference-0", "reference-1", "baseline", "effective-original"];
  const ledgers = new Map(keys.map((key) => [key, path.join(root, key, "native-calls.jsonl")]));
  for (const [key, file] of ledgers) {
    fs.mkdirSync(path.dirname(file));
    // A phase may record nothing; its absent ledger joins as empty.
    if (key !== "effective-original") fs.writeFileSync(file, `{"phase":"${key}"}\n`);
  }
  const destination = path.join(root, "native-calls.jsonl");
  joinHostLedgers(destination, keys, ledgers, root);
  assert.equal(
    fs.readFileSync(destination, "utf8"),
    keys
      .slice(0, -1)
      .map((key) => `{"phase":"${key}"}\n`)
      .join(""),
  );
  const index = JSON.parse(fs.readFileSync(path.join(root, "ledgers.json"), "utf8"));
  assert.deepEqual(
    index.parts.map(({ key, bytes }: { key: string; bytes: number }) => [key, bytes]),
    keys.map((key) => [key, key === "effective-original" ? 0 : `{"phase":"${key}"}\n`.length]),
  );
  for (const file of ledgers.values()) assert.ok(!fs.existsSync(file), "parts are joined once");
  assert.throws(() => joinHostLedgers(destination, keys, ledgers, root), /EEXIST/u);
  const partial = path.join(root, "partial.jsonl");
  fs.writeFileSync(path.join(root, "stock", "native-calls.jsonl"), '{"phase":"stock"}');
  assert.throws(
    () => joinHostLedgers(partial, ["stock"], new Map([["stock", ledgers.get("stock")!]]), root),
    /complete ledger records/u,
  );
  assert.throws(() => joinHostLedgers(partial, ["stock", "baseline"], ledgers, root), /owned/u);
});
