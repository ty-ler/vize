import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  authenticateNoDupeExplainSnapshotSource,
  runNoDupeExplainSnapshotHistoricalLaw,
  noDupeExplainSnapshotDirectory,
  noDupeExplainSnapshotGuard,
} from "./support/no-dupe-keys-explain-snapshot-source-custody.mjs";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (name) => fs.readFileSync(path.join(root, name));
const manifestPath = `${noDupeExplainSnapshotDirectory}/successor.json`;
const manifest = authenticateNoDupeExplainSnapshotSource(root);
const names = [
  manifestPath,
  noDupeExplainSnapshotGuard,
  ...manifest.current.map(({ path: name }) => name),
  ...manifest.archives.map(({ path: name }) => name),
];
function withClone(action) {
  const owned = fs.mkdtempSync(path.join(os.tmpdir(), "vize-no-dupe-explain-control-"));
  try {
    for (const name of names) {
      const target = path.join(owned, name);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, read(name), { mode: 0o644 });
    }
    action(owned);
  } finally {
    fs.rmSync(owned, { recursive: true, force: true });
  }
}

void test("current complete physical snapshots precede the unchanged historical whole one-case law", () => {
  assert.equal(manifest.current.length, 14);
  assert.equal(manifest.snapshotRows.length, 3);
  const result = runNoDupeExplainSnapshotHistoricalLaw(root);
  assert.equal(result.historicalCases, 1);
  assert.deepEqual(result.credit, { compiled: false, native: false, performance: false });
  assert.match(
    result.stdout,
    /private import example changes only its three whole explain snapshots/,
  );
});

void test("every current body and immutable archive refuses alteration, omission, mode, link or directory substitution", () => {
  withClone((owned) => {
    authenticateNoDupeExplainSnapshotSource(owned);
    for (const name of names) {
      const target = path.join(owned, name);
      const original = read(name);
      fs.writeFileSync(target, Buffer.concat([original, Buffer.from(" ")]));
      assert.throws(() => runNoDupeExplainSnapshotHistoricalLaw(owned), undefined, name);
      fs.writeFileSync(target, original);
      fs.chmodSync(target, 0o755);
      assert.throws(() => runNoDupeExplainSnapshotHistoricalLaw(owned), undefined, name);
      fs.chmodSync(target, 0o644);
      fs.unlinkSync(target);
      assert.throws(() => runNoDupeExplainSnapshotHistoricalLaw(owned), undefined, name);
      fs.symlinkSync(path.join(root, name), target);
      assert.throws(() => runNoDupeExplainSnapshotHistoricalLaw(owned), undefined, name);
      fs.unlinkSync(target);
      fs.mkdirSync(target);
      assert.throws(() => runNoDupeExplainSnapshotHistoricalLaw(owned), undefined, name);
      fs.rmdirSync(target);
      fs.writeFileSync(target, original, { mode: 0o644 });
    }
    authenticateNoDupeExplainSnapshotSource(owned);
  });
});

void test("partial old snapshot tuples and unrelated literal prefix or suffix changes cannot borrow historical authority", () => {
  withClone((owned) => {
    for (const entry of manifest.current.slice(0, 3)) {
      const target = path.join(owned, entry.path);
      const original = read(entry.path);
      fs.writeFileSync(target, read(entry.before.archive));
      assert.throws(() => runNoDupeExplainSnapshotHistoricalLaw(owned));
      fs.writeFileSync(target, Buffer.concat([Buffer.from(" "), original]));
      assert.throws(() => runNoDupeExplainSnapshotHistoricalLaw(owned));
      fs.writeFileSync(target, Buffer.concat([original, Buffer.from(" ")]));
      assert.throws(() => runNoDupeExplainSnapshotHistoricalLaw(owned));
      fs.writeFileSync(target, original);
    }
    for (const entry of manifest.current.slice(0, 3))
      fs.writeFileSync(path.join(owned, entry.path), read(entry.before.archive));
    assert.throws(() => runNoDupeExplainSnapshotHistoricalLaw(owned));
  });
});

void test("a parent directory link cannot conceal matching source bytes", () => {
  withClone((owned) => {
    const name = "crates/vize/src/commands/explain/snapshots";
    const target = path.join(owned, name);
    fs.rmSync(target, { recursive: true });
    fs.symlinkSync(path.join(root, name), target);
    assert.throws(() => runNoDupeExplainSnapshotHistoricalLaw(owned));
  });
});
