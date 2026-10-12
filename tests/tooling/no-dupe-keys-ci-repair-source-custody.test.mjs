import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  authenticateNoDupeCIRepair,
  authenticateNoDupeCIRepairPhysical,
  noDupeCIRepairDirectory,
  reviewedNoDupeCIRepairHistoricalReadView,
  reviewedNoDupeCIRepairParentReadView,
  reviewedNoDupeCIRepairParentContext,
} from "./support/no-dupe-keys-ci-repair-source-custody.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (name, ...args) => fs.readFileSync(path.join(root, name), ...args);
const digest = (body) => createHash("sha256").update(body).digest("hex");
const helperPath = "tests/tooling/support/no-dupe-keys-ci-repair-source-custody.mjs";
const current = () => authenticateNoDupeCIRepairPhysical(root, read);

void test("the complete CI successor authenticates actual current sources before both whole predecessors", () => {
  assert.equal(
    digest(read(helperPath)),
    "a5b1075abf4fcca2b2aa2d2fd8bcbe8a103834b78ba9dfd23291723d2e76313e",
  );
  const manifest = authenticateNoDupeCIRepair(root, read);
  assert.equal(
    manifest.current.length,
    new Set(manifest.current.map(({ path: name }) => name)).size,
  );
  assert.deepEqual(manifest.credit, { compiled: false, native: false, performance: false });
  const original = JSON.parse(read(manifest.originalFamily.path));
  assert.equal(original.sources.length, 12);
  assert.equal(original.ownedBodies.length, 73);
  const history = reviewedNoDupeCIRepairHistoricalReadView(root, read);
  for (const entry of manifest.historicalProjection)
    assert.deepEqual(history(entry.path), read(entry.archive));
  const parent = reviewedNoDupeCIRepairParentReadView(root, read);
  for (const entry of manifest.parentProjection)
    assert.deepEqual(parent(entry.path), read(entry.archive));
  const parentLaws = manifest.parentProjection.find(
    ({ path: name }) =>
      name === "tests/tooling/no-mutating-props-test-correction-source-custody.test.mjs",
  );
  const layout = JSON.parse(
    read(
      "tests/_fixtures/differential/linter/no-mutating-props-options-uploader/source-custody/module-layout-correction/successor.json",
    ),
  );
  const originalParentLaws = layout.historicalLaws.find(
    ({ path: name }) => name === parentLaws.path,
  );
  assert.equal(read(originalParentLaws.archive, "utf8").match(/^await test\(/gm).length, 5);
});

void test("every current source, archive and manifest corruption or omission is refused", () => {
  const manifest = current();
  const names = [...manifest.current, ...manifest.archives].map(({ path: name }) => name);
  names.push(`${noDupeCIRepairDirectory}/successor.json`);
  for (const name of names) {
    const corrupt = (requested) =>
      requested === name ? Buffer.concat([read(requested), Buffer.from(" ")]) : read(requested);
    assert.throws(() => authenticateNoDupeCIRepairPhysical(root, corrupt), undefined, name);
    const missing = (requested) => {
      assert.notEqual(requested, name);
      return read(requested);
    };
    assert.throws(() => authenticateNoDupeCIRepairPhysical(root, missing), undefined, name);
  }
  const mixed = (name, ...args) => {
    const projection = manifest.parentProjection.find(({ path: candidate }) => candidate === name);
    return read(projection ? projection.archive : name, ...args);
  };
  assert.throws(() => authenticateNoDupeCIRepairPhysical(root, mixed));
  assert.equal(current().current.length, manifest.current.length);
});

void test("matching callback bytes and cached read views cannot hide actual content or file-status changes", () => {
  const manifest = current();
  const names = [...manifest.current, ...manifest.archives].map(({ path: name }) => name);
  names.push(`${noDupeCIRepairDirectory}/successor.json`);
  const owned = fs.mkdtempSync(path.join(os.tmpdir(), "vize-no-dupe-ci-source-"));
  try {
    for (const name of names) {
      const target = path.join(owned, name);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, read(name), { mode: 0o644 });
    }
    const local = (name, ...args) => fs.readFileSync(path.join(owned, name), ...args);
    assert.equal(
      authenticateNoDupeCIRepairPhysical(owned, read).current.length,
      manifest.current.length,
    );
    const view = reviewedNoDupeCIRepairParentReadView(owned, local);
    const selected = [
      "crates/vize_patina/src/linter/script_rules/sfc.rs",
      "crates/vize_patina/src/linter/script_rules/dupe_keys_dispatch_tests.rs",
      "tests/tooling/support/no-dupe-keys-source-custody.mjs",
      "docs/davinci/plan/consumer-migration-surfaces/linter/vize_patina.tsv",
      `${noDupeCIRepairDirectory}/parent-source-snapshot.json.gz`,
      manifest.archives[0].path,
    ];
    for (const name of selected) {
      const target = path.join(owned, name);
      const body = read(name);
      fs.writeFileSync(target, Buffer.concat([body, Buffer.from(" ")]));
      assert.throws(() => authenticateNoDupeCIRepairPhysical(owned, read), undefined, name);
      assert.throws(() => reviewedNoDupeCIRepairParentReadView(owned, view), undefined, name);
      fs.writeFileSync(target, body);
      fs.chmodSync(target, 0o755);
      assert.throws(() => authenticateNoDupeCIRepairPhysical(owned, read), undefined, name);
      fs.chmodSync(target, 0o644);
      fs.unlinkSync(target);
      assert.throws(() => authenticateNoDupeCIRepairPhysical(owned, read), undefined, name);
      fs.symlinkSync(path.join(root, name), target);
      assert.throws(() => authenticateNoDupeCIRepairPhysical(owned, read), undefined, name);
      fs.unlinkSync(target);
      fs.mkdirSync(target);
      assert.throws(() => authenticateNoDupeCIRepairPhysical(owned, read), undefined, name);
      fs.rmdirSync(target);
      fs.writeFileSync(target, body, { mode: 0o644 });
    }
    assert.equal(
      authenticateNoDupeCIRepairPhysical(owned, local).current.length,
      manifest.current.length,
    );
    const parent = reviewedNoDupeCIRepairParentContext(root, read);
    const source = "tests/performance/support/warm-type-backed-default-migration-host.ts";
    const target = path.join(parent.root, source);
    const body = fs.readFileSync(target);
    try {
      fs.writeFileSync(target, Buffer.concat([body, Buffer.from(" ")]));
      assert.throws(() => reviewedNoDupeCIRepairParentContext(root, read));
      fs.writeFileSync(target, body);
      fs.chmodSync(target, 0o755);
      assert.throws(() => reviewedNoDupeCIRepairParentContext(root, read));
      fs.chmodSync(target, 0o644);
      assert.equal(reviewedNoDupeCIRepairParentContext(root, read).root, parent.root);
      const head = path.join(parent.root, ".git/HEAD");
      const literal = fs.readFileSync(head);
      try {
        fs.writeFileSync(head, "0".repeat(40) + "\n");
        assert.throws(() => reviewedNoDupeCIRepairParentContext(root, read));
      } finally {
        fs.writeFileSync(head, literal);
      }
    } finally {
      fs.chmodSync(target, 0o644);
      fs.writeFileSync(target, body);
    }
  } finally {
    fs.rmSync(owned, { recursive: true, force: true });
  }
});

void test("the finite parent and failed-head views preserve binary, UTF8 and unrelated arguments", () => {
  const manifest = current();
  const calls = [];
  const tracked = (name, ...args) => {
    calls.push([name, ...args]);
    return read(name, ...args);
  };
  for (const [factory, entries] of [
    [reviewedNoDupeCIRepairHistoricalReadView, manifest.historicalProjection],
    [reviewedNoDupeCIRepairParentReadView, manifest.parentProjection],
  ]) {
    const view = factory(root, tracked);
    const entry = entries[0];
    calls.length = 0;
    assert.deepEqual(view(entry.path), read(entry.archive));
    assert.deepEqual(calls, [[entry.archive]]);
    calls.length = 0;
    assert.equal(view(entry.path, "utf8"), read(entry.archive, "utf8"));
    assert.deepEqual(calls, [[entry.archive, "utf8"]]);
    calls.length = 0;
    const unrelated = manifest.originalFamily.path;
    assert.equal(view(unrelated, "utf8"), read(unrelated, "utf8"));
    assert.deepEqual(calls, [[unrelated, "utf8"]]);
  }
  const token = { literal: true };
  let forwarded;
  const custom = (name, ...args) =>
    name === "outside" ? ((forwarded = [name, ...args]), token) : read(name, ...args);
  const view = reviewedNoDupeCIRepairParentReadView(root, custom);
  assert.equal(view("outside", "unchanged", 42), token);
  assert.deepEqual(forwarded, ["outside", "unchanged", 42]);
});

void test("each changed source helper retains its complete predecessor through a finite inverse", () => {
  const manifest = current();
  const historicalArchive = (name) =>
    read(
      manifest.historicalProjection.find(({ path: candidate }) => name === candidate).archive,
      "utf8",
    );
  const parentArchive = (name) =>
    read(
      manifest.parentProjection.find(({ path: candidate }) => name === candidate).archive,
      "utf8",
    );
  const ownHelper = "tests/tooling/support/no-dupe-keys-source-custody.mjs";
  const imported =
    'import { reviewedNoDupeCIRepairHistoricalReadView } from "./no-dupe-keys-ci-repair-source-custody.mjs";\n';
  const selected = "  read = reviewedNoDupeCIRepairHistoricalReadView(root, read);\n";
  let body = read(ownHelper, "utf8");
  assert.equal(body.split(imported).length, 2);
  assert.equal(body.split(selected).length, 4);
  body = body.replace(imported, "").split(selected).join("");
  assert.equal(
    body,
    read(`${noDupeCIRepairDirectory}/36379493-formatted-original-helper.fixture`, "utf8"),
  );
  assert(
    historicalArchive(ownHelper).includes(
      '"e03ce63b3186777006c71c65f611c3e42f7f89ecad79a5262bc5a389980a9356"',
    ),
  );
  const ownLaws = "tests/tooling/no-dupe-keys-source-custody.test.mjs";
  const ownImport =
    'import { reviewedNoDupeCIRepairHistoricalReadView } from "./support/no-dupe-keys-ci-repair-source-custody.mjs";\n';
  const context =
    "const physicalRead = (name) => fs.readFileSync(path.join(root, name));\nconst read = reviewedNoDupeCIRepairHistoricalReadView(root, physicalRead);\n";
  body = read(ownLaws, "utf8");
  assert.equal(body.split(ownImport).length, 2);
  assert.equal(body.split(context).length, 2);
  body = body
    .replace(ownImport, "")
    .replace(context, "const read = (name) => fs.readFileSync(path.join(root, name));\n");
  assert.equal(
    body,
    read(`${noDupeCIRepairDirectory}/36379493-formatted-original-five-laws.fixture`, "utf8"),
  );
  const guard = "tests/tooling/support/no-mutating-props-test-correction-source-custody.mjs";
  assert.equal(read(guard, "utf8"), parentArchive(guard));
  const outer = "tests/tooling/support/no-mutating-props-source-custody.mjs";
  const outerImports =
    'import { reviewedNoDupeSourceReadView } from "./no-dupe-keys-source-custody.mjs";\nimport { reviewedNoDupeCIRepairParentContext } from "./no-dupe-keys-ci-repair-source-custody.mjs";\n';
  const outerEntry =
    "  const childAuthority = reviewedNoDupeCIRepairParentContext(root, read);\n  root = childAuthority.root;\n  read = childAuthority.read;\n";
  const outerSelected = "  read = reviewedNoDupeSourceReadView(root, read);\n";
  body = read(outer, "utf8");
  assert.equal(body.split(outerImports).length, 2);
  assert.equal(body.split(outerEntry).length, 2);
  assert.equal(body.split(outerSelected).length, 5);
  body = body.replace(outerImports, "").replace(outerEntry, "").split(outerSelected).join("");
  assert.equal(body, parentArchive(outer));
  for (const name of [
    "tests/tooling/support/no-mutating-props-current-caller-source-custody.mjs",
    "tests/tooling/support/no-mutating-props-current-caller-frame.mjs",
    "tests/tooling/support/no-mutating-props-current-caller-git.mjs",
  ])
    assert.equal(read(name, "utf8"), parentArchive(name));
  for (const name of [
    "tests/tooling/reserved-suppression-default-routes.test.mjs",
    "tests/tooling/warm-type-backed-default-migration-host.test.ts",
    "tests/tooling/warm-type-backed-git-reader-nodeep.test.ts",
  ]) {
    const actual = read(name, "utf8");
    assert.equal(actual.split("runNoDupeParentCurrentCallerHistory").length, 3);
    assert.equal(actual.split("./support/no-dupe-keys-ci-repair-source-custody.mjs").length, 2);
    assert.equal(
      actual
        .replaceAll("runNoDupeParentCurrentCallerHistory", "runNoMutatingCurrentCallerHistory")
        .replace(
          "./support/no-dupe-keys-ci-repair-source-custody.mjs",
          "./support/no-mutating-props-current-caller-source-custody.mjs",
        ),
      parentArchive(name),
    );
  }
  assert.equal(manifest.previousSourceBodies.length, 3);
  for (const previous of manifest.previousSourceBodies) {
    const bytes = read(previous.archive);
    assert.equal(bytes.length, previous.identity.bytes);
    assert.equal(digest(bytes), previous.identity.sha256);
  }
});
