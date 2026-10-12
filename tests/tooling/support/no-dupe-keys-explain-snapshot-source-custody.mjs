import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

export const noDupeExplainSnapshotDirectory =
  "tests/_fixtures/differential/linter/no-dupe-keys-447/explain-snapshot-successor";
export const noDupeExplainSnapshotGuard =
  "tests/tooling/support/no-dupe-keys-explain-snapshot-source-custody.mjs";
const manifestSHA = "ab07cb3b2ee89600b1080c4a56a7fc33acd92127eed17180aa22b926f2c13bed";
const guardBytes = fs.readFileSync(fileURLToPath(import.meta.url));
const currentPaths = [
  "crates/vize/src/commands/explain/snapshots/en.txt",
  "crates/vize/src/commands/explain/snapshots/ja.txt",
  "crates/vize/src/commands/explain/snapshots/zh.txt",
  "crates/vize/src/commands/explain/page.rs",
  "crates/vize/src/commands/explain/subjects.rs",
  "crates/vize/src/commands/explain/tests.rs",
  "crates/vize/src/commands/explain/catalog.rs",
  "crates/vize/src/commands/explain.rs",
  "crates/vize_patina/src/rule_contracts/table.rs",
  "crates/vize_patina/src/rules/script/prefer_import_from_vue.rs",
  "tests/_fixtures/differential/lint/public-vue-imports-8090/primary-sources.json",
  "tests/_fixtures/differential/lint/public-vue-imports-8090/explain-snapshot-contract.json.gz",
  "tests/tooling/public-vue-imports-explain.test.mjs",
  "tests/tooling/lint-default-correctness-reference.mjs",
];
const historicalLaw = "tests/tooling/public-vue-imports-explain.test.mjs";
const digest = (body) => createHash("sha256").update(body).digest("hex");
const blob = (body) =>
  createHash("sha1").update(`blob ${body.length}\0`).update(body).digest("hex");
const title = "private import example changes only its three whole explain snapshots";

/** Compose a finite current caller; preserve the complete original law separately. */
export function composeNoDupeExplainSnapshotCaller(original) {
  const body = original.toString("utf8");
  const marker = `await test("${title}", () => {`;
  assert.equal(body.split(marker).length, 2);
  let prefix = body.slice(0, body.indexOf(marker));
  for (const line of [
    'import assert from "node:assert/strict";\n',
    'import fs from "node:fs";\n',
    'import { gunzipSync } from "node:zlib";\n',
    'import { sha256 } from "./lint-default-correctness-reference.mjs";\n',
  ]) {
    assert.equal(prefix.split(line).length, 2);
    prefix = prefix.replace(line, "");
  }
  return Buffer.from(
    'import { runNoDupeExplainSnapshotHistoricalLaw } from "./support/no-dupe-keys-explain-snapshot-source-custody.mjs";\n' +
      prefix +
      `void test("${title}", () => {\n  runNoDupeExplainSnapshotHistoricalLaw(root);\n});\n`,
  );
}

function wholeFile(root, name, identity) {
  assert(name && !path.isAbsolute(name) && path.normalize(name) === name);
  assert(!name.split("/").includes(".."));
  const target = path.join(root, name);
  const status = fs.lstatSync(target);
  assert(status.isFile() && !status.isSymbolicLink() && !(status.mode & 0o111), name);
  assert.equal(fs.realpathSync(target), path.join(fs.realpathSync(root), name), name);
  const body = fs.readFileSync(target);
  assert.equal(body.length, identity.bytes, name);
  assert.equal(digest(body), identity.sha256, name);
  assert.equal(blob(body), identity.gitBlob, name);
  return body;
}

function reverseSnapshot(body, row, manifest) {
  const source = body.toString("utf8");
  const marker = "=== script/no-dupe-keys\n";
  assert.equal(source.split(marker).length, 2);
  const start = source.indexOf(marker);
  const next = source.indexOf("=== ", start + marker.length);
  const end = next < 0 ? source.length : next;
  const page = source.slice(start, end);
  const current = `${row.label}: ${manifest.newDomain}\n`;
  const original = `${row.label}: ${manifest.oldDomain}\n`;
  assert.equal(page.split(current).length, 2);
  assert(!page.includes(original));
  const at = source.indexOf(current, start);
  assert.equal(digest(Buffer.from(source.slice(0, at))), row.prefixSha256);
  assert.equal(digest(Buffer.from(source.slice(at + current.length))), row.suffixSha256);
  return Buffer.from(source.slice(0, start) + page.replace(current, original) + source.slice(end));
}

function qualifyHistoricalProof(root, manifest, originals) {
  const objectHash = (kind, body) =>
    createHash("sha1").update(`${kind} ${body.length}\0`).update(body).digest("hex");
  const proof = manifest.historicalProof;
  const commit = wholeFile(root, proof.commit.path, proof.commit);
  assert.equal(objectHash("commit", commit), manifest.historicalSource);
  assert.equal(commit.toString("utf8").split("\n")[0], `tree ${proof.tree}`);
  assert.equal(
    objectHash("tree", wholeFile(root, proof.rootTree.path, proof.rootTree)),
    proof.tree,
  );
  const tree = new Map();
  for (const line of wholeFile(root, proof.recursiveTree.path, proof.recursiveTree)
    .toString("utf8")
    .split("\0")) {
    if (!line) continue;
    const match = /^([0-9]{6}) (blob|tree|commit) ([a-f0-9]{40})\t(.+)$/u.exec(line);
    assert(match && !tree.has(match[4]));
    tree.set(match[4], { mode: match[1], kind: match[2], blob: match[3] });
  }
  for (const [name, body] of originals) {
    const row = tree.get(name);
    assert(row && row.mode === "100644" && row.kind === "blob", name);
    assert.equal(blob(body), row.blob, `literal cd81 tree body: ${name}`);
  }
  const actual = manifest.actualTransition;
  const changed = [
    ...currentPaths.slice(0, 3),
    "docs/davinci/decisions/2026-09-27-level-restructure.md",
    "docs/davinci/decisions/2026-10-12-6881-script-setup-dupe-keys.md",
    "tests/_fixtures/differential/linter/no-dupe-keys-447/source-custody/ci-repair/explain-domain-snapshot-repair.json.gz",
  ];
  assert.deepEqual(actual.changedPaths, changed);
  assert.equal(actual.from, manifest.historicalSource);
  assert.equal(actual.to, manifest.currentSource);
  assert.equal(actual.sourceCodeChanges, false);
  const actualCommit = wholeFile(root, actual.commit.path, actual.commit);
  assert.equal(objectHash("commit", actualCommit), actual.to);
  assert(actualCommit.toString("utf8").split("\n").includes(`parent ${actual.from}`));
  assert.deepEqual(
    wholeFile(root, actual.paths.path, actual.paths).toString("utf8").split("\0").slice(0, -1),
    changed,
  );
  const diffs = wholeFile(root, actual.diff.path, actual.diff)
    .toString("utf8")
    .split(/^diff --git /m)
    .slice(1);
  assert.equal(diffs.length, changed.length);
  for (const row of manifest.snapshotRows) {
    const selected = diffs.filter((text) => text.startsWith(`a/${row.path} b/${row.path}\n`));
    assert.equal(selected.length, 1);
    const removals = selected[0]
      .split("\n")
      .filter((line) => line.startsWith("-") && !line.startsWith("---"));
    const additions = selected[0]
      .split("\n")
      .filter((line) => line.startsWith("+") && !line.startsWith("+++"));
    assert.deepEqual(removals, [`-${row.label}: ${manifest.oldDomain}`]);
    assert.deepEqual(additions, [`+${row.label}: ${manifest.newDomain}`]);
  }
}

/** Physical current sources close before any whole historical frame is materialized. */
export function authenticateNoDupeExplainSnapshotSource(root) {
  const rootStatus = fs.lstatSync(root);
  assert(rootStatus.isDirectory() && !rootStatus.isSymbolicLink());
  const manifestPath = `${noDupeExplainSnapshotDirectory}/successor.json`;
  const bytes = fs.readFileSync(path.join(root, manifestPath));
  wholeFile(root, manifestPath, {
    bytes: bytes.length,
    sha256: manifestSHA,
    gitBlob: blob(bytes),
  });
  const manifest = JSON.parse(bytes);
  assert.equal(manifest.schema, "vize.lint.no-dupe-keys-explain-snapshot-successor");
  assert.equal(manifest.version, 1);
  assert.equal(manifest.currentSource, "10ebcea74fb34dc2f22626c45bc92c857643cd54");
  assert.equal(manifest.historicalSource, "cd81dd8c796d1b13399158ec1fa107b65b064966");
  assert.deepEqual(manifest.credit, { compiled: false, native: false, performance: false });
  assert.deepEqual(
    manifest.current.map(({ path: name }) => name),
    currentPaths,
  );
  assert.equal(new Set(manifest.archives.map(({ path: name }) => name)).size, 21);
  assert.equal(manifest.archives.length, 21);
  wholeFile(root, noDupeExplainSnapshotGuard, {
    bytes: guardBytes.length,
    sha256: digest(guardBytes),
    gitBlob: blob(guardBytes),
  });
  const current = new Map();
  const originals = new Map();
  for (const entry of manifest.current) {
    current.set(entry.path, wholeFile(root, entry.path, entry.after));
    assert.equal(entry.before.source, manifest.historicalSource);
    const archived = manifest.archives.find(({ path: name }) => name === entry.before.archive);
    assert(archived, entry.path);
    const { path: _path, ...identity } = archived;
    const { archive: _archive, source: _source, ...before } = entry.before;
    assert.deepEqual(before, identity);
    originals.set(entry.path, wholeFile(root, archived.path, identity));
  }
  for (const archived of manifest.archives) wholeFile(root, archived.path, archived);
  qualifyHistoricalProof(root, manifest, originals);
  assert.deepEqual(
    manifest.snapshotRows.map(({ path: name, locale, label }) => [name, locale, label]),
    [
      [currentPaths[0], "en", "domain"],
      [currentPaths[1], "ja", "対象"],
      [currentPaths[2], "zh", "适用范围"],
    ],
  );
  const table = current.get("crates/vize_patina/src/rule_contracts/table.rs").toString("utf8");
  assert.equal(
    table.match(/const DUPLICATE_KEYS: Domain = Domain::new\(\s*"([^"]+)"/)[1],
    manifest.newDomain,
  );
  assert.equal(
    table.match(/const OPTIONS: Domain = Domain::new\("([^"]+)"/)[1],
    manifest.oldDomain,
  );
  assert(table.includes('row!("script/no-dupe-keys", Exact, DUPLICATE_KEYS, Error)'));
  const primary = JSON.parse(current.get(manifest.publicPrimary));
  const contractBytes = current.get(manifest.publicContract);
  assert.equal(digest(contractBytes), primary.explainSnapshot.sha256);
  assert.equal(contractBytes.length, primary.explainSnapshot.bytes);
  const contract = JSON.parse(gunzipSync(contractBytes));
  assert.equal(contract.schema, "vize.lint.public-vue-imports-explain-contract");
  assert.equal(contract.snapshots.length, 3);
  assert.equal(digest(current.get(manifest.publicProducer)), contract.producerSha256);
  for (const row of manifest.snapshotRows) {
    const entry = contract.snapshots.find(({ path: name }) => name === row.path);
    assert(entry);
    assert.equal(originals.get(row.path).length, entry.afterBytes);
    assert.equal(digest(originals.get(row.path)), entry.afterSha256);
    assert.deepEqual(
      reverseSnapshot(current.get(row.path), row, manifest),
      originals.get(row.path),
    );
  }
  assert.deepEqual(
    current.get(historicalLaw),
    composeNoDupeExplainSnapshotCaller(originals.get(historicalLaw)),
  );
  for (const entry of manifest.current.slice(3)) {
    if (entry.path !== historicalLaw)
      assert.deepEqual(current.get(entry.path), originals.get(entry.path));
  }
  return manifest;
}

/** Run the literal original one-case Node law at its original path with its original imports. */
export function runNoDupeExplainSnapshotHistoricalLaw(root) {
  const manifest = authenticateNoDupeExplainSnapshotSource(root);
  const owned = fs.mkdtempSync(path.join(os.tmpdir(), "vize-no-dupe-explain-history-"));
  try {
    for (const entry of manifest.current) {
      const body = wholeFile(root, entry.before.archive, entry.before);
      const target = path.join(owned, entry.path);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, body, { mode: 0o644, flag: "wx" });
      wholeFile(owned, entry.path, entry.before);
    }
    // Requalify every actual current source after materialization and before execution.
    authenticateNoDupeExplainSnapshotSource(root);
    const childEnv = { ...process.env };
    delete childEnv.NODE_TEST_CONTEXT;
    const result = spawnSync(process.execPath, ["--test", "--test-reporter=tap", historicalLaw], {
      cwd: owned,
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
      env: childEnv,
    });
    assert.equal(result.error, undefined);
    assert.equal(result.signal, null);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /# tests 1\n/);
    assert.match(result.stdout, /# pass 1\n/);
    assert.match(result.stdout, /# fail 0\n/);
    assert.match(result.stdout, /# skipped 0\n/);
    return {
      source: manifest.historicalSource,
      status: result.status,
      signal: result.signal,
      stdout: result.stdout,
      stderr: result.stderr,
      historicalCases: 1,
      removedOuterTestContext: process.env.NODE_TEST_CONTEXT !== undefined,
      forwardedEnvironment: "all inherited keys unchanged except NODE_TEST_CONTEXT",
      credit: manifest.credit,
    };
  } finally {
    fs.rmSync(owned, { recursive: true, force: true });
  }
}
