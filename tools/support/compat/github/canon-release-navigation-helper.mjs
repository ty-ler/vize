import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { authenticateCanonProductSource } from "./canon-product-source-context.mjs";
const sha = (body) => createHash("sha256").update(body).digest("hex");
const blob = (body) =>
  createHash("sha1").update(`blob ${body.length}\0`).update(body).digest("hex");
const packetPath =
  "tests/_fixtures/differential/canon/release-js-pragma-opaque-slots/navigation-helper-successor.json";
const packetSHA = "558fa8bafc4b539bf6c6a3a3b242265eecb3786261e69db062eb815720910e9a";
function regular(root, file) {
  let target = root;
  for (const part of file.split("/")) {
    target = path.join(target, part);
    assert(!fs.lstatSync(target).isSymbolicLink());
  }
  const stat = fs.lstatSync(target);
  assert(stat.isFile() && (stat.mode & 0o777) === 0o644);
  return fs.readFileSync(target);
}
function identity(body, cell) {
  assert.equal(body.length, cell.bytes);
  assert.equal(sha(body), cell.sha256);
  assert.equal(blob(body), cell.blob);
}
const helpers = (source) =>
  [
    ...source
      .toString()
      .matchAll(
        /"(  type __Vize(?:EmptyVueNavigationSlots|NativeNavigationSlots|NavigationSlots)<[^\n]+)"/gu,
      ),
  ].map(([literal]) => JSON.parse(literal));
/** Actual complete source, producer and sealed eleven packets precede this generated-only inverse. */
export function authenticateReleaseNavigationHelper(root) {
  root = fs.realpathSync(root);
  const receipt = authenticateCanonProductSource(root);
  const bytes = regular(root, packetPath);
  assert.equal(sha(bytes), packetSHA);
  const packet = JSON.parse(bytes);
  assert.equal(packet.schema, "vize.release-navigation-helper.successor");
  assert.equal(packet.sourceOnly, true);
  assert.equal(packet.runtimeCredit, false);
  assert.equal(packet.nativeProducerCredit, false);
  const git = (args) =>
    execFileSync("git", ["--no-replace-objects", "--literal-pathspecs", ...args], {
      cwd: root,
      maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, GIT_NO_LAZY_FETCH: "1", GIT_ALLOW_PROTOCOL: "" },
    });
  for (const [side, revision] of [
    ["before", packet.source],
    ["after", receipt.head],
  ]) {
    const cell = packet.producer[side];
    const tree = git(["ls-tree", "-z", revision, "--", packet.producer.path]);
    assert.equal(tree.toString(), `100644 blob ${cell.blob}\t${packet.producer.path}\0`);
    const body = git(["cat-file", "blob", cell.blob]);
    identity(body, cell);
    assert.deepEqual(body, Buffer.from(cell.rawBase64, "base64"));
    assert.equal(helpers(body).length, 3);
    assert.equal(helpers(body).join(""), packet[side]);
    if (side === "after") assert.deepEqual(regular(root, packet.producer.path), body);
  }
  assert.equal(Buffer.byteLength(packet.before), 1138);
  assert.equal(Buffer.byteLength(packet.after), 1242);
  assert.equal(packet.delta, 104);
  let restored = packet.after;
  for (const [start, end, current, old] of packet.inverse.toReversed()) {
    assert.equal(restored.slice(start, end), current);
    restored = restored.slice(0, start) + old + restored.slice(end);
  }
  assert.equal(restored, packet.before);
  const metadataBytes = regular(root, packet.sealed11.metadataPath);
  assert.equal(sha(metadataBytes), packet.sealed11.metadataSHA256);
  const metadata = JSON.parse(metadataBytes);
  assert.equal(metadata.sourceOnly, true);
  assert.equal(metadata.runtimeCredit, false);
  assert.equal(metadata.nativeProducerCredit, false);
  assert.equal(metadata.source.path, packet.producer.path);
  assert.equal(metadata.source.sha256, packet.producer.after.sha256);
  const compressed = regular(root, packet.sealed11.originalsPath);
  assert.equal(sha(compressed), packet.sealed11.originalsSHA256);
  assert.equal(sha(compressed), metadata.originalCapsule.compressedSHA256);
  const raw = gunzipSync(compressed);
  assert.equal(sha(raw), metadata.originalCapsule.rawSHA256);
  const originals = JSON.parse(raw);
  assert.equal(originals.length, 11);
  assert.equal(metadata.entries.length, 11);
  assert.equal(new Set(metadata.entries.map((entry) => entry.path)).size, 11);
  assert.deepEqual(
    originals.map(({ path: file }) => file),
    metadata.entries.map(({ path: file }) => file),
  );
  for (let index = 0; index < 11; index++) {
    const row = metadata.entries[index];
    const before = Buffer.from(originals[index].rawBase64, "base64");
    assert.equal(before.toString("base64"), originals[index].rawBase64);
    identity(before, row.before);
    const after = regular(root, row.path);
    identity(after, row.after);
    assert.equal(
      git(["ls-tree", "-z", receipt.head, "--", row.path]).toString(),
      `100644 blob ${row.after.blob}\t${row.path}\0`,
    );
    assert.deepEqual(git(["cat-file", "blob", row.after.blob]), after);
    let forward = before.toString();
    for (const clause of row.clauses) {
      assert.equal(forward.split(clause.before).length - 1, clause.count);
      forward = forward.replaceAll(clause.before, clause.after);
    }
    assert.deepEqual(Buffer.from(forward), after);
    let inverse = after.toString();
    for (const clause of row.clauses.toReversed()) {
      assert.equal(inverse.split(clause.after).length - 1, clause.count);
      inverse = inverse.replaceAll(clause.after, clause.before);
    }
    assert.deepEqual(Buffer.from(inverse), before);
    const generated = row.path.startsWith("crates/")
      ? [after.toString()]
      : JSON.parse(after).files.map(({ virtualTs }) => virtualTs);
    for (const text of generated.filter((text) => text.includes("__VizeEmptyVueNavigationSlots")))
      for (const helper of helpers(Buffer.from(packet.producer.after.rawBase64, "base64")))
        assert.equal(text.split(helper).length - 1, 1);
  }
  assert.equal(git(["rev-parse", "HEAD"]).toString().trim(), receipt.head);
  return Object.freeze({
    before: packet.before,
    after: packet.after,
    beforeBytes: 1138,
    afterBytes: 1242,
    delta: 104,
    sealedPackets: 11,
    sourceOnly: true,
    runtimeCredit: false,
    nativeProducerCredit: false,
    head: receipt.head,
  });
}
