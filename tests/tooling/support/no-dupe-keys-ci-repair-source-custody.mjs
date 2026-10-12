import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  authenticateNoDupeKeysSourceFamily,
  reviewedNoDupeSourceReadView,
} from "./no-dupe-keys-source-custody.mjs";
import {
  authenticateNoMutatingModuleLayoutSourceFamily,
  runNoMutatingModuleLayoutHistoricalLaw,
} from "./no-mutating-props-module-layout-source-custody.mjs";
import {
  parentFrameMembership as frameRoots,
  relocatedParentContext,
  legacyParentRoot,
} from "./no-dupe-keys-ci-repair-parent-frame.mjs";

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
