import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { authenticateNoDupeCIRepairPhysical } from "./no-dupe-keys-ci-repair-source-custody.mjs";

const directory =
  "tests/_fixtures/differential/linter/no-dupe-keys-447/source-custody/ci-repair/literal-module-extraction";
const digest = (body) => createHash("sha256").update(body).digest("hex");
const reader =
  (root) =>
  (name, ...args) =>
    fs.readFileSync(path.join(root, name), ...args);
const one = (body, from, to) => {
  assert.equal(body.split(from).length, 2);
  return body.replace(from, to);
};

/** Current whole physical sources close before any exact predecessor inverse. */
export function verifyNoDupeLiteralModuleExtraction(root, read = reader(root)) {
  const current = authenticateNoDupeCIRepairPhysical(root, read);
  const physical = reader(root);
  const readClosed = (name) => {
    assert(current.current.some((row) => row.path === name));
    const body = read(name);
    assert.deepEqual(body, physical(name));
    return body;
  };
  const bytes = readClosed(`${directory}/successor.json`);
  assert.equal(digest(bytes), "66eec04a7a69ce2b7d1534f92a613e1541e5464f2b29450033015d0a7fb50a38");
  const extraction = JSON.parse(bytes);
  assert.equal(extraction.schema, "vize.lint.no-dupe-keys-literal-module-extraction");
  assert.equal(extraction.sourceBefore, "9488229c259cd6c9ab205385f2140b42c336b47b");
  assert.deepEqual(extraction.credit, { compiled: false, native: false, performance: false });
  assert.equal(extraction.rows.length, 3);
  const rawStrings = (body) => Array.from(body.matchAll(/r(#+)"([\s\S]*?)"\1/gu), (row) => row[0]);
  for (const row of extraction.rows) {
    const before = readClosed(row.before.path).toString("utf8");
    const after = readClosed(row.path).toString("utf8");
    const tests = readClosed(row.tests).toString("utf8");
    assert.equal(tests, readClosed(row.testsArchive.path).toString("utf8"));
    const marker = "#[cfg(test)]\nmod tests {\n";
    assert.equal(before.split(marker).length, 2);
    const [prefix] = before.split(marker);
    assert.equal(after, prefix + "#[cfg(test)]\nmod tests;\n");
    assert.deepEqual(rawStrings(before), rawStrings(tests));
    assert.equal(
      (before.match(/#\[test\]/gu) ?? []).length,
      (tests.match(/#\[test\]/gu) ?? []).length,
    );
    assert.equal(
      (tests.match(/snapshot_path => "\.\.\/snapshots"/gu) ?? []).length,
      row.snapshotWrappers,
    );
    let restored = tests;
    for (const edit of [...row.inverseEdits].reverse()) {
      assert.equal(restored.slice(edit.start, edit.end), edit.after);
      restored = restored.slice(0, edit.start) + edit.before + restored.slice(edit.end);
    }
    assert.equal(prefix + marker + restored + "}\n", before);
  }

  const config = JSON.parse(readClosed(`${directory}/helper-split-inverse-inputs.json`));
  const original = readClosed(`${directory}/03-whole-helper-before.fixture`).toString("utf8");
  let main = physical("tests/tooling/support/no-dupe-keys-ci-repair-source-custody.mjs").toString(
    "utf8",
  );
  let support = readClosed(
    "tests/tooling/support/no-dupe-keys-ci-repair-parent-frame.mjs",
  ).toString("utf8");
  main = one(
    main,
    digest(
      read(
        "tests/_fixtures/differential/linter/no-dupe-keys-447/source-custody/ci-repair/successor.json",
      ),
    ),
    "a5824b2c80ef3ebf511ff09e45ff27e430e2ca2f08515077a59231f9c8fd86bb",
  );
  for (const [body, marker] of [
    [main, 'assert.equal(manifest.parent, "'],
    [support, 'assert.equal(source, "'],
  ]) {
    assert.equal(body.split(marker).length, 2);
  }
  main = one(
    main,
    `assert.equal(manifest.parent, "${current.parent}")`,
    'assert.equal(manifest.parent, "b48dbb85e257f1875a4df83113dfb20f4830e3a2")',
  );
  support = one(
    support,
    `assert.equal(source, "${current.parent}")`,
    'assert.equal(source, "b48dbb85e257f1875a4df83113dfb20f4830e3a2")',
  );
  if (current.literalModuleAddedMainTail) {
    assert(current.literalModuleAddedMainTail.startsWith("\n/**"));
    assert(current.literalModuleAddedMainTail.includes("runNoDupeParentCurrentCallerAncestryLaw"));
    main = one(main, current.literalModuleAddedMainTail, "");
  }
  assert(main.startsWith(config.mainHeader));
  assert(support.startsWith(config.supportHeader));
  assert(support.endsWith(config.supportFooter));
  const scalars = original.slice(
    original.indexOf("const digest ="),
    original.indexOf("const activeViews ="),
  );
  assert(config.supportHeader.endsWith(scalars + "\n"));
  const block = support.slice(config.supportHeader.length, -config.supportFooter.length);
  assert(block.startsWith(config.blockFirstMarker));
  const body = one(
    main.slice(config.mainHeader.length),
    config.bodyJoinMarker,
    block + config.bodyJoinMarker,
  );
  assert.equal(config.originalHeader + body, original);
  return { sourceOnly: true, compiled: false, native: false, performance: false };
}
