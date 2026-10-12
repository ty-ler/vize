import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { test } from "node:test";
import { sha256 } from "./lint-default-correctness-reference.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const directory = path.join(root, "tests/_fixtures/differential/lint/attrs-expression-ranges-8090");
const read = (name) => fs.readFileSync(path.join(directory, name));
const corpusBytes = read("cases.json");
const corpus = JSON.parse(corpusBytes);

await test("whole original Matrix input and failure stay independent of scoped observations", () => {
  const primary = JSON.parse(read("primary-sources.json"));
  assert.equal(primary.matrix.run, 38205026873);
  assert.equal(primary.matrix.source, "ef34d1a0409fc711a6c5cefcf0708b0cce78f502");
  assert.equal(primary.matrix.artifactId, 11727196356);
  assert.equal(
    sha256(read("reference/original-project3.zip")),
    "6b746f8c7ce6dbdd5982957ae8527fc14de65091e7986b548b15d5e0ad32cd79",
  );
  const whole = gunzipSync(read("reference/original-ant-design-vue-lint-divergence.json.gz"));
  assert.equal(whole.length, primary.matrix.rawProjectBytes);
  assert.equal(sha256(whole), primary.matrix.rawProjectSha256);
  const packet = JSON.parse(whole);
  assert.equal(packet.project, "ant-design-vue");
  assert.equal(packet.revision, "7483836f0adac76516e527df893c3d84a7cd4005");
  assert.equal(packet.budget.passed, false);
  assert.equal(packet.budget.maxFalseNegativeCount, 0);
  assert.equal(packet.budget.maxFalsePositiveCount, 0);
  const original = corpus.cases[0];
  assert.equal(
    original.sourceSha256,
    "eb0f821769f5aa61f9819562c9420c411cf755240f2f33564b7483611f38423b",
  );
  const native = JSON.parse(read("reference/original-theme-icon-native-whole.json"));
  assert.deepEqual(native, {
    ...original.beforeCli[0],
    file: "site/src/layouts/icons/ThemeIcon.vue",
  });
});

await test("all twenty five complete old-public and official packets match immutable authored inputs", () => {
  assert.equal(
    sha256(corpusBytes),
    "76de7272ef8f7f3f90fb50101c62a9e068af215f38014dc6f6fd41ec39555d0c",
  );
  const referenceBytes = read("reference/whole-before-and-official.json");
  assert.equal(
    sha256(referenceBytes),
    "4b6ed294205f4abc9af6666504188452b5f6b293484bd4e39b89a422bfe91e91",
  );
  const reference = JSON.parse(referenceBytes);
  assert.equal(reference.complete, true);
  assert.equal(corpus.cases.length, 25);
  assert.equal(reference.cases.length, 25);
  for (const [index, entry] of corpus.cases.entries()) {
    const observed = reference.cases[index];
    assert.equal(entry.id, observed.id);
    assert.equal(sha256(read(entry.sourceFile)), entry.sourceSha256);
    assert.equal(read(entry.sourceFile).toString("utf8"), entry.source);
    assert.equal(observed.source, entry.source);
    assert.equal(observed.sourceSha256, entry.sourceSha256);
    assert.deepEqual(observed.beforeExpected, entry.beforeCli);
    assert.equal(observed.beforeExpectedStatus, entry.beforeStatus);
    assert.deepEqual(observed.native.wholeJson, entry.beforeCli);
    assert.deepEqual(
      JSON.parse(Buffer.from(observed.native.stdoutBase64, "base64")),
      entry.beforeCli,
    );
    assert.equal(observed.native.status, entry.beforeStatus);
    assert.equal(observed.native.error, null);
    assert.equal(observed.native.signal, null);
    assert.equal(Buffer.from(observed.native.stderrBase64, "base64").length, 0);
    assert.equal(observed.finalSource, entry.source);
    assert.deepEqual(observed.officialExpected, entry.officialExpected);
    assert.deepEqual(observed.officialWholeResult, entry.officialExpected);
  }
});

await test("whole archives and exact consumer source bodies refuse accidental drift", () => {
  const primaryBytes = read("primary-sources.json");
  assert.equal(
    sha256(primaryBytes),
    "452365e87e30d45ffa90b00d23de92f138b7df72889a0df816e8078a20e155fe",
  );
  const primary = JSON.parse(primaryBytes);
  assert.equal(primary.corpusSha256, sha256(corpusBytes));
  for (const item of primary.files) {
    const bytes = read(item.path);
    assert.equal(bytes.length, item.bytes, item.path);
    assert.equal(sha256(bytes), item.sha256, item.path);
  }
  for (const item of primary.productionSources) {
    const bytes = fs.readFileSync(path.join(root, item.path));
    assert.equal(bytes.length, item.bytes, item.path);
    assert.equal(sha256(bytes), item.sha256, item.path);
  }
  const authored = JSON.parse(read("reference/authored-corpus-with-root-scopes.json"));
  for (const [index, entry] of corpus.cases.entries()) {
    const { sourceFile, ...semantic } = entry;
    assert.deepEqual(semantic, authored.cases[index]);
    assert.equal(sourceFile, `sources/${entry.filename}`);
  }
  assert.equal(
    sha256(read("reference/authored-corpus.json")),
    "f9e84738d7bcba00b9f81234e896f0f00a5af42d4bd55dff4e4c69c45c54a7a6",
  );
});
