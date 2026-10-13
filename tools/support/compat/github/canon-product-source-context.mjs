import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { authenticateJavaScriptSfcSource } from "./javascript-sfc-source-context.mjs";
import { ensureHostedLiteralSource } from "../../../../tests/performance/support/warm-type-backed-git-reader-literal-source.ts";

import {
  authenticateCanonProductComposition,
  canonProductCompositionPaths,
} from "./canon-product-main-composition.mjs";

const sha = (body) => createHash("sha256").update(body).digest("hex");
const blob = (body) =>
  createHash("sha1").update(`blob ${body.length}\0`).update(body).digest("hex");
const revisions = Object.freeze({
  original: "6401289e3091def8f6bdfd271ab31837e5f36855",
  main: "b2f56c584c82f0da96db88c1faee565dd838ead8",
  current: "abafabd150fe370152dab46e49d44b075edddae9",
});
// Finite original JS/Star and literal SDK427 references, acquired only by the owned hosted boundary.
const retainedHistory = Object.freeze([
  "2489128d5f8fab1b7442a1e5c09b4e1701cbf185",
  "3a680d0a0b59b720af0d23a70a85cf56c5c4f175",
  "3dda8f9d71fbd7e701f0805187daff6191865190",
  "49d95b8e93a9f5bcb73e0c1c307815d4b3a9d570",
  "5c54b1195fa8c0bf151e0a2862bf4238a3597b4e",
  "5c8f3825fd2eb698c27d3b97d0a47b0671b33e01",
  "66d2cfab35dd6dc8f730371b3b127543b6cc9505",
  "8a5f5b8f3a39e123ad20ad8ccd9ecd3b39276695",
  "a93e78147b0990c813e965a7868b32dda341eb77",
  "bd5702c0a4d5fb3bb64487794fc45f6f876e6e38",
  "d95c151c18d85c8fdd95541291bc614e44790101",
  "eafe5bed4f602e0787ff9f2f48ec4155d115ab7f",
  "f20740ef6b0958ddb0bbbd64fd1b38210ea5e207",
  "f518d884e3a1c70ce147fb966093cd9721e0e81f",
  "2da71113a3f8ab528b1a9cda20fc6a4c2bd273f6",
  "b45d789b317933d48dadbba4841c8e353231547b",
  "6fb01f335952780d7a6321ca092049753645c83d",
  "ea1fc59ee6ef61a3509b1ef42a6fa7aacd9f8586",
  "e02a861cc1c6ad12724036c70bfdd5d48173b189",
  "f6017bf3a9837136f7ce60d52d67ecc3ee649dd0",
  "e78d2cb93e278032cd262201b0a444273618ee25",
  "43afa9b09ae0f334d7fcba41f721ac52a8d1ab23",
]);
// Object acquisition for the unchanged original negative fixture only; grants no source or runtime view.
const retainedNegativeSetup = Object.freeze(["b401784c472d850a8be08ca1122659a6883dde6e"]);
const parts = [
  [
    "canon-product-source-cells-0.tsv",
    "a44759186573bf66d3150b0890adcf1328844364429840f1de321d2cc6bff2ce",
  ],
  [
    "canon-product-source-cells-1.tsv",
    "802ed944a5386c331ff2a107130dd8824d0daf9f8d9fc69344aa3d344db6206a",
  ],
  [
    "canon-product-source-cells-2.tsv",
    "16679334f879d297f135c796a22f60c333ca5d4dded1d1187efe77cb72791e1d",
  ],
];
const rows = parts.flatMap(([name, expected]) => {
  const target = new URL(name, import.meta.url),
    stat = fs.lstatSync(target);
  assert(stat.isFile() && (stat.mode & 0o777) === 0o644);
  const bytes = fs.readFileSync(target);
  assert.equal(sha(bytes), expected);
  assert(bytes.at(-1) === 10);
  return bytes
    .toString()
    .slice(0, -1)
    .split("\n")
    .map((line) => {
      const [file, ...fields] = line.split("\t");
      assert.equal(fields.length, 12);
      assert(file.split("/").every((part) => part && part !== "." && part !== ".."));
      const row = { file };
      for (const [index, side] of ["original", "main", "current"].entries()) {
        const [mode, oid, bytes, checksum] = fields.slice(index * 4, index * 4 + 4);
        if (mode === "-") {
          assert.deepEqual([oid, bytes, checksum], ["-", "-", "-"]);
          row[side] = null;
        } else {
          assert.match(mode, /^100(?:644|755)$/u);
          assert.match(oid, /^[a-f0-9]{40}$/u);
          assert.match(checksum, /^[a-f0-9]{64}$/u);
          row[side] = { mode, blob: oid, bytes: Number(bytes), sha256: checksum };
        }
      }
      return row;
    });
});
assert.equal(rows.length, 426);
assert.equal(new Set(rows.map(({ file }) => file)).size, 426);

const successorBytes = fs.readFileSync(
  new URL("canon-product-caller-successors.json.gz", import.meta.url),
);
assert.equal(
  sha(successorBytes),
  "e1f30e6bd8dbcf6cba4f02ab86cddf294fa8cdee34d9af72661e91bc36ab76f8",
);
const successors = JSON.parse(gunzipSync(successorBytes));
assert.equal(successors.schema, 1);
assert.equal(successors.sourceOnly, true);
assert.equal(successors.runtimeCredit, false);
assert.equal(successors.anchor, revisions.current);
const successorCells = new Map();
for (const entry of successors.entries) {
  assert(rows.some(({ file }) => file === entry.file));
  assert(!successorCells.has(entry.file));
  const row = rows.find(({ file }) => file === entry.file);
  const cells = {};
  for (const side of ["before", "after"]) {
    const cell = entry[side],
      body = Buffer.from(cell.rawBase64, "base64");
    assert.equal(body.toString("base64"), cell.rawBase64);
    assert.equal(body.length, cell.bytes);
    assert.equal(sha(body), cell.sha256);
    assert.equal(blob(body), cell.blob);
    assert.equal(cell.mode, "100644");
    cells[side] = { mode: cell.mode, blob: cell.blob, body };
  }
  assert.deepEqual(row.current, {
    mode: entry.before.mode,
    blob: entry.before.blob,
    bytes: entry.before.bytes,
    sha256: entry.before.sha256,
  });
  const before = cells.before.body.toString().split(/(?<=\n)/u),
    restored = cells.after.body.toString().split(/(?<=\n)/u);
  for (const [i, j, k, l, oldBody, newBody] of entry.inverse.toReversed()) {
    assert.equal(before.slice(i, j).join(""), oldBody);
    assert.equal(restored.slice(k, l).join(""), newBody);
    restored.splice(k, l - k, ...(oldBody ? oldBody.split(/(?<=\n)/u) : []));
  }
  assert.deepEqual(Buffer.from(restored.join("")), cells.before.body);
  successorCells.set(entry.file, cells);
}

export const canonProductSourcePaths = Object.freeze(rows.map(({ file }) => file));
export const canonProductSourceRevisions = revisions;
const proofs = new WeakMap();
const git = (root, args, input) =>
  execFileSync("git", ["--no-replace-objects", ...args], {
    cwd: root,
    input,
    maxBuffer: 128 * 1024 * 1024,
    env: { ...process.env, GIT_NO_LAZY_FETCH: "1", GIT_ALLOW_PROTOCOL: "" },
  });
function frame(root, revision, side, useSuccessors = false, composition = new Map()) {
  const tree = git(root, ["ls-tree", "-rz", revision, "--", ...canonProductSourcePaths]);
  assert.deepEqual(Buffer.from(tree.toString()), tree);
  const entries = new Map(
    tree
      .toString()
      .split("\0")
      .filter(Boolean)
      .map((record) => {
        const match = /^(100644|100755) blob ([a-f0-9]{40})\t(.+)$/u.exec(record);
        assert(match && canonProductSourcePaths.includes(match[3]));
        return [match[3], { mode: match[1], blob: match[2] }];
      }),
  );
  const expected = rows.filter((row) => row[side]);
  assert.equal(entries.size, expected.length);
  const batch = git(
    root,
    ["cat-file", "--batch"],
    expected.map(({ file }) => entries.get(file).blob).join("\n") + "\n",
  );
  const bodies = new Map();
  let cursor = 0;
  for (const row of rows) {
    const cell =
      useSuccessors && composition.has(row.file)
        ? {
            ...composition.get(row.file),
            bytes: composition.get(row.file).body.length,
            sha256: sha(composition.get(row.file).body),
          }
        : useSuccessors && successorCells.has(row.file)
          ? { ...successors.entries.find((entry) => entry.file === row.file).after }
          : row[side];
    if (!cell) {
      assert(!entries.has(row.file));
      bodies.set(row.file, null);
      continue;
    }
    assert.deepEqual(entries.get(row.file), { mode: cell.mode, blob: cell.blob });
    const end = batch.indexOf(10, cursor);
    assert.equal(batch.subarray(cursor, end).toString(), `${cell.blob} blob ${cell.bytes}`);
    const body = Buffer.from(batch.subarray(end + 1, end + 1 + cell.bytes));
    cursor = end + 2 + cell.bytes;
    assert.equal(batch[cursor - 1], 10);
    assert.equal(body.length, cell.bytes);
    assert.equal(blob(body), cell.blob);
    assert.equal(sha(body), cell.sha256);
    bodies.set(row.file, { mode: cell.mode, blob: cell.blob, body });
  }
  assert.equal(cursor, batch.length);
  return bodies;
}
/** Authenticate the whole actual child before lending either exact predecessor source view. */
export function authenticateCanonProductSource(root) {
  root = fs.realpathSync(root);
  assert.equal(git(root, ["for-each-ref", "--format=%(refname)", "refs/replace"]).length, 0);
  const head = git(root, ["rev-parse", "HEAD"]).toString().trim();
  for (const revision of new Set([
    ...Object.values(revisions),
    ...retainedHistory,
    ...retainedNegativeSetup,
  ]))
    ensureHostedLiteralSource(root, revision);
  const frames = Object.fromEntries(
    Object.entries(revisions).map(([side, revision]) => [side, frame(root, revision, side)]),
  );
  ensureHostedLiteralSource(root, "2da71113a3f8ab528b1a9cda20fc6a4c2bd273f6");
  const composition = authenticateCanonProductComposition(root, head);
  for (const [file, cell] of successorCells)
    assert.deepEqual(
      composition.get(file),
      cell.after,
      "whole composed caller agrees with its exact predecessor inverse: " + file,
    );
  const admitted = new Set([
    ...canonProductCompositionPaths,
    "tools/support/compat/github/canon-release-navigation-helper.mjs",
    "tests/tooling/canon-release-navigation-receipt-current.test.mjs",
    "tests/_fixtures/differential/canon/release-js-pragma-opaque-slots/navigation-helper-successor.json",
    "tools/support/compat/github/canon-product-main-composition.mjs",
    "tools/support/compat/github/canon-product-main-composition.json.gz",
    "tools/support/compat/github/canon-product-sdk-three-union.json",
    "tools/support/compat/github/canon-product-source-context.mjs",
    "tools/support/compat/github/canon-product-retained-source-runner.mjs",
    "tests/tooling/canon-product-current-source.test.mjs",
    "tools/support/compat/github/canon-product-caller-successors.json.gz",
    ...parts.map(([name]) => "tools/support/compat/github/" + name),
    ...successorCells.keys(),
  ]);
  for (const file of git(root, ["diff", "--name-only", "--no-renames", revisions.current, head])
    .toString()
    .trim()
    .split("\n")
    .filter(Boolean))
    assert(admitted.has(file), "foreign source outside the closed selected child: " + file);
  const actual = frame(root, head, "current", true, composition);
  for (const { file } of rows) {
    const expected =
      composition.get(file) ?? successorCells.get(file)?.after ?? frames.current.get(file);
    assert.deepEqual(
      actual.get(file),
      expected,
      "whole selected child and named caller successor: " + file,
    );
    const cell = actual.get(file);
    assert(cell);
    let target = root;
    for (const component of file.split("/")) {
      target = path.join(target, component);
      assert(!fs.lstatSync(target).isSymbolicLink(), "physical ancestor: " + file);
    }
    const stat = fs.lstatSync(target);
    assert(stat.isFile() && (stat.mode & 0o777) === Number.parseInt(cell.mode.slice(3), 8));
    assert.deepEqual(
      fs.readFileSync(target),
      cell.body,
      "physical equals whole raw child: " + file,
    );
  }
  const original = authenticateJavaScriptSfcSource((file) => {
    assert(frames.original.has(file));
    return Buffer.from(frames.original.get(file).body);
  });
  assert.equal(original.receipt.bodyPairs, 93);
  assert.equal(git(root, ["rev-parse", "HEAD"]).toString().trim(), head);
  assert.equal(git(root, ["for-each-ref", "--format=%(refname)", "refs/replace"]).length, 0);
  const receipt = Object.freeze({
    authority: "canon-product-complete-current-source",
    head,
    completeBodies: rows.length,
    retainedJavaScriptBodies: 93,
    sourceOnly: true,
    runtimeCredit: false,
    performanceCredit: false,
  });
  proofs.set(receipt, { ...frames, actual });
  return receipt;
}
export function retainedCanonProductSource(receipt, side, file) {
  assert(["original", "main"].includes(side));
  const frames = proofs.get(receipt);
  assert(frames, "only an authenticated source receipt");
  assert(frames[side].has(file), "closed retained source path");
  const cell = frames[side].get(file);
  return cell && { ...cell, body: Buffer.from(cell.body) };
}

export const canonProductSourceMetadataPaths = Object.freeze([
  "tools/support/compat/github/canon-release-navigation-helper.mjs",
  "tests/_fixtures/differential/canon/release-js-pragma-opaque-slots/navigation-helper-successor.json",
  "tools/support/compat/github/canon-product-main-composition.mjs",
  "tools/support/compat/github/canon-product-main-composition.json.gz",
  "tools/support/compat/github/canon-product-sdk-three-union.json",
  "tools/support/compat/github/canon-product-source-context.mjs",
  "tools/support/compat/github/canon-product-retained-source-runner.mjs",
  "tools/support/compat/github/canon-product-caller-successors.json.gz",
  ...parts.map(([name]) => "tools/support/compat/github/" + name),
]);
export function actualCanonProductSourceCell(receipt, file) {
  const frames = proofs.get(receipt);
  assert(frames, "authenticated current source receipt");
  assert(frames.actual.has(file), "closed actual source path");
  const cell = frames.actual.get(file);
  return cell && { ...cell, body: Buffer.from(cell.body) };
}
