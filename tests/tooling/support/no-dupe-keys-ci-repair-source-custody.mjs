import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { pathToFileURL } from "node:url";
import { gunzipSync } from "node:zlib";
import { copyNoMutatingCallerShallowBoundary } from "./no-mutating-props-current-caller-git.mjs";
import { prepareLiteralSource } from "../../performance/support/warm-type-backed-git-reader-nodeep.ts";
import {
  authenticateNoDupeKeysSourceFamily,
  reviewedNoDupeSourceReadView,
} from "./no-dupe-keys-source-custody.mjs";
import {
  authenticateNoMutatingModuleLayoutSourceFamily,
  runNoMutatingModuleLayoutHistoricalLaw,
} from "./no-mutating-props-module-layout-source-custody.mjs";

export const noDupeCIRepairDirectory =
  "tests/_fixtures/differential/linter/no-dupe-keys-447/source-custody/ci-repair";
const digest = (body) => createHash("sha256").update(body).digest("hex");
const blob = (body) =>
  createHash("sha1").update(`blob ${body.length}\0`).update(body).digest("hex");
const reader =
  (root) =>
  (name, ...args) =>
    fs.readFileSync(path.join(root, name), ...args);
const activeViews = new WeakMap();
const witness = "crates/vize_patina/src/linter/script_rules/dupe_keys_dispatch_tests.rs";
const originalWitnessSHA = "498319d459adf652860af2f329f2cff8a306997c9861acde70153a946de72370";
const originalParentTest =
  "crates/vize_patina/src/rules/vue/no_mutating_props/options_api/tests.rs";
const originalParentCarrierSHA = "80bc625aefac361bb6390fedba9641d6bbff127d78d5190fe6e695e4f41c0dff";
const carrier = "crates/vize_patina/src/linter/script_rules/sfc.rs";
const oldCallback = "crates/vize_patina/src/linter/script_rules/registered_sfc.rs";
const parentCarrierSHA = "4ba51a6cabd3fdb1ce973edfa7cf7bf4dac6d0bf12b6e9294ee75b9c3dd1ba46";
const originalDupeCarrierSHA = "eeab9a3f9bd6d5c587096bb994b5528eb46ff86d8cf0eca381c57033a818d440";
const originalParentTestSHA = "322f83c1bc7e0a2772e3eaa1b28d9de3693aad0995715f0fe55b50aa53e40fc3";

/** Every actual current body and archive is checked before a source-only projection. */
export function authenticateNoDupeCIRepairPhysical(root, read = reader(root)) {
  const physical = reader(root);
  const regular = (name) => {
    const status = fs.lstatSync(path.join(root, name));
    assert(status.isFile() && !status.isSymbolicLink() && !(status.mode & 0o111), name);
  };
  const check = (identity) => {
    regular(identity.path);
    const supplied = read(identity.path);
    assert.equal(supplied.length, identity.bytes, identity.path);
    assert.equal(digest(supplied), identity.sha256, identity.path);
    assert.equal(blob(supplied), identity.gitBlob, identity.path);
    assert.deepEqual(
      physical(identity.path),
      supplied,
      `physical source differs: ${identity.path}`,
    );
    return supplied;
  };
  const manifestPath = `${noDupeCIRepairDirectory}/successor.json`;
  regular(manifestPath);
  const bytes = read(manifestPath);
  assert.equal(digest(bytes), "a5824b2c80ef3ebf511ff09e45ff27e430e2ca2f08515077a59231f9c8fd86bb");
  assert.deepEqual(physical(manifestPath), bytes);
  const manifest = JSON.parse(bytes);
  assert.equal(manifest.schema, "vize.lint.no-dupe-keys-ci-source-successor");
  assert.equal(manifest.version, 1);
  assert.equal(manifest.source, "9da2c1f2469f256a06b304785641c6e2e376a10e");
  assert.equal(manifest.parent, "b48dbb85e257f1875a4df83113dfb20f4830e3a2");
  assert.equal(
    new Set(manifest.current.map(({ path: name }) => name)).size,
    manifest.current.length,
  );
  assert.deepEqual(manifest.absent, [oldCallback]);
  for (const name of manifest.absent) {
    let missing = false;
    try {
      fs.lstatSync(path.join(root, name));
    } catch (error) {
      assert.equal(error.code, "ENOENT");
      missing = true;
    }
    assert(missing, `old callback must be absent: ${name}`);
  }
  for (const identity of manifest.current) check(identity);
  for (const identity of manifest.archives) check(identity);
  for (const projection of [manifest.historicalProjection, manifest.parentProjection]) {
    assert.equal(new Set(projection.map(({ path: name }) => name)).size, projection.length);
    for (const entry of projection) {
      assert(
        manifest.current.some(({ path: name }) => name === entry.path) ||
          manifest.absent.includes(entry.path),
        entry.path,
      );
      assert(
        manifest.archives.some(({ path: name }) => name === entry.archive),
        entry.archive,
      );
    }
  }
  const original = JSON.parse(check(manifest.originalFamily));
  assert.equal(original.sources.length, 12);
  assert.equal(original.ownedBodies.length, 73);
  assert.equal(manifest.credit.native, false);
  assert.equal(manifest.credit.compiled, false);
  return manifest;
}

function project(root, read, manifest, kind) {
  const entries = kind === "parent" ? manifest.parentProjection : manifest.historicalProjection;
  const view = (name, ...args) => {
    const selected = entries.find(({ path: candidate }) => candidate === name);
    return read(selected ? selected.archive : name, ...args);
  };
  activeViews.set(view, { root, kind });
  return view;
}

/** The old complete source predicates execute in their exact failed-head context. */
export function authenticateNoDupeCIRepair(root, read = reader(root)) {
  const manifest = authenticateNoDupeCIRepairPhysical(root, read);
  const old = project(root, read, manifest, "historical");
  assert.deepEqual(
    authenticateNoDupeKeysSourceFamily(root, old),
    JSON.parse(read(manifest.originalFamily.path)),
  );
  const parent = relocatedParentContext(root, read, manifest);
  const corrected = authenticateNoMutatingModuleLayoutSourceFamily(parent.root, parent.read);
  assert.equal(corrected.native, false);
  assert.equal(corrected.compiled, false);
  return manifest;
}

/** Known literal historical reads retain their own full predicates and zero runtime credit. */
export function reviewedNoDupeCIRepairHistoricalReadView(root, read = reader(root)) {
  const known = activeViews.get(read);
  if (known) {
    // The unchanged predecessor tests create literal historical clones.
    // Their complete old predicates authenticate those clone roots separately.
    if (known.kind === "historical" && known.root !== root) return read;
    assert.equal(known.root, root);
    authenticateNoDupeCIRepairPhysical(root);
    return read;
  }
  if (digest(read(witness)) === originalWitnessSHA) return read;
  if (digest(read(originalParentTest)) === originalParentTestSHA) return read;
  return project(root, read, authenticateNoDupeCIRepairPhysical(root, read), "historical");
}

/** Parent guards keep their whole predicate and compare only an authenticated parent context. */
export function reviewedNoDupeCIRepairParentReadView(root, read = reader(root)) {
  const known = activeViews.get(read);
  if (known) {
    assert.equal(known.root, root);
    authenticateNoDupeCIRepairPhysical(root);
    assert.equal(known.kind, "parent");
    return read;
  }
  return project(root, read, authenticateNoDupeCIRepairPhysical(root, read), "parent");
}

/** This closes the actual child first; it never accepts a user-supplied physical callback. */
export function reviewedNoDupeCIRepairParentPhysicalReadView(root) {
  const read = reader(root);
  return project(root, read, authenticateNoDupeCIRepairPhysical(root, read), "parent");
}

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
/** Actual child source qualification precedes a genuine parent physical context. */
export function reviewedNoDupeCIRepairParentContext(root, read = reader(root)) {
  if (frameRoots.has(root)) return { root, read };
  const carrierSHA = digest(read(carrier));
  // A literal parent gets only its unchanged strict parent's authority.
  if (carrierSHA === parentCarrierSHA) return { root, read };
  if (carrierSHA === originalDupeCarrierSHA) {
    const manifest = authenticateNoDupeCIRepairPhysical(root);
    const incoming = reviewedNoDupeSourceReadView(root, read);
    return { root: legacyParentRoot(root, manifest), read: incoming };
  }
  if (carrierSHA === originalParentCarrierSHA) {
    try {
      const status = fs.lstatSync(path.join(root, oldCallback));
      if (status.isFile() && !status.isSymbolicLink() && !(status.mode & 0o111))
        return { root, read };
    } catch (error) {
      assert.equal(error.code, "ENOENT");
    }
    const manifest = authenticateNoDupeCIRepairPhysical(root);
    // Preserve the supplied historical callback so old full predicates still reject its mutations.
    return { root: legacyParentRoot(root, manifest), read };
  }
  const manifest = authenticateNoDupeCIRepairPhysical(root, read);
  return relocatedParentContext(root, read, manifest);
}
/** The old nine parent laws run unchanged against the strictly qualified relocated parent frame. */
export async function runNoDupeParentHistoricalLaw(root, law) {
  const manifest = authenticateNoDupeCIRepairPhysical(root);
  const parent = relocatedParentContext(root, reader(root), manifest);
  await runNoMutatingModuleLayoutHistoricalLaw(parent.root, law);
}
/** The four new parent laws run unchanged with all their original physical refusal controls. */
export async function runNoDupeParentModuleLayoutLaws(root) {
  const manifest = authenticateNoDupeCIRepairPhysical(root);
  const parent = relocatedParentContext(root, reader(root), manifest);
  const law = "tests/tooling/no-mutating-props-module-layout-source-custody.test.mjs";
  const archived = manifest.parentProjection.find(({ path: name }) => name === law);
  assert(archived);
  assert.deepEqual(parent.read(law), reader(root)(archived.archive));
  await import(pathToFileURL(path.join(parent.root, law)).href);
}

/** The unchanged parent caller runner proves current source refusal before all thirteen historical cases. */
export async function runNoDupeParentCurrentCallerHistory(root, law) {
  const manifest = authenticateNoDupeCIRepairPhysical(root);
  const parent = relocatedParentContext(root, reader(root), manifest);
  const caller = await import(
    pathToFileURL(
      path.join(
        parent.root,
        "tests/tooling/support/no-mutating-props-current-caller-source-custody.mjs",
      ),
    ).href
  );
  const result = await caller.runNoMutatingCurrentCallerHistory(parent.root, law);
  const bytes = fs.readFileSync(result.packet);
  const packetDirectory = path.join(root, "target/differential/no-dupe-parent-current-callers");
  fs.mkdirSync(packetDirectory, { recursive: true });
  const packet = path.join(packetDirectory, path.basename(law) + ".json");
  fs.writeFileSync(packet, bytes);
  assert.deepEqual(fs.readFileSync(packet), bytes);
  return { ...result, packet };
}
/** All parent current-source omission/mode/substitution laws retain their complete physical controls. */
export async function runNoDupeParentCurrentCallerLaws(root) {
  const manifest = authenticateNoDupeCIRepairPhysical(root);
  const parent = relocatedParentContext(root, reader(root), manifest);
  const law = "tests/tooling/no-mutating-props-current-callers-source.test.mjs";
  const archived = manifest.parentProjection.find(({ path: name }) => name === law);
  assert(archived);
  assert.deepEqual(parent.read(law), reader(root)(archived.archive));
  await import(pathToFileURL(path.join(parent.root, law)).href);
}

/** The parent's genuine missing-source and two-hop borrower controls retain all original assertions. */
export async function runNoDupeParentCurrentCallerShallowLaw(root) {
  const manifest = authenticateNoDupeCIRepairPhysical(root);
  const parent = relocatedParentContext(root, reader(root), manifest);
  const law = "tests/tooling/no-mutating-props-current-callers-shallow.test.mjs";
  const archived = manifest.parentProjection.find(({ path: name }) => name === law);
  assert(archived);
  assert.deepEqual(parent.read(law), reader(root)(archived.archive));
  await import(pathToFileURL(path.join(parent.root, law)).href);
}
