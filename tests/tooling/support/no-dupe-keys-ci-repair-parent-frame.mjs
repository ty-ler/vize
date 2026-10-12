import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { gunzipSync } from "node:zlib";
import { copyNoMutatingCallerShallowBoundary } from "./no-mutating-props-current-caller-git.mjs";
import { prepareLiteralSource } from "../../performance/support/warm-type-backed-git-reader-nodeep.ts";
import { authenticateNoMutatingModuleLayoutSourceFamily } from "./no-mutating-props-module-layout-source-custody.mjs";

const digest = (body) => createHash("sha256").update(body).digest("hex");
const blob = (body) =>
  createHash("sha1").update(`blob ${body.length}\0`).update(body).digest("hex");
const reader =
  (root) =>
  (name, ...args) =>
    fs.readFileSync(path.join(root, name), ...args);

const literalParentPools = new Map();
const parentFrames = new Map();
const legacyFrames = new Map();
const frameRoots = new Set();
process.once("exit", () => {
  for (const owned of frameRoots) fs.rmSync(owned, { recursive: true, force: true });
});
function materializeRows(rows) {
  const owned = fs.mkdtempSync(path.join(os.tmpdir(), "vize-no-dupe-parent-context-"));
  for (const [name, body] of rows) {
    assert(
      name &&
        !path.isAbsolute(name) &&
        path.normalize(name) === name &&
        !name.split("/").includes(".."),
    );
    const target = path.join(owned, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, body, { mode: 0o644, flag: "wx" });
  }
  frameRoots.add(owned);
  return owned;
}
function relocatedParentContext(root, read, manifest) {
  const key = root + ":" + manifest.parent;
  if (!parentFrames.has(key)) {
    const rows = legacyParentBodies(root, manifest);
    for (const entry of manifest.parentFrameChanges) {
      const body = read(entry.archive);
      assert.equal(body.length, entry.identity.bytes, entry.path);
      assert.equal(digest(body), entry.identity.sha256, entry.path);
      assert.equal(blob(body), entry.identity.gitBlob, entry.path);
      rows.set(entry.path, body);
    }
    for (const name of manifest.parentFrameAbsent) rows.delete(name);
    const owned = materializeRows(rows);
    authenticateLiteralParentFrame(root, manifest, rows, owned);
    parentFrames.set(key, { root: owned, rows });
  }
  const frame = parentFrames.get(key);
  const sourceRoot = frame.root;
  qualifyMaterializedParentFrame(sourceRoot, frame.rows, manifest.parent);
  const parentRead = reader(sourceRoot);
  // The unmodified strict parent qualifier authenticates this physical frame on every reuse.
  authenticateNoMutatingModuleLayoutSourceFamily(sourceRoot, parentRead);
  return { root: sourceRoot, read: parentRead };
}
/** A cached parent frame cannot hide later physical body, mode, link, or literal HEAD changes. */
function qualifyMaterializedParentFrame(root, rows, source) {
  for (const [name, body] of rows) {
    const target = path.join(root, name);
    const status = fs.lstatSync(target);
    assert(status.isFile() && !status.isSymbolicLink() && !(status.mode & 0o111), name);
    assert.equal(fs.realpathSync(target), path.join(fs.realpathSync(root), name), name);
    assert.deepEqual(fs.readFileSync(target), body, "cached parent whole body: " + name);
  }
  const head = path.join(root, ".git/HEAD");
  const status = fs.lstatSync(head);
  assert(status.isFile() && !status.isSymbolicLink() && !(status.mode & 0o111));
  assert.equal(fs.readFileSync(head, "utf8"), source + "\n");
}
/** Only this declared parent can hydrate into independently owned metadata and objects. */
function literalParentGit(root, source) {
  assert.equal(source, "b48dbb85e257f1875a4df83113dfb20f4830e3a2");
  for (const name of [
    "GIT_DIR",
    "GIT_WORK_TREE",
    "GIT_COMMON_DIR",
    "GIT_OBJECT_DIRECTORY",
    "GIT_INDEX_FILE",
    "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  ])
    assert(!process.env[name], "private parent Git refuses inherited path override: " + name);
  const git = (where, args) =>
    execFileSync("git", ["--no-replace-objects", ...args], { cwd: where });
  const key = fs.realpathSync(root) + "\0" + source;
  if (!literalParentPools.has(key)) {
    const common = git(root, ["rev-parse", "--git-common-dir"]).toString().trim();
    const objects = fs.realpathSync(path.resolve(root, common, "objects"));
    const origin = git(root, ["remote", "get-url", "origin"]).toString().trim();
    assert(origin && !/[\r\n]/u.test(origin));
    assert(!/[\r\n]/u.test(objects));
    const owned = fs.mkdtempSync(path.join(os.tmpdir(), "vize-no-dupe-literal-parent-git-"));
    fs.mkdirSync(path.join(owned, ".git/objects/info"), { recursive: true });
    fs.mkdirSync(path.join(owned, ".git/refs"));
    fs.writeFileSync(path.join(owned, ".git/objects/info/alternates"), objects + "\n");
    fs.writeFileSync(path.join(owned, ".git/HEAD"), source + "\n");
    fs.writeFileSync(
      path.join(owned, ".git/config"),
      '[core]\nrepositoryformatversion = 0\nbare = false\n[remote "origin"]\nurl = ' +
        JSON.stringify(origin) +
        "\n",
    );
    copyNoMutatingCallerShallowBoundary(root, owned);
    frameRoots.add(owned);
    literalParentPools.set(key, owned);
  }
  const owned = literalParentPools.get(key);
  prepareLiteralSource(owned, source);
  const commit = git(owned, ["cat-file", "commit", source]);
  assert.equal(
    createHash("sha1").update(`commit ${commit.length}\0`).update(commit).digest("hex"),
    source,
  );
  assert.equal(git(owned, ["rev-parse", "HEAD"]).toString().trim(), source);
  return owned;
}
/** Every materialized body joins the real parent Git tree; the isolated HEAD is that literal commit. */
function authenticateLiteralParentFrame(root, manifest, rows, owned) {
  const git = (where, args) =>
    execFileSync("git", ["--no-replace-objects", ...args], {
      cwd: where,
      maxBuffer: 32 * 1024 * 1024,
    });
  assert.match(manifest.parent, /^[a-f0-9]{40}$/u);
  const sourceGit = literalParentGit(root, manifest.parent);
  assert.equal(git(sourceGit, ["cat-file", "-t", manifest.parent]).toString().trim(), "commit");
  const tree = new Map();
  for (const line of git(sourceGit, ["ls-tree", "-r", "-z", manifest.parent])
    .toString("utf8")
    .split("\0")) {
    if (!line) continue;
    const match = /^([0-9]{6}) (blob|tree|commit) ([a-f0-9]{40})\t(.+)$/u.exec(line);
    assert(match, "complete literal parent tree row");
    assert(!tree.has(match[4]), match[4]);
    tree.set(match[4], { mode: match[1], kind: match[2], blob: match[3] });
  }
  for (const [name, body] of rows) {
    const row = tree.get(name);
    assert(row && row.mode === "100644" && row.kind === "blob", name);
    assert.equal(blob(body), row.blob, "parent whole Git body: " + name);
  }
  const common = git(sourceGit, ["rev-parse", "--git-common-dir"]).toString().trim();
  const objects = fs.realpathSync(path.resolve(sourceGit, common, "objects"));
  const origin = git(sourceGit, ["remote", "get-url", "origin"]).toString().trim();
  assert(origin && !/[\r\n]/u.test(origin));
  assert(!/[\r\n]/u.test(objects));
  fs.mkdirSync(path.join(owned, ".git/objects/info"), { recursive: true });
  fs.mkdirSync(path.join(owned, ".git/refs"));
  fs.writeFileSync(path.join(owned, ".git/objects/info/alternates"), objects + "\n");
  fs.writeFileSync(path.join(owned, ".git/HEAD"), manifest.parent + "\n");
  copyNoMutatingCallerShallowBoundary(sourceGit, owned);
  fs.writeFileSync(
    path.join(owned, ".git/config"),
    '[core]\nrepositoryformatversion = 0\nbare = false\n[remote "origin"]\nurl = ' +
      JSON.stringify(origin) +
      "\n",
  );
  assert.equal(git(owned, ["rev-parse", "HEAD"]).toString().trim(), manifest.parent);
  assert.deepEqual(
    git(owned, ["cat-file", "commit", manifest.parent]),
    git(sourceGit, ["cat-file", "commit", manifest.parent]),
  );
}
function legacyParentBodies(root, manifest) {
  const snapshotPath = manifest.parentLegacySnapshot;
  assert(manifest.current.some(({ path: name }) => name === snapshotPath));
  const bytes = reader(root)(snapshotPath);
  const packet = JSON.parse(gunzipSync(bytes));
  assert.equal(packet.schema, "vize.lint.no-mutating-props-ancestor-source-snapshot");
  assert.equal(packet.source, "2690dafc8af3e7a78095f287eaaf494eb33d0eaf");
  assert.deepEqual(packet.credit, { compiled: false, native: false, performance: false });
  assert.equal(new Set(packet.files.map(({ path: name }) => name)).size, packet.files.length);
  const rows = new Map();
  for (const identity of packet.files) {
    assert.equal(identity.mode, "100644");
    const body = Buffer.from(identity.base64, "base64");
    assert.equal(body.toString("base64"), identity.base64);
    assert.equal(body.length, identity.bytes, identity.path);
    assert.equal(digest(body), identity.sha256, identity.path);
    assert.equal(blob(body), identity.gitBlob, identity.path);
    rows.set(identity.path, body);
  }
  return rows;
}
function legacyParentRoot(root, manifest) {
  const rows = legacyParentBodies(root, manifest);
  const key = root + ":" + manifest.parentLegacySnapshot;
  if (!legacyFrames.has(key)) legacyFrames.set(key, materializeRows(rows));
  return legacyFrames.get(key);
}

export { relocatedParentContext, legacyParentRoot };
export const parentFrameMembership = Object.freeze({
  has: (root) => frameRoots.has(root),
});
