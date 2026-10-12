// Byte-backed source qualification only: no compiler, native process or performance credit.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  lexicalFinalSourcePaths,
  validateLexicalFinalSource,
  validateLexicalSourceBodies,
} from "../../tools/support/compat/github/native-lexical-composition-custody.mjs";
import { sourcePaths } from "../../tools/support/compat/github/native-lexical-dollar-metadata.mjs";

const root = new URL("../../", import.meta.url);
const rootPath = fileURLToPath(root);
const read = (file) => fs.readFileSync(new URL(file, root));
const sha = (body) => createHash("sha256").update(body).digest("hex");
const manifest = JSON.parse(
  read("tests/performance/support/warm-type-backed-lexical-dollar-manifest.json"),
);
const caller = "tests/performance/support/warm-type-backed-native-terminal-final.ts";
const oldSHA = "e5cf6338b4edbc08641aee70888b79fe0d69b27118571fcb86cd5041479f503a";
const currentSHA = "f5a60202ec1ff1b149cbb320ac3c8f7382ff85a2c9a1c8cb5ebafed863bdccbc";
const previous = read("tests/_fixtures/ci/native-lexical-final-source-before.mjs.txt").toString();
assert.equal(
  sha(Buffer.from(previous)),
  "420060a317e82edd598b67979787307057a6623f9b07b302bde64019bff1ba59",
);
const rootClause = 'const root = new URL("../../../../", import.meta.url);';
const transported = `const root = new URL(${JSON.stringify(root.href)});`;
assert.equal(previous.split(rootClause).length, 2);
const original = previous.replace(rootClause, transported);
assert.equal(original.replace(transported, rootClause), previous);
const old = await import(`data:text/javascript;base64,${Buffer.from(original).toString("base64")}`);
const currentHead = execFileSync("git", ["--no-replace-objects", "rev-parse", "HEAD"], {
  cwd: rootPath,
})
  .toString()
  .trim();
const copied = sourcePaths(manifest).map((file) => {
  const body = read(file);
  assert.deepEqual(
    body,
    execFileSync("git", ["--no-replace-objects", "show", `${currentHead}:${file}`], {
      cwd: rootPath,
    }),
  );
  const gitEntry = execFileSync(
    "git",
    ["--no-replace-objects", "ls-tree", "-z", currentHead, "--", file],
    { cwd: rootPath },
  );
  const blob = createHash("sha1").update(`blob ${body.length}\0`).update(body).digest("hex");
  assert.deepEqual(gitEntry, Buffer.from(`100644 blob ${blob}\t${file}\0`));
  return {
    file,
    sha256: sha(body),
    byteLength: body.length,
    gitEntryHex: gitEntry.toString("hex"),
  };
});

await test("actual complete current Git bodies refuse the original caller guard and qualify the finite successor", () => {
  let refusal;
  try {
    assert.equal(currentSHA, oldSHA, caller);
  } catch (error) {
    refusal = error;
  }
  assert.throws(() => old.validateLexicalSourceBodies(manifest, copied), {
    name: refusal.name,
    code: refusal.code,
    message: refusal.message,
    actual: refusal.actual,
    expected: refusal.expected,
    operator: refusal.operator,
    generatedMessage: refusal.generatedMessage,
  });
  const result = validateLexicalSourceBodies(manifest, copied);
  assert.equal(result.completeSdkProductionBodies, 121);
  assert.equal(result.incomingLexicalSourceBodies, 9);
  assert.equal(result.incomingLexicalCorpusBodies, 21);
  assert.equal(result.originalRuntimeBodies, 23);
  assert.equal(result.finalGuardBodies, 2);
  assert.equal(result.runtimeCredit, false);
  assert.equal(result.performanceCredit, false);
  assert.equal(result.finalSource.previousAfterSHA256, oldSHA);
  assert.equal(result.finalSource.afterSHA256, currentSHA);
  assert.equal(result.finalSource.completeFixtureBodies, 7);
});

await test("retained historical final source and original lexical fastpath remain separately qualified", () => {
  // This explicit historical tuple is not the actual current caller observation.
  const historical = copied.map((entry) =>
    entry.file === caller ? { ...entry, sha256: oldSHA } : entry,
  );
  assert.deepEqual(
    validateLexicalSourceBodies(manifest, historical),
    old.validateLexicalSourceBodies(manifest, historical),
  );
  const originalBodies = new Map(
    [...manifest.files, ...manifest.corpusBodies, ...manifest.preservedBodies].map((row) => [
      row[0],
      row.at(-1),
    ]),
  );
  const lexical = copied.map((entry) =>
    originalBodies.has(entry.file) ? { ...entry, sha256: originalBodies.get(entry.file) } : entry,
  );
  assert.equal(validateLexicalSourceBodies(manifest, lexical), null);
  assert.equal(old.validateLexicalSourceBodies(manifest, lexical), null);
});

await test("complete current copied census refuses missing duplicate unknown and foreign bodies", () => {
  for (const { file } of copied) {
    assert.throws(
      () =>
        validateLexicalSourceBodies(
          manifest,
          copied.filter((entry) => entry.file !== file),
        ),
      undefined,
      file,
    );
    assert.throws(
      () =>
        validateLexicalSourceBodies(manifest, [
          ...copied,
          copied.find((entry) => entry.file === file),
        ]),
      undefined,
      file,
    );
    assert.throws(
      () =>
        validateLexicalSourceBodies(
          manifest,
          copied.map((entry) =>
            entry.file === file ? { ...entry, sha256: "f".repeat(64) } : entry,
          ),
        ),
      undefined,
      file,
    );
  }
  assert.throws(() =>
    validateLexicalSourceBodies(manifest, [
      ...copied,
      { file: "crates/vize_canon/src/unknown.rs", sha256: "f".repeat(64) },
    ]),
  );
  assert.equal(new Set(sourcePaths(manifest)).size, sourcePaths(manifest).length);
  for (const file of lexicalFinalSourcePaths)
    assert.equal(copied.filter((entry) => entry.file === file).length, 1);
});

await test("whole caller inverse capsule helper metadata and every fixture member refuse physical-byte changes", () => {
  for (const file of [caller, ...lexicalFinalSourcePaths]) {
    const originalBody = read(file);
    const changed = Buffer.from(originalBody);
    changed[0] ^= 1;
    assert.throws(
      () => validateLexicalFinalSource(copied, (name) => (name === file ? changed : read(name))),
      undefined,
      file,
    );
    assert.throws(
      () =>
        validateLexicalFinalSource(copied, (name) =>
          name === file ? originalBody.subarray(1) : read(name),
        ),
      undefined,
      file,
    );
  }
  assert.deepEqual(
    validateLexicalFinalSource(copied),
    validateLexicalSourceBodies(manifest, copied).finalSource,
  );
});
