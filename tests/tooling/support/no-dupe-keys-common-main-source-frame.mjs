import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { deflateSync, gunzipSync, inflateSync } from "node:zlib";
import { copyNoMutatingCallerShallowBoundary } from "./no-mutating-props-current-caller-git.mjs";
import {
  joinGit,
  joinIdentity,
  joinObjectID,
  joinPhysical,
  joinRawBodies,
  joinSHA,
} from "./no-mutating-component-join-physical.mjs";
import {
  sourceCredit,
  sourceIdentity,
  sourcePath,
  uniquePaths,
} from "./no-dupe-keys-common-main-source-physical.mjs";

const pools = new Map();
process.once("exit", () => {
  for (const owned of pools.values()) fs.rmSync(owned, { recursive: true, force: true });
});
function rawObjects(frame) {
  assert.equal(new Set(frame.sourceObjects.map((row) => row.oid)).size, frame.sourceObjects.length);
  const objects = new Map();
  for (const row of frame.sourceObjects) {
    assert(["blob", "tree", "commit"].includes(row.kind));
    assert.match(row.oid, /^[a-f0-9]{40}$/u);
    const body = Buffer.from(row.rawBase64, "base64");
    assert.equal(body.toString("base64"), row.rawBase64);
    assert.equal(body.length, row.bytes);
    assert.equal(joinSHA(body), row.sha256);
    assert.equal(joinObjectID(row.kind, body), row.oid);
    objects.set(row.oid, { kind: row.kind, body });
  }
  assert.equal(objects.get(frame.source)?.kind, "commit");
  assert.equal(objects.get(frame.tree)?.kind, "tree");
  for (const file of frame.files) {
    const object = objects.get(file.gitBlob);
    assert.equal(object?.kind, "blob", file.path);
    joinIdentity(object.body, file);
  }
  return objects;
}
function metadata(root, source, objects) {
  const key = fs.realpathSync(root) + "\0" + source;
  if (pools.has(key)) return pools.get(key);
  const owned = fs.mkdtempSync(path.join(os.tmpdir(), "vize-no-dupe-common-literal-"));
  pools.set(key, owned);
  const common = joinGit(root, ["rev-parse", "--git-common-dir"]).toString().trim();
  const shared = fs.realpathSync(path.resolve(root, common, "objects"));
  const origin = joinGit(root, ["remote", "get-url", "origin"]).toString().trim();
  assert(shared && origin && !/[\r\n]/u.test(shared + origin));
  fs.mkdirSync(path.join(owned, ".git/objects/info"), { recursive: true });
  fs.mkdirSync(path.join(owned, ".git/refs"));
  fs.writeFileSync(path.join(owned, ".git/HEAD"), source + "\n");
  fs.writeFileSync(path.join(owned, ".git/objects/info/alternates"), shared + "\n");
  fs.writeFileSync(
    path.join(owned, ".git/config"),
    '[core]\nrepositoryformatversion = 0\nbare = false\n[maintenance]\nauto = false\n[gc]\nauto = 0\n[remote "origin"]\nurl = ' +
      JSON.stringify(origin) +
      "\n",
  );
  copyNoMutatingCallerShallowBoundary(root, owned);
  for (const [oid, { kind, body }] of objects) {
    const filename = path.join(owned, ".git/objects", oid.slice(0, 2), oid.slice(2));
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    fs.writeFileSync(
      filename,
      deflateSync(Buffer.concat([Buffer.from(kind + " " + body.length + "\0"), body])),
      { mode: 0o444, flag: "wx" },
    );
  }
  return owned;
}
function requalifyObjects(owned, objects) {
  for (const [oid, { kind, body }] of objects) {
    const target = path.join(owned, ".git/objects", oid.slice(0, 2), oid.slice(2));
    const stat = fs.lstatSync(target);
    assert(stat.isFile() && !stat.isSymbolicLink() && !(stat.mode & 0o111));
    assert.deepEqual(
      inflateSync(fs.readFileSync(target)),
      Buffer.concat([Buffer.from(kind + " " + body.length + "\0"), body]),
    );
  }
}
export function authenticateCommonLiteralFrame(root, declared, registry) {
  const frame = JSON.parse(gunzipSync(joinPhysical(root, declared)));
  assert.equal(frame.schema, "vize.no-dupe-keys.complete-literal-source-frame");
  assert.equal(frame.version, 1);
  assert.equal(frame.source, declared.source);
  assert.deepEqual(frame.credit, sourceCredit);
  uniquePaths(frame.files.map((row) => row.path));
  frame.files.forEach(sourceIdentity);
  assert.equal(frame.files.length, declared.files);
  uniquePaths(frame.genuineAbsentPaths);
  assert.equal(frame.genuineAbsentPaths.length, declared.genuineAbsentPaths);
  uniquePaths(frame.laws.map((row) => row.path));
  assert.deepEqual(
    frame.laws.map((row) => row.path),
    registry.filter((row) => row.sources.includes(frame.source)).map((row) => row.path),
  );
  for (const law of frame.laws) {
    sourceIdentity(law);
    assert(Number.isSafeInteger(law.cases) && law.cases > 0);
    joinIdentity(Buffer.from(law.rawBase64, "base64"), law);
  }
  const objects = rawObjects(frame);
  const owned = metadata(root, frame.source, objects);
  requalifyObjects(owned, objects);
  const commit = joinGit(owned, ["cat-file", "commit", frame.source]);
  assert.equal(joinObjectID("commit", commit), frame.source);
  assert.deepEqual(commit, Buffer.from(frame.commit.rawBase64, "base64"));
  assert.equal(commit.length, frame.commit.bytes);
  assert.equal(joinSHA(commit), frame.commit.sha256);
  assert.equal(commit.subarray(0, commit.indexOf(10)).toString(), "tree " + frame.tree);
  const bodies = joinRawBodies(owned, frame.source, frame.files);
  for (const name of frame.genuineAbsentPaths) assert(!bodies.has(name));
  if (frame.genuineAbsentPaths.length)
    assert.equal(
      joinGit(owned, [
        "ls-tree",
        "-z",
        frame.source,
        "--",
        ...frame.genuineAbsentPaths.map(sourcePath),
      ]).length,
      0,
    );
  for (const prefix of frame.completeSubtreeScopes) {
    assert(prefix.endsWith("/"));
    sourcePath(prefix.slice(0, -1));
    const actual = joinGit(owned, ["ls-tree", "-r", "-z", frame.source, "--", prefix])
      .toString()
      .split("\0")
      .filter(Boolean)
      .map((row) => row.slice(row.indexOf("\t") + 1));
    assert.deepEqual(
      actual,
      frame.files.filter((row) => row.path.startsWith(prefix)).map((row) => row.path),
    );
  }
  for (const law of frame.laws)
    assert.deepEqual(bodies.get(law.path), Buffer.from(law.rawBase64, "base64"));
  for (const [name, body] of bodies) {
    const target = path.join(owned, name);
    if (!fs.existsSync(target)) {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, body, { mode: 0o644, flag: "wx" });
    }
    joinPhysical(
      owned,
      frame.files.find((row) => row.path === name),
    );
  }
  for (const name of frame.genuineAbsentPaths)
    assert.throws(() => fs.lstatSync(path.join(owned, name)), { code: "ENOENT" });
  const head = path.join(owned, ".git/HEAD");
  const stat = fs.lstatSync(head);
  assert(stat.isFile() && !stat.isSymbolicLink() && !(stat.mode & 0o111));
  assert.equal(fs.readFileSync(head, "utf8"), frame.source + "\n");
  assert.equal(joinGit(owned, ["rev-parse", "HEAD"]).toString().trim(), frame.source);
  return { frame, root: owned, bodies, ...sourceCredit };
}
