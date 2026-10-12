import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { joinIdentity, joinPhysical, joinSHA } from "./no-mutating-component-join-physical.mjs";

import {
  commonDirectory,
  commonEntry,
  commonEntryTemplate,
  commonLaw,
  identity,
  sourceCredit,
  validateCommonStructure,
} from "./no-dupe-keys-common-main-source-structure.mjs";
export {
  commonDirectory,
  commonEntry,
  commonEntryTemplate,
  commonLaw,
  childSource,
  identity,
  nativeLaw,
  sourceCredit,
  sourceIdentity,
  sourcePath,
  uniquePaths,
  validateCommonStructure,
} from "./no-dupe-keys-common-main-source-structure.mjs";

export function authenticateCommonPhysical(root, seal) {
  const status = fs.lstatSync(root);
  assert(status.isDirectory() && !status.isSymbolicLink());
  const index = commonDirectory + "/successor.json";
  const bytes = fs.readFileSync(path.join(root, index));
  assert.equal(joinSHA(bytes), seal.manifestSHA, "fixed whole common source declaration");
  joinPhysical(root, identity(index, bytes));
  const manifest = validateCommonStructure(JSON.parse(bytes), seal.parent);
  const currentBodies = new Map(manifest.current.map((row) => [row.path, joinPhysical(root, row)]));
  for (const frame of manifest.literalFrames)
    currentBodies.set(frame.path, joinPhysical(root, frame));
  assert(currentBodies.has(commonLaw), "the whole external source law is fixed current authority");
  const template = currentBodies.get(commonEntryTemplate);
  assert(template);
  const marker = '  manifestSHA: "__FINAL_COMPOSED_MANIFEST_SHA256__",';
  const body = template.toString("utf8");
  assert.deepEqual(Buffer.from(body), template);
  assert.equal(body.split(marker).length, 2);
  const expectedEntry = Buffer.from(
    body.replace(marker, '  manifestSHA: "' + seal.manifestSHA + '",'),
  );
  assert.deepEqual(
    seal.entry,
    expectedEntry,
    "whole executing entry has one declared template substitution",
  );
  assert.deepEqual(joinPhysical(root, identity(commonEntry, expectedEntry)), expectedEntry);
  assert(!currentBodies.has(commonEntry));
  currentBodies.set(commonEntry, expectedEntry);
  currentBodies.set(index, bytes);
  for (const name of manifest.genuineAbsentPaths)
    assert.throws(() => fs.lstatSync(path.join(root, name)), { code: "ENOENT" });
  return { manifest, currentBodies, ...sourceCredit };
}

function applyEdits(body, edits) {
  assert(Buffer.isBuffer(body) && Array.isArray(edits) && edits.length);
  let cursor = 0;
  const pieces = [];
  for (const edit of edits) {
    assert(Number.isSafeInteger(edit.at) && edit.at >= cursor && edit.at <= body.length);
    const removed = Buffer.from(edit.removeBase64, "base64");
    const inserted = Buffer.from(edit.insertBase64, "base64");
    assert.equal(removed.toString("base64"), edit.removeBase64);
    assert.equal(inserted.toString("base64"), edit.insertBase64);
    assert(removed.length || inserted.length);
    assert.deepEqual(body.subarray(edit.at, edit.at + removed.length), removed);
    pieces.push(body.subarray(cursor, edit.at), inserted);
    cursor = edit.at + removed.length;
    assert(cursor <= body.length);
  }
  return Buffer.concat([...pieces, body.subarray(cursor)]);
}
export function validateWholeSelection(current, contexts) {
  const bySource = new Map(contexts.map((context) => [context.frame.source, context]));
  const inverses = JSON.parse(current.currentBodies.get(commonDirectory + "/finite-inverses.json"));
  assert.equal(inverses.schema, "vize.no-dupe-keys.common-main-whole-source-inverses");
  assert.deepEqual(inverses.credit, sourceCredit);
  assert.deepEqual(
    inverses.rows,
    current.manifest.selection.filter((row) => row.kind === "finite-inverse"),
  );
  for (const selected of current.manifest.selection) {
    const actual = current.currentBodies.get(selected.path);
    assert(actual);
    assert.deepEqual(
      selected.counterparts.map((row) => row.source),
      current.manifest.sources,
    );
    for (const row of selected.counterparts) {
      const context = bySource.get(row.source);
      const before = context.bodies.get(selected.path);
      if (row.absent) {
        assert.equal(before, undefined);
        assert(context.frame.genuineAbsentPaths.includes(selected.path));
      } else {
        assert(before);
        assert.equal(row.identity.path, selected.path);
        joinIdentity(before, row.identity);
      }
    }
    if (selected.kind === "literal") {
      const context = bySource.get(selected.source);
      assert(context);
      assert.deepEqual(actual, context.bodies.get(selected.path));
    } else if (selected.kind === "finite-inverse") {
      const context = bySource.get(selected.source);
      assert(context);
      const before = context.bodies.get(selected.path);
      assert(before && selected.forward.length && selected.inverse.length);
      assert.deepEqual(applyEdits(before, selected.forward), actual);
      assert.deepEqual(applyEdits(actual, selected.inverse), before);
    } else if (selected.kind === "new-preserved-evidence") {
      assert(current.manifest.families.preservedEvidence.includes(selected.path));
      assert(selected.counterparts.every((row) => row.absent));
      assert.equal(actual.length, 1413446);
      assert.equal(
        joinSHA(actual),
        "54b22922881dfa7f6ce873203fbbf28404c8170a6ac629db67d68726f0cf927c",
      );
    } else {
      assert.equal(selected.kind, "new-source-bridge");
      assert(current.manifest.families.sourceBridge.includes(selected.path));
      assert(selected.counterparts.every((row) => row.absent));
    }
  }
  return sourceCredit;
}
