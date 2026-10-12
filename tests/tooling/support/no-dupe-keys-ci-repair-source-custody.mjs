import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { pathToFileURL } from "node:url";
import { gunzipSync } from "node:zlib";
import { authenticateNoDupeKeysSourceFamily } from "./no-dupe-keys-source-custody.mjs";
import { authenticateNoMutatingTestCorrection } from "./no-mutating-props-test-correction-source-custody.mjs";

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
  assert.equal(digest(bytes), "d1b4fce34e3ffb444f6c410d2dbfa29a40d42608cb2342b9abf5dcd79cd86701");
  assert.deepEqual(physical(manifestPath), bytes);
  const manifest = JSON.parse(bytes);
  assert.equal(manifest.schema, "vize.lint.no-dupe-keys-ci-source-successor");
  assert.equal(manifest.version, 1);
  assert.equal(manifest.source, "9da2c1f2469f256a06b304785641c6e2e376a10e");
  assert.equal(manifest.parent, "2690dafc8af3e7a78095f287eaaf494eb33d0eaf");
  assert.equal(
    new Set(manifest.current.map(({ path: name }) => name)).size,
    manifest.current.length,
  );
  for (const identity of manifest.current) check(identity);
  for (const identity of manifest.archives) check(identity);
  for (const projection of [manifest.historicalProjection, manifest.parentProjection]) {
    assert.equal(new Set(projection.map(({ path: name }) => name)).size, projection.length);
    for (const entry of projection) {
      assert(
        manifest.current.some(({ path: name }) => name === entry.path),
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
  const parent = project(root, read, manifest, "parent");
  const corrected = authenticateNoMutatingTestCorrection(root, parent);
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

/** Run the five original parent laws unchanged against their complete ancestor source context. */
export async function runNoDupeParentCorrectionLaws(root) {
  const manifest = authenticateNoDupeCIRepairPhysical(root);
  const snapshotPath = `${noDupeCIRepairDirectory}/parent-source-snapshot.json.gz`;
  assert(manifest.current.some(({ path: name }) => name === snapshotPath));
  const packet = JSON.parse(gunzipSync(reader(root)(snapshotPath)));
  assert.equal(packet.schema, "vize.lint.no-dupe-parent-source-snapshot");
  assert.equal(packet.version, 1);
  assert.equal(packet.source, "2690dafc8af3e7a78095f287eaaf494eb33d0eaf");
  assert.equal(packet.credit.native, false);
  assert.equal(packet.credit.compiled, false);
  assert.equal(new Set(packet.files.map(({ path: name }) => name)).size, packet.files.length);
  const owned = fs.mkdtempSync(path.join(os.tmpdir(), "vize-no-dupe-parent-source-"));
  try {
    for (const identity of packet.files) {
      assert(identity.path && !path.isAbsolute(identity.path));
      assert.equal(path.normalize(identity.path), identity.path);
      assert(!identity.path.split("/").includes(".."));
      const body = Buffer.from(identity.base64, "base64");
      assert.equal(body.length, identity.bytes, identity.path);
      assert.equal(digest(body), identity.sha256, identity.path);
      assert.equal(blob(body), identity.gitBlob, identity.path);
      const target = path.join(owned, identity.path);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, body, { mode: 0o644, flag: "wx" });
    }
    const law = "tests/tooling/no-mutating-props-test-correction-source-custody.test.mjs";
    const original = manifest.parentProjection.find(({ path: name }) => name === law);
    assert(original);
    assert.deepEqual(fs.readFileSync(path.join(owned, law)), reader(root)(original.archive));
    await import(pathToFileURL(path.join(owned, law)).href);
  } finally {
    fs.rmSync(owned, { recursive: true, force: true });
  }
}
