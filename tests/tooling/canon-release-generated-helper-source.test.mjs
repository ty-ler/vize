import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { test } from "node:test";

const root = path.resolve(import.meta.dirname, "../..");
const prefix = "tests/_fixtures/differential/canon/release-js-pragma-opaque-slots/";
const sha = (body) => createHash("sha256").update(body).digest("hex");
const blob = (body) =>
  createHash("sha1").update(`blob ${body.length}\0`).update(body).digest("hex");
function regular(file) {
  let target = root;
  for (const part of file.split("/")) {
    target = path.join(target, part);
    assert(!fs.lstatSync(target).isSymbolicLink(), target);
  }
  const stat = fs.lstatSync(target);
  assert(stat.isFile() && (stat.mode & 0o777) === 0o644);
  return fs.readFileSync(target);
}
const metadata = regular(prefix + "generated-snapshot-successor.json");
assert.equal(sha(metadata), "593f3d81c31b22cd5a66d9a77f80f7cff29ea3377798400b2854f740b558d4da");
const data = JSON.parse(metadata);
assert.equal(data.schema, 1);
assert.equal(data.sourceOnly, true);
assert.equal(data.runtimeCredit, false);
assert.equal(data.nativeProducerCredit, false);
const compressed = regular(prefix + "generated-snapshot-originals.json.gz");
assert.equal(sha(compressed), "71eb9f44ec6aab61b9ac8345dc6bf578e96175b8d600585f681a218a5eb68673");
assert.equal(sha(compressed), data.originalCapsule.compressedSHA256);
const raw = gunzipSync(compressed);
assert.equal(sha(raw), data.originalCapsule.rawSHA256);
const originals = JSON.parse(raw);
assert.equal(originals.length, 11);
assert.equal(data.entries.length, 11);
assert.deepEqual(
  originals.map(({ path }) => path),
  data.entries.map(({ path }) => path),
);
const source = regular(data.source.path);
assert.equal(sha(source), data.source.sha256);
const helpers = [
  ...source
    .toString()
    .matchAll(
      /"(  type __Vize(?:EmptyVueNavigationSlots|NativeNavigationSlots|NavigationSlots)<[^\n]+)"/gu,
    ),
].map(([literal]) => JSON.parse(literal));
assert.equal(helpers.length, 3);
function identity(body, cell) {
  assert.equal(body.length, cell.bytes);
  assert.equal(sha(body), cell.sha256);
  assert.equal(blob(body), cell.blob);
}
void test("all eleven complete generated packets have exact reversible helper-only successors", () => {
  for (let i = 0; i < data.entries.length; i++) {
    const row = data.entries[i];
    assert.equal(row.mode, "100644");
    const before = Buffer.from(originals[i].rawBase64, "base64");
    assert.equal(before.toString("base64"), originals[i].rawBase64);
    identity(before, row.before);
    let forward = before.toString();
    for (const clause of row.clauses) {
      assert.equal(forward.split(clause.before).length - 1, clause.count);
      forward = forward.replaceAll(clause.before, clause.after);
    }
    const after = regular(row.path);
    identity(after, row.after);
    assert.deepEqual(Buffer.from(forward), after);
    let inverse = after.toString();
    for (const clause of row.clauses.toReversed()) {
      assert.equal(inverse.split(clause.after).length - 1, clause.count);
      inverse = inverse.replaceAll(clause.after, clause.before);
    }
    assert.deepEqual(Buffer.from(inverse), before);
    const generated = row.path.startsWith("crates/")
      ? [after.toString()]
      : JSON.parse(after).files.map(({ virtualTs }) => virtualTs);
    for (const text of generated.filter((text) => text.includes("__VizeEmptyVueNavigationSlots")))
      for (const helper of helpers) assert.equal(text.split(helper).length - 1, 1);
  }
});
void test("the complete ecosystem authored diagnostic vectors and counters remain literal", () => {
  const index = data.entries.findIndex(({ path }) =>
    path.endsWith("ecosystem-products-check.snap"),
  );
  assert(index >= 0);
  const before = JSON.parse(Buffer.from(originals[index].rawBase64, "base64"));
  const after = JSON.parse(regular(data.entries[index].path));
  const authored = (packet) => ({
    ...packet,
    files: packet.files.map(({ virtualTs: _generated, ...file }) => file),
  });
  assert.deepEqual(authored(after), authored(before));
  assert.equal(after.files.length, 9);
});
