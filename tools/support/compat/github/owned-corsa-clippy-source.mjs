import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";

const sha = (body) => createHash("sha256").update(body).digest("hex");
const blob = (body) =>
  createHash("sha1").update(`blob ${body.length}\0`).update(body).digest("hex");
const url = new URL("./owned-corsa-clippy-source.json", import.meta.url);
const stat = fs.lstatSync(url);
assert(stat.isFile() && (stat.mode & 0o777) === 0o644);
const bytes = fs.readFileSync(url);
assert.equal(sha(bytes), "9dec771413262e89eb1e34abfac1594207da8eb2e04bf68388e96049358f70a7");
const data = JSON.parse(bytes);
assert.equal(data.schema, 1);
assert.equal(
  data.retainedGraphManifestSHA256,
  "bffe80f1e770ad10df3af2670e01b5f53a9574f357d42df6948a458f5311040c",
);
assert.equal(data.retainedOldAfterSource, "b2caebeab6fb5bc817b4e31a65d5d560449b691b");
const files = [
  "corsa_core",
  "corsa_jsonrpc",
  "corsa_client",
  "corsa_lsp",
  "corsa_orchestrator",
  "corsa",
].map((name) => "vendor/" + name + "/Cargo.toml");
assert.deepEqual(
  data.entries.map(({ file }) => file),
  files,
);
const capsules = new Map();
for (const row of data.entries) {
  const values = {};
  for (const side of ["retainedOldAfter", "currentAfter"]) {
    const cell = row[side];
    const body = Buffer.from(cell.rawBase64, "base64");
    assert.equal(body.toString("base64"), cell.rawBase64);
    assert.equal(cell.mode, "100644");
    assert.equal(body.length, cell.bytes);
    assert.equal(sha(body), cell.sha256);
    assert.equal(blob(body), cell.blob);
    values[side] = { ...cell, body };
  }
  assert.deepEqual(
    Buffer.concat([values.retainedOldAfter.body, Buffer.from(data.appendix)]),
    values.currentAfter.body,
    "whole six-manifest inverse: " + row.file,
  );
  capsules.set(row.file, values);
}
function same(actual, expected) {
  return (
    !!actual &&
    Buffer.isBuffer(actual.body) &&
    actual.mode === "100644" &&
    actual.blob === expected.blob &&
    actual.body.length === expected.bytes &&
    sha(actual.body) === expected.sha256 &&
    blob(actual.body) === expected.blob
  );
}

/** All237 current after bodies precede any old after projection; six variants are atomic. */
export function authenticateOwnedCorsaAfterContext(rows, reader) {
  assert.equal(rows.length, 237);
  assert.equal(new Set(rows.map(({ file }) => file)).size, 237);
  for (const file of files) {
    const old = capsules.get(file).retainedOldAfter;
    const row = rows.find((row) => row.file === file);
    assert(
      row &&
        row.after.mode === old.mode &&
        row.after.blob === old.blob &&
        row.after.bytes === old.bytes &&
        row.after.sha256 === old.sha256,
    );
  }
  const old = files.every((file) => same(reader(file), capsules.get(file).retainedOldAfter));
  const current = files.every((file) => same(reader(file), capsules.get(file).currentAfter));
  if (!old && !current) return null;
  for (const row of rows) {
    const expected =
      current && capsules.has(row.file) ? capsules.get(row.file).currentAfter : row.after;
    if (!same(reader(row.file), expected)) return null;
  }
  return {
    context: current
      ? {
          authority: data.authority,
          sourceContextSHA256: sha(bytes),
          wholeCurrentBodies: 237,
          wholeManifestBodies: 6,
          retainedOldAfterSource: data.retainedOldAfterSource,
          runtimeCredit: false,
          performanceCredit: false,
          clippyExecutionCredit: false,
        }
      : null,
    historicalAfter: (file) => {
      const value =
        current && capsules.has(file) ? capsules.get(file).retainedOldAfter : reader(file);
      return value ? { ...value, body: Buffer.from(value.body) } : null;
    },
    actualAfter: (file) => {
      const value = reader(file);
      return value ? { ...value, body: Buffer.from(value.body) } : null;
    },
  };
}

export function qualifyClippyOwnedCorsaSource(input, rows, original) {
  const retained = original(input);
  if (retained) return retained;
  const after = authenticateOwnedCorsaAfterContext(rows, (file) => input.reader("after", file));
  if (!after?.context) return null;
  const projected = original({
    ...input,
    reader: (side, file) =>
      side === "after" ? after.historicalAfter(file) : input.reader(side, file),
  });
  if (!projected) return null;
  return {
    ...projected,
    sourceContext: after.context,
    actualReader: (side, file) =>
      side === "after" ? after.actualAfter(file) : input.reader(side, file),
  };
}
