import { reviewedNoDupeCIRepairHistoricalReadView } from "./no-dupe-keys-ci-repair-source-custody.mjs";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { authenticateNoMutatingPropsSourceFamily } from "./no-mutating-props-source-custody.mjs";

export const noDupeCustodyDirectory =
  "tests/_fixtures/differential/linter/no-dupe-keys-447/source-custody";
const digest = (body) => createHash("sha256").update(body).digest("hex");
const blob = (body) =>
  createHash("sha1").update(`blob ${body.length}\0`).update(body).digest("hex");
const matches = (body, identity) =>
  body.length === identity.bytes && digest(body) === identity.sha256;
const reader = (root) => (name) => fs.readFileSync(path.join(root, name));
const selectedRead = "  read = reviewedNoDupeSourceReadView(root, read);\n";
const helperImport =
  'import { reviewedNoDupeSourceReadView } from "./no-dupe-keys-source-custody.mjs";\n';
const helperEntries = [
  "authenticateNoMutatingPropsSourceFamily(root, read = reader(root))",
  "reviewedNoMutatingSourceReadView(root, read = reader(root))",
  "reviewedNoMutatingHelperHistoryReadView(root, read = reader(root))",
  "reviewedNoMutatingHistoricalCaseReadView(root, read = reader(root))",
];

/** Retain each complete incoming predicate, adding only the authenticated read view. */
export function composeNoDupeIncomingHelper(original) {
  let body = original.toString();
  for (const entry of helperEntries) {
    const before = `export function ${entry} {\n`;
    assert.equal(body.split(before).length, 2);
    body = body.replace(before, before + selectedRead);
  }
  return Buffer.from(helperImport + body);
}

export function composeNoDupeHistoricalLaw(original) {
  const before = "const read = (name) => fs.readFileSync(path.join(root, name));\n";
  const body = original.toString();
  assert.equal(body.split(before).length, 2);
  const after =
    "const physicalRead = (name) => fs.readFileSync(path.join(root, name));\n" +
    "const read = reviewedNoDupeHistoricalCaseReadView(root, physicalRead);\n";
  return Buffer.from(
    'import { reviewedNoDupeHistoricalCaseReadView } from "./support/no-dupe-keys-source-custody.mjs";\n' +
      body.replace(before, after),
  );
}

/** Complete source custody only. This establishes no native or performance acceptance. */
export function authenticateNoDupeKeysSourceFamily(root, read = reader(root)) {
  read = reviewedNoDupeCIRepairHistoricalReadView(root, read);
  const manifestPath = `${noDupeCustodyDirectory}/successor.json`;
  const bytes = read(manifestPath);
  assert.equal(digest(bytes), "e03ce63b3186777006c71c65f611c3e42f7f89ecad79a5262bc5a389980a9356");
  const manifest = JSON.parse(bytes);
  assert.equal(manifest.schema, "vize.lint.no-dupe-keys-source-successor");
  assert.equal(manifest.version, 1);
  assert.equal(manifest.base, "dd760a4eb1299c88a1e58d4acc921a02e715844d");
  const checked = new Set([manifestPath]);
  const check = (name, identity) => {
    const body = read(name);
    assert(matches(body, identity), `unknown whole source body: ${name}`);
    assert.equal(blob(body), identity.gitBlob);
    checked.add(name);
    return body;
  };
  const incomingBytes = check(manifest.incomingFamily.path, manifest.incomingFamily);
  const incoming = JSON.parse(incomingBytes);
  assert.equal(incoming.schema, "vize.lint.no-mutating-props-sfc-source-successor");
  assert.equal(manifest.sources.length, 12);
  assert.deepEqual(
    manifest.sources.map(({ path: name }) => name),
    incoming.sources.map(({ path: name }) => name),
  );
  assert.deepEqual(manifest.changedPaths, [
    "crates/vize_patina/src/rules/script.rs",
    "crates/vize_patina/src/linter/script_rules.rs",
    "crates/vize_patina/src/linter/script_rules/sfc.rs",
  ]);
  assert.equal(manifest.sources.filter(({ changed }) => changed).length, 3);
  for (const [index, source] of manifest.sources.entries()) {
    assert.deepEqual(source.before, incoming.sources[index].after);
    check(source.before.archive, source.before);
    check(source.after.archive, source.after);
    check(source.path, source.after);
    assert.equal(source.changed, manifest.changedPaths.includes(source.path));
    if (source.changed) assert.notEqual(source.before.sha256, source.after.sha256);
    else assert.deepEqual(source.after, source.before);
  }
  assert.equal(
    new Set(manifest.ownedBodies.map(({ path: name }) => name)).size,
    manifest.ownedBodies.length,
  );
  for (const source of manifest.ownedBodies) {
    assert(!manifest.sources.some(({ path: name }) => name === source.path));
    if (source.before.absent) assert.deepEqual(source.before, { path: source.path, absent: true });
    else check(source.before.archive, source.before);
    check(source.after.archive, source.after);
    check(source.path, source.after);
  }
  const originalHelper = check(manifest.incomingHelper.archive, manifest.incomingHelper);
  assert.deepEqual(read(manifest.incomingHelper.path), composeNoDupeIncomingHelper(originalHelper));
  checked.add(manifest.incomingHelper.path);
  assert.equal(manifest.originalHistoricalLaws.length, 1);
  for (const law of manifest.originalHistoricalLaws) {
    const original = check(law.archive, law);
    assert.deepEqual(read(law.path), composeNoDupeHistoricalLaw(original));
    checked.add(law.path);
  }
  for (const name of checked) {
    const status = fs.lstatSync(path.join(root, name));
    assert(status.isFile() && !status.isSymbolicLink() && !(status.mode & 0o111), name);
  }
  const historical = incomingReadView(manifest, read);
  assert.deepEqual(authenticateNoMutatingPropsSourceFamily(root, historical), incoming);
  return manifest;
}

function incomingReadView(manifest, read) {
  return (name, ...args) => {
    const source = manifest.sources.find(
      ({ path: candidate, changed }) => changed && candidate === name,
    );
    if (source) return read(source.before.archive, ...args);
    if (name === manifest.incomingHelper.path)
      return read(manifest.incomingHelper.archive, ...args);
    const law = manifest.originalHistoricalLaws.find(({ path: candidate }) => candidate === name);
    return read(law ? law.archive : name, ...args);
  };
}

/** Historical callers admit only the complete current family or their exact incoming family. */
export function reviewedNoDupeSourceReadView(root, read = reader(root)) {
  const incoming = JSON.parse(
    read(
      "tests/_fixtures/differential/linter/no-mutating-props-options-uploader/source-custody/successor.json",
    ),
  );
  const selected = incoming.sources.filter(({ path: name }) =>
    [
      "crates/vize_patina/src/rules/script.rs",
      "crates/vize_patina/src/linter/script_rules.rs",
      "crates/vize_patina/src/linter/script_rules/sfc.rs",
    ].includes(name),
  );
  assert.equal(selected.length, 3);
  if (selected.every(({ path: name, after }) => matches(read(name), after))) return read;
  // The incoming SFC-only layer already supplies its complete predecessor to
  // older predicates. Let those unchanged predicates authenticate that family.
  const originalSfc = selected.find(
    ({ path: name }) => name === "crates/vize_patina/src/linter/script_rules/sfc.rs",
  );
  if (matches(read(originalSfc.path), originalSfc.before)) return read;
  read = reviewedNoDupeCIRepairHistoricalReadView(root, read);
  return incomingReadView(authenticateNoDupeKeysSourceFamily(root, read), read);
}

/** Original whole cases execute only after proving their current successor context. */
export function reviewedNoDupeHistoricalCaseReadView(root, read = reader(root)) {
  read = reviewedNoDupeCIRepairHistoricalReadView(root, read);
  return incomingReadView(authenticateNoDupeKeysSourceFamily(root, read), read);
}
