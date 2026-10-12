import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { joinIdentity, joinPhysical, joinSHA } from "./no-mutating-component-join-physical.mjs";

import {
  commonDirectory,
  commonEntry,
  commonEntryTemplate,
  commonLaw,
  identity,
  sourceCredit,
  sourcePath,
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
      if (
        selected.path ===
        "tests/_fixtures/differential/linter/no-dupe-keys-447/source-custody/ci-repair/775ec-terminal-actions-evidence.json.gz"
      ) {
        assert.equal(actual.length, 1413446);
        assert.equal(
          joinSHA(actual),
          "54b22922881dfa7f6ce873203fbbf28404c8170a6ac629db67d68726f0cf927c",
        );
      } else {
        assert.equal(
          selected.path,
          "tests/_fixtures/differential/linter/no-dupe-keys-447/source-custody/ci-repair/8e0c-first-source-evidence.json.gz",
        );
        assert.equal(actual.length, 684733);
        assert.equal(
          joinSHA(actual),
          "aed8c7418539081bfa82d6350feca79f686d4c1107aa6dee1d179ee3d686499b",
        );
        const evidence = JSON.parse(zlib.gunzipSync(actual));
        assert.equal(evidence.schema, "vize.no-dupe-keys.failed-source-composition-evidence");
        assert.equal(evidence.version, 1);
        assert.equal(evidence.head, "8e0c3af44cf6d67e9bac3af4f83fdf11643962f4");
        assert.equal(evidence.wholeOldSourcePreservedAsAncestor, evidence.head);
        for (const [name, value] of Object.entries(sourceCredit))
          assert.equal(evidence[name], value);
        for (const [name, value] of Object.entries({
          wholeModules: 28,
          cases: 33,
          pass: 25,
          fail: 8,
          skip: 0,
          status: 1,
        }))
          assert.equal(evidence[name], value);
        assert.equal(
          evidence.manifestSHA256,
          "65f2a2b7e7a9288191cee1c3e2940a001d33322251527ae09b469f21d1e3957a",
        );
        assert.equal(
          joinSHA(Buffer.from(evidence.manifestBase64, "base64")),
          evidence.manifestSHA256,
        );
        assert.equal(evidence.records.length, 85);
        assert.equal(new Set(evidence.records.map((row) => sourcePath(row.path))).size, 85);
        for (const row of evidence.records) {
          const body = Buffer.from(row.base64, "base64");
          assert.equal(body.toString("base64"), row.base64);
          assert.equal(body.length, row.bytes);
          assert.equal(joinSHA(body), row.sha256);
        }
        const archivePath = commonDirectory + "/pre-8e0c-evidence-physical.mjs.fixture";
        const previous = current.currentBodies.get(archivePath);
        assert(previous);
        assert.equal(
          joinSHA(previous),
          "6706f56fa427a79be2d74375597dc5cdf442574d96396aa08ed046977fbf7144",
        );
        const extension = JSON.parse(
          current.currentBodies.get(commonDirectory + "/preserved-evidence-physical-inverse.json"),
        );
        assert.equal(
          extension.schema,
          "vize.no-dupe-keys.finite-preserved-evidence-physical-extension",
        );
        assert.deepEqual(extension.credit, sourceCredit);
        assert.equal(extension.before.path, archivePath);
        joinIdentity(previous, extension.before);
        assert.equal(
          extension.after.path,
          "tests/tooling/support/no-dupe-keys-common-main-source-physical.mjs",
        );
        const updated = current.currentBodies.get(extension.after.path);
        assert(updated);
        joinIdentity(updated, extension.after);
        assert.deepEqual(applyEdits(previous, extension.forward), updated);
        assert.deepEqual(applyEdits(updated, extension.inverse), previous);
      }
    } else {
      assert.equal(selected.kind, "new-source-bridge");
      assert(current.manifest.families.sourceBridge.includes(selected.path));
      assert(selected.counterparts.every((row) => row.absent));
    }
  }
  return sourceCredit;
}
