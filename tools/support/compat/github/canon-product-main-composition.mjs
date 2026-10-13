import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
const equalBytes = (actual, expected, message) => {
  assert(Buffer.isBuffer(actual) && Buffer.isBuffer(expected), "whole byte buffers");
  assert.equal(actual.length, expected.length, message);
  assert(actual.equals(expected), message);
};
const sha = (body) => createHash("sha256").update(body).digest("hex");
const blob = (body) =>
  createHash("sha1").update(`blob ${body.length}\0`).update(body).digest("hex");
const packetBytes = fs.readFileSync(
  new URL("canon-product-main-composition.json.gz", import.meta.url),
);
assert.equal(sha(packetBytes), "dbf36412602739f0b646ccc841079f9cf50ebd16654154751c883a07bb0c605c");
const packet = JSON.parse(gunzipSync(packetBytes));
assert.equal(packet.source, "c4f74b48fb2df6ea20aeb414193d82f531ab059e");
assert.equal(packet.sourceOnly, true);
assert.equal(packet.runtimeCredit, false);
const cells = new Map();
for (const entry of packet.cells) {
  assert(!cells.has(entry.file));
  for (const side of ["before", "after"]) {
    const cell = entry[side];
    if (!cell) continue;
    const body = Buffer.from(cell.rawBase64, "base64");
    assert.equal(body.toString("base64"), cell.rawBase64);
    assert.equal(body.length, cell.bytes);
    assert.equal(blob(body), cell.blob);
    assert.equal(sha(body), cell.sha256);
    assert.match(cell.mode, /^100(?:644|755)$/u);
  }
  const before = entry.before && Buffer.from(entry.before.rawBase64, "base64");
  let recovered = Buffer.from(entry.after.rawBase64, "base64");
  for (const [start, end, current, original] of entry.clauses.toReversed()) {
    equalBytes(recovered.subarray(start, end), Buffer.from(current, "base64"));
    recovered = Buffer.concat([
      recovered.subarray(0, start),
      Buffer.from(original, "base64"),
      recovered.subarray(end),
    ]);
  }
  equalBytes(recovered, before ?? Buffer.alloc(0));
  cells.set(entry.file, entry);
}
export const canonProductCompositionPaths = Object.freeze([...cells.keys()]);
export const canonProductSdkPaths = Object.freeze(packet.sdkPaths);
const git = (root, args, input) =>
  execFileSync("git", ["--no-replace-objects", "--literal-pathspecs", ...args], {
    cwd: root,
    input,
    maxBuffer: 128 * 1024 * 1024,
    env: { ...process.env, GIT_NO_LAZY_FETCH: "1", GIT_ALLOW_PROTOCOL: "" },
  });
function raw(root, revision, side) {
  const tree = git(root, ["ls-tree", "-rz", revision, "--", ...cells.keys()]);
  equalBytes(Buffer.from(tree.toString()), tree);
  assert.equal(tree.at(-1), 0);
  const entries = new Map(
    tree
      .toString()
      .slice(0, -1)
      .split("\0")
      .map((row) => {
        const match = /^(100644|100755) blob ([a-f0-9]{40})\t(.+)$/u.exec(row);
        assert(match && cells.has(match[3]));
        return [match[3], { mode: match[1], blob: match[2] }];
      }),
  );
  const chosen = packet.cells.filter((entry) => entry[side]);
  assert.equal(entries.size, chosen.length);
  const batch = git(
    root,
    ["cat-file", "--batch"],
    chosen.map((entry) => entries.get(entry.file).blob).join("\n") + "\n",
  );
  let offset = 0;
  const result = new Map();
  for (const entry of packet.cells) {
    const cell = entry[side];
    if (!cell) {
      assert(!entries.has(entry.file));
      continue;
    }
    assert.deepEqual(entries.get(entry.file), { mode: cell.mode, blob: cell.blob });
    const end = batch.indexOf(10, offset);
    assert.equal(batch.subarray(offset, end).toString(), `${cell.blob} blob ${cell.bytes}`);
    const body = Buffer.from(batch.subarray(end + 1, end + 1 + cell.bytes));
    offset = end + 2 + cell.bytes;
    assert.equal(batch[offset - 1], 10);
    equalBytes(body, Buffer.from(cell.rawBase64, "base64"));
    result.set(entry.file, { mode: cell.mode, blob: cell.blob, body });
  }
  assert.equal(offset, batch.length);
  return result;
}
export function authenticateCanonProductComposition(root, head) {
  raw(root, packet.source, "before");
  const current = raw(root, head, "after");
  for (const [file, cell] of current) {
    let target = root;
    for (const segment of file.split("/")) {
      target = path.join(target, segment);
      assert(!fs.lstatSync(target).isSymbolicLink());
    }
    const stat = fs.lstatSync(target);
    assert(stat.isFile() && (stat.mode & 0o777) === Number.parseInt(cell.mode.slice(3), 8));
    equalBytes(fs.readFileSync(target), cell.body, "whole physical main composition: " + file);
  }
  const unionBytes = fs.readFileSync(
    new URL("canon-product-sdk-three-union.json", import.meta.url),
  );
  assert.equal(sha(unionBytes), "5be0a4ab0ef4b4bd0902498ed3aee0ecf3239c8d9d240a5f542ff1bf687b27a3");
  const union = JSON.parse(unionBytes);
  assert.equal(union.source, "2da71113a3f8ab528b1a9cda20fc6a4c2bd273f6");
  assert.equal(union.actualIncoming, packet.source);
  assert.equal(union.cells.length, 3);
  for (const entry of union.cells) {
    const body = current.get(entry.file).body;
    assert.equal(blob(body), entry.after.blob);
    assert.equal(sha(body), entry.after.sha256);
    assert.equal(body.length, entry.after.length);
    assert.equal(current.get(entry.file).mode, entry.after.mode);
    let restored = body;
    for (const [start, end, now, old] of entry.clauses.toReversed()) {
      equalBytes(restored.subarray(start, end), Buffer.from(now, "base64"));
      restored = Buffer.concat([
        restored.subarray(0, start),
        Buffer.from(old, "base64"),
        restored.subarray(end),
      ]);
    }
    const literal = git(root, ["show", union.source + ":" + entry.file]);
    equalBytes(restored, literal);
    assert.equal(blob(literal), entry.before.blob);
    assert.equal(sha(literal), entry.before.sha256);
    assert.equal(literal.length, entry.before.length);
    assert.equal(entry.before.mode, "100644");
    assert.equal(
      git(root, ["ls-tree", union.source, "--", entry.file]).toString().split(" ")[0],
      entry.before.mode,
    );
  }
  return current;
}
