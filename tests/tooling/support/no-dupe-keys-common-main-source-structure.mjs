import assert from "node:assert/strict";
import path from "node:path";
import { joinObjectID, joinSHA } from "./no-mutating-component-join-physical.mjs";

export const commonDirectory =
  "tests/_fixtures/differential/linter/no-dupe-keys-447/common-main-source-join";
export const commonEntry = "tests/tooling/support/no-dupe-keys-common-main-source-custody.mjs";
export const commonEntryTemplate = commonDirectory + "/entry-template.mjs.fixture";
export const commonLaw = "tests/tooling/no-dupe-keys-common-main-source-custody.test.mjs";
export const sourceCredit = Object.freeze({
  sourceOnly: true,
  compiled: false,
  native: false,
  performance: false,
});
export const childSource = "775ec35cc4b4c32f52f6b758f021e16d5af6a5b8";
export const nativeLaw = "tests/tooling/lint-props-deep-destructure.test.mjs";
export const identity = (name, body) => ({
  path: name,
  mode: "100644",
  bytes: body.length,
  sha256: joinSHA(body),
  gitBlob: joinObjectID("blob", body),
});
export function sourcePath(name) {
  assert.equal(typeof name, "string");
  assert(name && !path.isAbsolute(name) && path.normalize(name) === name);
  assert(!name.split("/").some((part) => !part || part === "." || part === ".."));
  assert(!/[\\\0\r\n]/u.test(name) && name !== ".git" && !name.startsWith(".git/"));
  return name;
}
export function uniquePaths(names) {
  assert(Array.isArray(names));
  names.forEach(sourcePath);
  assert.equal(new Set(names).size, names.length);
  assert.deepEqual(
    names,
    names.toSorted((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
  );
  return names;
}
export function sourceIdentity(row) {
  sourcePath(row.path);
  assert.equal(row.mode, "100644");
  assert(Number.isSafeInteger(row.bytes) && row.bytes >= 0);
  assert.match(row.sha256, /^[a-f0-9]{64}$/u);
  assert.match(row.gitBlob, /^[a-f0-9]{40}$/u);
  return row;
}
export function validateCommonStructure(manifest, parent) {
  assert.equal(manifest.schema, "vize.no-dupe-keys.complete-common-main-source-join");
  assert.equal(manifest.version, 1);
  assert.equal(manifest.status, "sealed-source-only");
  assert.match(parent, /^[a-f0-9]{40}$/u);
  assert.notEqual(parent, childSource);
  assert.deepEqual(manifest.sources, [childSource, parent]);
  assert.deepEqual(manifest.credit, sourceCredit);
  uniquePaths(manifest.current.map((row) => row.path));
  manifest.current.forEach(sourceIdentity);
  uniquePaths(manifest.genuineAbsentPaths);
  const current = new Set(manifest.current.map((row) => row.path));
  for (const name of manifest.genuineAbsentPaths) assert(!current.has(name));
  assert.deepEqual(
    manifest.literalFrames.map((row) => row.source),
    manifest.sources,
  );
  assert.equal(new Set(manifest.literalFrames.map((row) => row.path)).size, 2);
  for (const frame of manifest.literalFrames) {
    sourceIdentity(frame);
    assert(frame.path.startsWith(commonDirectory + "/"));
    assert(Number.isSafeInteger(frame.files) && frame.files > 0);
    assert(Number.isSafeInteger(frame.genuineAbsentPaths) && frame.genuineAbsentPaths >= 0);
  }
  uniquePaths(manifest.sourceLaws.map((row) => row.path));
  assert.equal(manifest.sourceLaws.length, 26);
  assert.equal(manifest.sourceRegistry.length, 27);
  uniquePaths(manifest.sourceRegistry.map((row) => row.path));
  assert.deepEqual(
    manifest.sourceRegistry.filter((row) => row.kind === "live-native-consumer"),
    [{ path: nativeLaw, kind: "live-native-consumer", sources: [], packets: 36 }],
  );
  assert.deepEqual(
    manifest.sourceRegistry.filter((row) => row.kind === "pure-source-law"),
    manifest.sourceLaws.map((row) => ({
      path: row.path,
      kind: "pure-source-law",
      sources: row.sources,
    })),
  );
  for (const law of manifest.sourceLaws) {
    assert(current.has(law.path) && law.path !== nativeLaw);
    assert(law.sources.length && law.sources.every((source) => manifest.sources.includes(source)));
    assert.deepEqual(
      law.sources,
      manifest.sources.filter((source) => law.sources.includes(source)),
    );
    assert.equal(new Set(law.sources).size, law.sources.length);
    assert.deepEqual(
      law.cases.map((row) => row.source),
      law.sources,
    );
    for (const declared of law.cases) {
      assert(Number.isSafeInteger(declared.cases) && declared.cases > 0);
      assert.match(declared.sha256, /^[a-f0-9]{64}$/u);
      uniquePaths(declared.nested.map((row) => row.path));
    }
  }
  assert.deepEqual(Object.keys(manifest.families).toSorted(), [
    "explain",
    "nativeDependencies",
    "noDupeArchives",
    "noDupeCurrent",
    "otherClosedInputs",
    "parentCurrent",
    "preservedEvidence",
    "sourceBridge",
  ]);
  assert.equal(manifest.families.noDupeCurrent.length, 436);
  assert.equal(manifest.families.noDupeArchives.length, 181);
  assert.equal(manifest.families.parentCurrent.length, 323);
  for (const [name, names] of Object.entries(manifest.families)) {
    assert(name && names.length);
    uniquePaths(names);
  }
  assert.deepEqual(
    [...new Set(Object.values(manifest.families).flat())].toSorted((a, b) =>
      a < b ? -1 : a > b ? 1 : 0,
    ),
    [...current].toSorted((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
  );
  assert.equal(manifest.selection.length, current.size);
  assert.deepEqual(
    manifest.selection.map((row) => row.path),
    [...current].toSorted((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
  );
  return manifest;
}
