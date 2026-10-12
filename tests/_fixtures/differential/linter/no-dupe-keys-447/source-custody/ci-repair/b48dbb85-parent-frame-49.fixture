import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  authenticateNoMutatingModuleLayoutSourceFamily,
  composeNoMutatingModuleLayoutHelper,
  composeNoMutatingModuleLayoutLaw,
  noMutatingModuleLayoutDirectory,
  noMutatingModuleLayoutManifestSHA256,
  reviewedNoMutatingModuleLayoutReadView,
} from "./support/no-mutating-props-module-layout-source-custody.mjs";
import { authenticateNoMutatingPropsSourceFamily } from "./support/no-mutating-props-source-custody.mjs";
import { renderConsumerMigrationShards } from "../../tools/support/compat/davinci/lib/consumer-migration-render.mjs";
import { scanConsumerMigrationSurfaces } from "../../tools/support/compat/davinci/lib/consumer-migration-scan.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (name, ...args) => fs.readFileSync(path.join(root, name), ...args);
const digest = (body) => createHash("sha256").update(body).digest("hex");
const helper = "tests/tooling/support/no-mutating-props-module-layout-source-custody.mjs";
const current = () => authenticateNoMutatingModuleLayoutSourceFamily(root, read);
const manifestPath = noMutatingModuleLayoutDirectory + "/successor.json";

void test("the actual complete layout frame retains both whole predecessors and the original laws", () => {
  assert.equal(
    digest(read(helper)),
    "6b3f047011243d9eccac6f4040159ca1a65be93c0f0c0cbc6bdd31969295dde9",
  );
  assert.equal(digest(read(manifestPath)), noMutatingModuleLayoutManifestSHA256);
  const receipt = current();
  assert.equal(receipt.paths.length, 23);
  assert.equal(new Set(receipt.paths).size, 23);
  assert.deepEqual(
    [receipt.sourceOnly, receipt.compiled, receipt.native, receipt.performance],
    [true, false, false, false],
  );
  const { manifest } = receipt;
  assert.throws(() => fs.lstatSync(path.join(root, manifest.relocation.before)), {
    code: "ENOENT",
  });
  assert.equal(receipt.paths.includes(manifest.relocation.after), true);
  assert.equal(
    digest(read(manifest.namespace.path)),
    "6b5aa9402ad8927e9eb68d4dcfaca99597bfa0065718bb23d7e06dbd3ebc412f",
  );
  assert.equal(
    digest(read("tests/tooling/support/no-mutating-props-test-correction-source-custody.mjs")),
    "53a1af6753ffdab235406c70752cb871c57cf6a9c9971204b42083500a6af7a2",
  );
  assert.deepEqual(
    read(manifest.sourceHelper.path),
    composeNoMutatingModuleLayoutHelper(read(manifest.sourceHelper.archive)),
  );
  for (const [index, law] of manifest.historicalLaws.entries()) {
    assert.equal(read(law.archive, "utf8").match(/^await test\(/gm).length, index === 0 ? 4 : 5);
    assert.deepEqual(read(law.path), composeNoMutatingModuleLayoutLaw(law.path));
  }
  assert.equal(authenticateNoMutatingPropsSourceFamily(root, read).sources.length, 12);
  const rendered = renderConsumerMigrationShards(scanConsumerMigrationSurfaces()).find(
    ({ relPath }) => relPath === manifest.ledger.path,
  );
  assert.deepEqual(Buffer.from(rendered.text), read(manifest.ledger.after.archive));
});

void test("every current or archive mutation, omission and unknown family declaration refuses", () => {
  const observed = new Set();
  const receipt = authenticateNoMutatingModuleLayoutSourceFamily(root, (name) => {
    observed.add(name);
    return read(name);
  });
  for (const name of observed) {
    const corrupt = (requested) =>
      requested === name ? Buffer.concat([read(requested), Buffer.from(" ")]) : read(requested);
    assert.throws(
      () => authenticateNoMutatingModuleLayoutSourceFamily(root, corrupt),
      undefined,
      name,
    );
    const missing = (requested) => {
      assert.notEqual(requested, name, "missing " + name);
      return read(requested);
    };
    assert.throws(
      () => authenticateNoMutatingModuleLayoutSourceFamily(root, missing),
      undefined,
      name,
    );
  }
  for (const mutate of [
    (packet) => packet.pairs.pop(),
    (packet) => packet.pairs.push(packet.pairs[0]),
    (packet) => packet.pairs.push({ ...packet.pairs[0], path: "unknown.rs" }),
    (packet) => packet.pairs.reverse(),
  ]) {
    const packet = structuredClone(receipt.manifest);
    mutate(packet);
    const altered = (name) =>
      name === manifestPath ? Buffer.from(JSON.stringify(packet)) : read(name);
    assert.throws(() => authenticateNoMutatingModuleLayoutSourceFamily(root, altered));
  }
  const oldSfc = receipt.manifest.pairs.find(({ path: name }) =>
    name.endsWith("/script_rules/sfc.rs"),
  );
  const predecessor = (name) => (name === oldSfc.path ? read(oldSfc.before.archive) : read(name));
  assert.throws(() => authenticateNoMutatingModuleLayoutSourceFamily(root, predecessor));
});

void test("matching readers cannot hide changed modes, links, bodies or the old physical path", () => {
  const names = new Set();
  const receipt = authenticateNoMutatingModuleLayoutSourceFamily(root, (name) => {
    names.add(name);
    return read(name);
  });
  const owned = fs.mkdtempSync(path.join(os.tmpdir(), "vize-no-mutating-layout-refusal-"));
  try {
    for (const name of names) {
      const target = path.join(owned, name);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, read(name), { mode: 0o644 });
    }
    assert.equal(authenticateNoMutatingModuleLayoutSourceFamily(owned, read).paths.length, 23);
    const selected = [
      receipt.manifest.relocation.after,
      receipt.manifest.pairs[9].path,
      receipt.manifest.snapshot.path,
      manifestPath,
    ];
    for (const name of selected) {
      const target = path.join(owned, name);
      const body = read(name);
      fs.writeFileSync(target, Buffer.concat([body, Buffer.from(" ")]));
      assert.throws(
        () => authenticateNoMutatingModuleLayoutSourceFamily(owned, read),
        undefined,
        name,
      );
      fs.writeFileSync(target, body);
      fs.chmodSync(target, 0o755);
      assert.throws(
        () => authenticateNoMutatingModuleLayoutSourceFamily(owned, read),
        undefined,
        name,
      );
      fs.chmodSync(target, 0o644);
      fs.unlinkSync(target);
      assert.throws(
        () => authenticateNoMutatingModuleLayoutSourceFamily(owned, read),
        undefined,
        name,
      );
      fs.symlinkSync(path.join(root, name), target);
      assert.throws(
        () => authenticateNoMutatingModuleLayoutSourceFamily(owned, read),
        undefined,
        name,
      );
      fs.unlinkSync(target);
      fs.writeFileSync(target, body, { mode: 0o644 });
    }
    const old = path.join(owned, receipt.manifest.relocation.before);
    fs.writeFileSync(old, read(receipt.manifest.relocation.after));
    assert.throws(
      () => authenticateNoMutatingModuleLayoutSourceFamily(owned, read),
      /physically absent/,
    );
    fs.unlinkSync(old);
    fs.symlinkSync(path.join(owned, "missing"), old);
    assert.throws(
      () => authenticateNoMutatingModuleLayoutSourceFamily(owned, read),
      /physically absent/,
    );
    fs.unlinkSync(old);
    fs.mkdirSync(old);
    assert.throws(
      () => authenticateNoMutatingModuleLayoutSourceFamily(owned, read),
      /physically absent/,
    );
    fs.rmdirSync(old);
    assert.equal(authenticateNoMutatingModuleLayoutSourceFamily(owned, read).paths.length, 23);
  } finally {
    fs.rmSync(owned, { recursive: true, force: true });
  }
});

void test("historical selection is finite and requalifies the complete current frame", () => {
  const view = reviewedNoMutatingModuleLayoutReadView(root, read);
  const { manifest } = current();
  for (const item of manifest.historicalProjection)
    assert.deepEqual(view.read(item.path), read(item.archive));
  assert.equal(view.root === root, false);
  assert.equal(fs.existsSync(path.join(root, manifest.relocation.before)), false);
  assert.equal(fs.existsSync(path.join(view.root, manifest.relocation.before)), true);
  const token = { literal: true };
  let forwarded;
  const tracking = (name, ...args) => {
    if (name === "outside") {
      forwarded = [name, ...args];
      return token;
    }
    return read(name, ...args);
  };
  const selected = reviewedNoMutatingModuleLayoutReadView(root, tracking);
  assert.equal(selected.read("outside", "utf8", 42), token);
  assert.deepEqual(forwarded, ["outside", "utf8", 42]);
  const source = manifest.pairs[0].path;
  const corrupt = (name, ...args) =>
    name === source ? Buffer.concat([read(name), Buffer.from(" ")]) : read(name, ...args);
  assert.throws(() => reviewedNoMutatingModuleLayoutReadView(root, corrupt));
});
