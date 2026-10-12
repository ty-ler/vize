import { reviewedNoDupeCIRepairHistoricalReadView } from "./support/no-dupe-keys-ci-repair-source-custody.mjs";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  authenticateNoDupeKeysSourceFamily,
  composeNoDupeHistoricalLaw,
  composeNoDupeIncomingHelper,
  reviewedNoDupeHistoricalCaseReadView,
  reviewedNoDupeSourceReadView,
} from "./support/no-dupe-keys-source-custody.mjs";
import { authenticateNoMutatingPropsSourceFamily } from "./support/no-mutating-props-source-custody.mjs";
import { authenticateDeepPropsSourceFamily } from "./support/props-deep-source-custody.mjs";
import { authenticateRuntimeApiSourceFamily } from "./support/runtime-props-api-source-custody.mjs";
import { authenticateSetupExportPresetSourceFamily } from "./support/setup-export-preset-source-custody.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const physicalRead = (name) => fs.readFileSync(path.join(root, name));
const read = reviewedNoDupeCIRepairHistoricalReadView(root, physicalRead);
const observe = () => {
  const names = new Set();
  const tracked = (name) => {
    names.add(name);
    return read(name);
  };
  const current = authenticateNoDupeKeysSourceFamily(root, tracked);
  return { current, names };
};

await test("the genuine NoDup whole successor retains nine bodies and all incoming histories", () => {
  const current = authenticateNoDupeKeysSourceFamily(root, read);
  assert.equal(current.sources.length, 12);
  assert.equal(current.sources.filter(({ changed }) => !changed).length, 9);
  assert.equal(current.ownedBodies.length, 73);
  const incoming = authenticateNoMutatingPropsSourceFamily(root, read);
  assert.equal(incoming.sources.length, 12);
  assert.deepEqual(incoming.changedPaths, ["crates/vize_patina/src/linter/script_rules/sfc.rs"]);
  const runtime = authenticateRuntimeApiSourceFamily(root, read);
  assert.equal(runtime.sources.length, 12);
  assert.equal(authenticateSetupExportPresetSourceFamily(root, runtime, read).sources.length, 12);
  assert.equal(authenticateDeepPropsSourceFamily(root, read).sources.length, 12);
  assert.deepEqual(
    read(current.incomingHelper.path),
    composeNoDupeIncomingHelper(read(current.incomingHelper.archive)),
  );
  for (const law of current.originalHistoricalLaws)
    assert.deepEqual(read(law.path), composeNoDupeHistoricalLaw(read(law.archive)));
});

await test("all actual current bodies, corpus bytes, manifests, archives and callers reject mutation", () => {
  const { names } = observe();
  for (const name of names) {
    const unknown = (requested) =>
      requested === name ? Buffer.concat([read(requested), Buffer.from(" ")]) : read(requested);
    assert.throws(() => authenticateNoDupeKeysSourceFamily(root, unknown), name);
    assert.throws(() => authenticateNoMutatingPropsSourceFamily(root, unknown), name);
    assert.throws(() => authenticateDeepPropsSourceFamily(root, unknown), name);
  }
});

await test("partial successors cannot borrow another family's admissible body", () => {
  const current = authenticateNoDupeKeysSourceFamily(root, read);
  for (const source of current.sources.filter(({ changed }) => changed)) {
    const partial = (name) => (name === source.path ? read(source.before.archive) : read(name));
    assert.throws(() => authenticateNoDupeKeysSourceFamily(root, partial), source.path);
    assert.throws(() => authenticateNoMutatingPropsSourceFamily(root, partial), source.path);
  }
  const historical = reviewedNoDupeHistoricalCaseReadView(root, read);
  assert.deepEqual(
    authenticateNoMutatingPropsSourceFamily(root, historical),
    JSON.parse(read(current.incomingFamily.path)),
  );
  assert.throws(() => authenticateNoDupeKeysSourceFamily(root, historical));
});

await test("the explicit incoming context restores exact whole helpers and forwards other requests", () => {
  const current = authenticateNoDupeKeysSourceFamily(root, read);
  const calls = [];
  const tracked = (name, ...args) => {
    calls.push([name, ...args]);
    return read(name);
  };
  const view = reviewedNoDupeSourceReadView(root, tracked);
  for (const source of current.sources.filter(({ changed }) => changed))
    assert.deepEqual(view(source.path), read(source.before.archive));
  assert.deepEqual(view(current.incomingHelper.path), read(current.incomingHelper.archive));
  for (const law of current.originalHistoricalLaws)
    assert.deepEqual(view(law.path), read(law.archive));
  const unrelated = current.sources.find(({ changed }) => !changed).path;
  calls.length = 0;
  assert.deepEqual(view(unrelated, "forward", 42), read(unrelated));
  assert.deepEqual(calls, [[unrelated, "forward", 42]]);
});

await test("matching callback bytes cannot mask physical source links, executables, missing files or directories", () => {
  const { names } = observe();
  const owned = fs.mkdtempSync(path.join(os.tmpdir(), "vize-no-dupe-source-custody-"));
  try {
    for (const name of names) {
      const target = path.join(owned, name);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, read(name), { mode: 0o644 });
    }
    authenticateNoDupeKeysSourceFamily(owned, read);
    const source = "crates/vize_patina/src/linter/script_rules.rs";
    const target = path.join(owned, source);
    fs.chmodSync(target, 0o755);
    assert.throws(() => authenticateNoDupeKeysSourceFamily(owned, read));
    fs.chmodSync(target, 0o644);
    fs.unlinkSync(target);
    assert.throws(() => authenticateNoDupeKeysSourceFamily(owned, read));
    fs.symlinkSync(path.join(root, source), target);
    assert.throws(() => authenticateNoDupeKeysSourceFamily(owned, read));
    fs.unlinkSync(target);
    fs.mkdirSync(target);
    assert.throws(() => authenticateNoDupeKeysSourceFamily(owned, read));
  } finally {
    fs.rmSync(owned, { recursive: true, force: true });
  }
});
