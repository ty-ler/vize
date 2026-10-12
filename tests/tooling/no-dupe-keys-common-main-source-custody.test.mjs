import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  authenticateNoDupeCommonJoinCommitted,
  authenticateNoDupeCommonJoinPhysical,
  runNoDupeCommonJoinSourceLaw,
} from "./support/no-dupe-keys-common-main-source-custody.mjs";
import { joinGit } from "./support/no-mutating-component-join-physical.mjs";
import {
  validateCommonStructure,
  nativeLaw,
} from "./support/no-dupe-keys-common-main-source-physical.mjs";

const root = path.resolve(import.meta.dirname, "../..");
const physical = authenticateNoDupeCommonJoinPhysical(root);
function capsule() {
  const owned = fs.mkdtempSync(path.join(os.tmpdir(), "vize-no-dupe-common-refusal-"));
  for (const [name, body] of physical.currentBodies) {
    const target = path.join(owned, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, body, { mode: 0o644, flag: "wx" });
  }
  return owned;
}
void test("the entire current physical and raw commit joins both whole source models", () => {
  const qualified = authenticateNoDupeCommonJoinCommitted(root);
  assert.equal(qualified.sourceOnly, true);
  assert.equal(qualified.compiled, false);
  assert.equal(qualified.native, false);
  assert.equal(qualified.performance, false);
  assert.equal(qualified.contexts.length, 2);
  assert.equal(qualified.manifest.sourceLaws.length, 26);
  assert.equal(qualified.manifest.sourceRegistry.length, 27);
  assert.equal(qualified.currentBodies.size, physical.currentBodies.size);
});
void test("every actual source, archive, caller, helper, index and whole frame rejects omission or changed bytes", () => {
  const owned = capsule();
  try {
    for (const [name, body] of physical.currentBodies) {
      const target = path.join(owned, name);
      fs.writeFileSync(target, Buffer.concat([body, Buffer.from("\nforeign body\n")]));
      assert.throws(() => authenticateNoDupeCommonJoinPhysical(owned), name);
      fs.writeFileSync(target, body);
      fs.unlinkSync(target);
      assert.throws(() => authenticateNoDupeCommonJoinPhysical(owned), name);
      fs.writeFileSync(target, body, { mode: 0o644, flag: "wx" });
    }
    assert.equal(
      authenticateNoDupeCommonJoinPhysical(owned).currentBodies.size,
      physical.currentBodies.size,
    );
  } finally {
    fs.rmSync(owned, { recursive: true, force: true });
  }
});
void test("file modes, links, directories and resurrected genuine absences cannot borrow matching bytes", () => {
  const owned = capsule();
  try {
    const [name, body] = [...physical.currentBodies][0];
    const target = path.join(owned, name);
    fs.chmodSync(target, 0o755);
    assert.throws(() => authenticateNoDupeCommonJoinPhysical(owned));
    fs.chmodSync(target, 0o644);
    fs.unlinkSync(target);
    fs.symlinkSync(path.join(root, name), target);
    assert.throws(() => authenticateNoDupeCommonJoinPhysical(owned));
    fs.unlinkSync(target);
    fs.mkdirSync(target);
    assert.throws(() => authenticateNoDupeCommonJoinPhysical(owned));
    fs.rmdirSync(target);
    fs.writeFileSync(target, body, { mode: 0o644 });
    for (const absent of physical.manifest.genuineAbsentPaths) {
      const filename = path.join(owned, absent);
      fs.mkdirSync(path.dirname(filename), { recursive: true });
      fs.writeFileSync(filename, "foreign old source\n");
      assert.throws(() => authenticateNoDupeCommonJoinPhysical(owned));
      fs.unlinkSync(filename);
    }
  } finally {
    fs.rmSync(owned, { recursive: true, force: true });
  }
});
void test("unknown, duplicate, missing, partial and hybrid declarations refuse independently of the fixed index hash", () => {
  const original = physical.manifest;
  const refuse = (alter) => {
    const value = structuredClone(original);
    alter(value);
    assert.throws(() => validateCommonStructure(value, original.sources[1]));
  };
  refuse((value) => value.current.pop());
  refuse((value) => value.current.push(value.current[0]));
  refuse((value) => (value.current[0].path = "../foreign.rs"));
  refuse((value) => value.sourceLaws.pop());
  refuse((value) => value.sourceLaws[0].sources.push(value.sourceLaws[0].sources[0]));
  refuse((value) => value.sourceRegistry.push(value.sourceRegistry[0]));
  refuse((value) => (value.sourceRegistry[0].kind = "unknown-source"));
  refuse((value) => (value.literalFrames[1] = value.literalFrames[0]));
  refuse((value) => value.sources.reverse());
  refuse((value) => value.selection.pop());
});
void test("matching physical bytes cannot hide changed committed source or a foreign literal HEAD", () => {
  const owned = capsule();
  try {
    joinGit(owned, ["init", "--quiet"]);
    joinGit(owned, ["add", "--", "."]);
    const tree = joinGit(owned, ["write-tree"]).toString().trim();
    const commit = () =>
      joinGit(
        owned,
        [
          "-c",
          "user.name=Source Control",
          "-c",
          "user.email=source-control@example.invalid",
          "commit-tree",
          joinGit(owned, ["write-tree"]).toString().trim(),
        ],
        "whole source control\n",
      )
        .toString()
        .trim();
    const initial = commit();
    fs.writeFileSync(path.join(owned, ".git/HEAD"), initial + "\n");
    const [name, body] = [...physical.currentBodies][0];
    fs.writeFileSync(
      path.join(owned, name),
      Buffer.concat([body, Buffer.from("\nforeign committed bytes\n")]),
    );
    joinGit(owned, ["add", "--", name]);
    fs.writeFileSync(path.join(owned, ".git/HEAD"), commit() + "\n");
    fs.writeFileSync(path.join(owned, name), body);
    assert.equal(
      authenticateNoDupeCommonJoinPhysical(owned).currentBodies.size,
      physical.currentBodies.size,
    );
    assert.throws(
      () => authenticateNoDupeCommonJoinCommitted(owned),
      /whole committed joined source/u,
    );
    assert.notEqual(tree, joinGit(owned, ["write-tree"]).toString().trim());
    for (const source of physical.manifest.sources) {
      fs.writeFileSync(path.join(owned, ".git/HEAD"), source + "\n");
      assert.throws(() => authenticateNoDupeCommonJoinCommitted(owned));
    }
  } finally {
    fs.rmSync(owned, { recursive: true, force: true });
  }
});
void test("native and unknown consumers have no historical pure source dispatch", async () => {
  for (const law of [nativeLaw, "tests/tooling/unreviewed.test.mjs", "../foreign.test.mjs"])
    await assert.rejects(
      runNoDupeCommonJoinSourceLaw(root, law),
      /unknown or live native source dispatch/u,
    );
});
