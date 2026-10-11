import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { gunzipSync } from "node:zlib";
import {
  canonicalInputEpochs,
  qualifyCanonicalInputs,
} from "../../tools/support/compat/github/canonical-corpus-input-epochs.mjs";
import { diagnosticReceipt } from "../../tools/support/compat/github/canonical-corpus-io-probe.mjs";
import { gitObjectId } from "../../tools/support/compat/github/canonical-corpus-inventory.mjs";

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const original = JSON.parse(
  gunzipSync(
    readFileSync(
      new URL("./fixtures/canonical-input-epochs/npmx-c9e8be91-files.json.gz", import.meta.url),
    ),
  ),
);
const { epochs, migration } = canonicalInputEpochs;
const identity = (epoch) => ({
  schema: "vize.canonical-corpus-identity",
  version: 1,
  ...structuredClone(epoch.sourceArtifact),
  ...structuredClone(epoch),
});
const vector = (files) => Buffer.from(files.map(([path]) => `${path}\0`).join(""));
function migrate(files) {
  const entries = new Map(files.map((row) => [row[0], row]));
  for (const row of migration.removed) {
    assert.deepEqual(entries.get(row[0]), row);
    entries.delete(row[0]);
  }
  for (const { old, new: row } of migration.changed) {
    assert.deepEqual(entries.get(old[0]), old);
    assert.equal(old[0], row[0]);
    entries.set(row[0], row);
  }
  for (const row of migration.added) {
    assert.equal(entries.has(row[0]), false);
    entries.set(row[0], row);
  }
  // Keep the captured Rust depth-first order, including directory/file siblings.
  const replacement = migration.targetMembership.map((path) => {
    assert(entries.has(path));
    return entries.get(path);
  });
  const result = [];
  let replaced = false;
  for (const row of files) {
    if (!row[0].startsWith("npmx.dev/")) result.push(row);
    else if (!replaced) {
      result.push(...replacement);
      replaced = true;
    }
  }
  assert(replaced);
  assert.equal(result.length, entries.size);
  return result;
}
const candidate = migrate(original);
const qualify = (epoch, files) =>
  qualifyCanonicalInputs(identity(epoch), () => ({ expected: files, vector: vector(files) }));

void test("both authenticated epochs retain their complete ordered entries and original controls", () => {
  assert.deepEqual(
    epochs.map((epoch) => epoch.sourceArtifact.artifactId),
    [11705104759, 11705404503],
  );
  assert.deepEqual(
    epochs.map((epoch) => epoch.files),
    [44367, 44379],
  );
  for (const [index, files] of [original, candidate].entries()) {
    const epoch = epochs[index];
    const result = qualify(epoch, files);
    assert.equal(result.epoch, epoch);
    assert.equal(result.expected, files);
    assert.equal(result.expected.length, epoch.files);
    assert.equal(epoch.gitlinks.length, 148);
    const receipt = diagnosticReceipt(
      identity(epoch),
      [{ name: "control", success: false }],
      epoch,
    );
    assert.equal(receipt.files, epoch.files);
    assert.equal(receipt.jellyfinFiles, 5576);
    assert.equal(receipt.gitlinks, 148);
    assert.equal(receipt.inputEpoch, epoch.name);
    assert.equal(receipt.inputEpochSha256, epoch.filesSha256);
    assert.equal(receipt.success, false);
  }
});

void test("whole authenticated migration changes exactly 14 added, 2 removed and 32 npmX entries", () => {
  assert.equal(migration.added.length, 14);
  assert.equal(migration.removed.length, 2);
  assert.equal(migration.changed.length, 32);
  const oldEntries = new Map(original.map((row) => [row[0], row]));
  const newEntries = new Map(candidate.map((row) => [row[0], row]));
  const actual = { added: [], removed: [], changed: [] };
  for (const [path, row] of newEntries) {
    if (!oldEntries.has(path)) actual.added.push(row);
    else if (JSON.stringify(oldEntries.get(path)) !== JSON.stringify(row))
      actual.changed.push({ old: oldEntries.get(path), new: row });
  }
  for (const [path, row] of oldEntries) if (!newEntries.has(path)) actual.removed.push(row);
  for (const key of ["added", "removed", "changed"]) assert.deepEqual(actual[key], migration[key]);
  for (const row of [
    ...actual.added,
    ...actual.removed,
    ...actual.changed.map(({ new: row }) => row),
  ])
    assert(row[0].startsWith("npmx.dev/"));
  assert.deepEqual(
    original.filter(([path]) => !path.startsWith("npmx.dev/")),
    candidate.filter(([path]) => !path.startsWith("npmx.dev/")),
  );
  assert.deepEqual(
    epochs[0].gitlinks.filter(({ path }) => !path.endsWith("/npmx.dev")),
    epochs[1].gitlinks.filter(({ path }) => !path.endsWith("/npmx.dev")),
  );
});

void test("one omitted member in either complete epoch remains fatal", () => {
  for (const [index, files] of [original, candidate].entries()) {
    const incomplete = files.filter((_, position) => position !== Math.floor(files.length / 2));
    assert.throws(() => qualify(epochs[index], incomplete), /Incomplete canonical epoch entries/);
  }
});

void test("one changed authentic source byte cannot acquire accepted entry custody", () => {
  const source = readFileSync(
    new URL("./fixtures/canonical-input-epochs/original-npmx-source.bin", import.meta.url),
  );
  const path = "npmx.dev/app/components/SkeletonBlock.vue";
  const row = [path, hash(source), source.length, gitObjectId("blob", source)];
  assert.deepEqual(
    original.find(([name]) => name === path),
    row,
  );
  assert.deepEqual(
    candidate.find(([name]) => name === path),
    row,
  );
  const changed = Buffer.from(source);
  changed[0] ^= 1;
  const changedRow = [path, hash(changed), changed.length, gitObjectId("blob", changed)];
  assert.notEqual(changedRow[1], row[1]);
  assert.notEqual(changedRow[3], row[3]);
  for (const [index, files] of [original, candidate].entries()) {
    const forged = files.map((entry) => (entry[0] === path ? changedRow : entry));
    assert.throws(() => qualify(epochs[index], forged), /Changed canonical epoch bytes/);
  }
});

void test("one modified vector byte and reordered complete members refuse unchanged authority", () => {
  for (const [index, files] of [original, candidate].entries()) {
    const bytes = vector(files);
    bytes[0] ^= 1;
    assert.throws(
      () =>
        qualifyCanonicalInputs(identity(epochs[index]), () => ({ expected: files, vector: bytes })),
      /Changed source membership/,
    );
    const reordered = [...files];
    [reordered[0], reordered[1]] = [reordered[1], reordered[0]];
    assert.throws(() => qualify(epochs[index], reordered), /Changed canonical epoch bytes/);
  }
});

void test("foreign pins and unknown or self-resealed identities refuse before corpus input IO", () => {
  const refuse = (foreign, message) => {
    let loads = 0;
    assert.throws(
      () =>
        qualifyCanonicalInputs(foreign, () => {
          loads++;
          throw new Error("Unknown identity must not start corpus input IO");
        }),
      message,
    );
    assert.equal(loads, 0);
  };
  for (const epoch of epochs) {
    const pin = identity(epoch);
    pin.gitlinks.find(({ path }) => path.endsWith("/npmx.dev")).sha = "a".repeat(40);
    refuse(pin, /Foreign canonical epoch pins/);
    pin.gitlinksSha256 = hash(JSON.stringify(pin.gitlinks));
    refuse(pin, /Unqualified canonical corpus input epoch/);
    const resealed = identity(epoch);
    resealed.filesSha256 = hash(JSON.stringify(candidate.slice(1)));
    refuse(resealed, /Foreign canonical epoch filesSha256/);
    const foreignCollector = identity(epoch);
    foreignCollector.nativeWalk.bodySha256 = "0".repeat(64);
    refuse(foreignCollector, /Foreign native walk bodySha256/);
  }
  refuse({}, /Unqualified canonical corpus input epoch/);
});
