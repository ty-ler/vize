import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import type { Body } from "./warm-type-backed-git-reader-dual-frame.ts";
const sha = (body: Uint8Array) => createHash("sha256").update(body).digest("hex");
const blob = (body: Buffer) => createHash("sha1").update(`blob ${body.length}\0`).update(body).digest("hex");
const url = new URL("./owned-corsa-dual-sfc-source.json", import.meta.url), stat = fs.lstatSync(url);
assert(stat.isFile() && (stat.mode & 0o777) === 0o644);
const bytes = fs.readFileSync(url);
assert.equal(sha(bytes), "338461e503c4770454cbe56ba2f74df7f3850043deaf11b04e1e379c3c88f250");
const data = JSON.parse(bytes.toString());
assert.equal(data.schema, 1);
assert.equal(data.sourceOnly, true);
assert.equal(data.runtimeCredit, false);
assert.equal(data.performanceCredit, false);
assert.equal(data.file, "crates/vize_patina/src/linter/script_rules/sfc.rs");
assert.equal(data.additionalFile, "crates/vize_patina/src/linter/script_rules/sfc/registered_sfc.rs");
const cells: Record<string, Body> = {};
for (const key of ["original", "current", "additional"]) {
  const cell = data[key], body = Buffer.from(cell.rawBase64, "base64");
  assert.equal(body.toString("base64"), cell.rawBase64);
  assert.equal(cell.mode, "100644");
  assert.equal(body.length, cell.bytes);
  assert.equal(sha(body), cell.sha256);
  assert.equal(blob(body), cell.blob);
  cells[key] = { mode: cell.mode, blob: cell.blob, bytes: cell.bytes, sha256: cell.sha256, body };
}
const original = cells.original.body.toString().split(/(?<=\n)/u);
const restored = cells.current.body.toString().split(/(?<=\n)/u);
for (const [i, j, k, l, before, after] of data.clauses.toReversed()) {
  assert.equal(original.slice(i,j).join(""), before);
  assert.equal(restored.slice(k,l).join(""), after);
  restored.splice(k,l-k,...(before ? before.split(/(?<=\n)/u) : []));
}
assert.deepEqual(Buffer.from(restored.join("")), cells.original.body);

/** A complete registered-rule caller and its real supplemental module preserve the original112 table. */
export function projectOwnedSfcDualCell(root: string, head: string, before: string,
  file: string, raw: Body | null, physical: Body | null) {
  if (file !== data.file || !raw || !physical || !raw.body.equals(cells.current.body))
    return { raw, physical };
  assert.deepEqual(raw, cells.current);
  assert.deepEqual(physical, cells.current);
  assert.equal(before, data.originalBeforeSource);
  const git = (args: string[]) => execFileSync("git", ["--no-replace-objects", ...args], {
    cwd: root, env: { ...process.env, GIT_NO_LAZY_FETCH: "1", GIT_ALLOW_PROTOCOL: "" },
  });
  const added = data.additionalFile;
  assert.equal(git(["ls-tree", "-z", before, "--", added]).length, 0);
  assert.deepEqual(git(["ls-tree", "-z", head, "--", added]),
    Buffer.from(`100644 blob ${cells.additional.blob}\t${added}\0`));
  assert.deepEqual(git(["cat-file", "blob", `${head}:${added}`]), cells.additional.body);
  const target = path.join(root, added), entry = fs.lstatSync(target);
  assert(entry.isFile() && (entry.mode & 0o777) === 0o644);
  assert.deepEqual(fs.readFileSync(target), cells.additional.body);
  const value = { ...cells.original, body: Buffer.from(cells.original.body) };
  return { raw: value, physical: { ...value, body: Buffer.from(value.body) } };
}
