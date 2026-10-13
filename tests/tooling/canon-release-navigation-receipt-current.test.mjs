import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

import { authenticateReleaseNavigationHelper } from "../../tools/support/compat/github/canon-release-navigation-helper.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = readFileSync(
  path.join(root, "tools/benchmarks/scripts/typechecker-template-emit-projection-receipt.mjs"),
  "utf8",
);
assert.equal(createHash("sha256").update(source).digest("hex"), "96bcdb3c4224fc574a0b724768d48cdc5cf4af7ee7e546be8f6c1813edbeb148");
const imports =
  [
    'import assert from "node:assert/strict";',
    'import { createHash } from "node:crypto";',
    'import { readFileSync, readdirSync, writeFileSync } from "node:fs";',
    'import { join } from "node:path";',
    'import { authenticateReleaseNavigationHelper } from "../../support/compat/github/canon-release-navigation-helper.mjs";',
  ].join("\n") + "\n";
assert(source.startsWith(imports));
assert.equal(source.split("\nconst proofs = [];\n").length, 2);
const context = {
  assert,
  createHash,
  Buffer,
  join: path.join,
  readFileSync: (file, options) => readFileSync(path.join(root, file), options),
  process: { env: {}, cwd: () => root },
  authenticateReleaseNavigationHelper,
};
vm.runInNewContext(
  source.split("\nconst proofs = [];\n")[0].slice(imports.length) +
    "\nglobalThis.controls = { rewind, rewindInitializer, offset, declarations, navigationDeclaration: currentNavigationDeclaration };",
  context,
);
const { rewind, rewindInitializer, offset, declarations, navigationDeclaration } = context.controls;
const model = declarations["define-model"];
const dual = declarations["dual-scripts-emits"];
const old = "const $emit = __ctx.$emit;";
const text = `prefix\n${model}\n${navigationDeclaration}suffix`;

void test("actual1242 helper restores the unchanged original initializer and complete navigation inverse", () => {
  assert.equal(Buffer.byteLength(navigationDeclaration), 1242);
  const expected = `prefix\n${old}\nsuffix`;
  const previous = rewindInitializer(text, model);
  assert.equal(previous.delta, 97);
  assert.equal(Buffer.byteLength(previous.text) - Buffer.byteLength(expected), 1242);
  assert.throws(() => assert.equal(previous.text, expected));
  assert.equal(rewind(text, model).text, expected);
  assert.equal(rewind(text, model).delta, 97);
});

void test("missing, partial, duplicate, mutated and unknown helper families refuse", () => {
  for (const damaged of [
    text.replace(navigationDeclaration, ""),
    text.replace(navigationDeclaration, navigationDeclaration.slice(0, -1)),
    text + navigationDeclaration,
    text.replace("__VizeEmptyVueNavigationSlots<C>", "__VizeEmptyVueNavigationSlots<Cx>"),
    text + "\n__VizeNavigationSlots",
  ])
    assert.throws(() => rewind(damaged, model));
  assert.throws(() => rewind(text, "unknown initializer"));
});

void test("generated endpoints compose both byte inverses and refuse inserted helper coordinates", () => {
  const edit = rewind(text, model);
  assert.equal(offset(edit.navigation.cut - 1, edit), edit.navigation.cut - 1 - 97);
  assert.equal(offset(edit.navigation.end, edit), edit.navigation.cut - 97);
  for (const value of [
    edit.navigation.cut,
    edit.navigation.cut + 1,
    edit.navigation.end - 1,
    -1,
    "not a number",
    0.5,
    Number.MAX_SAFE_INTEGER + 1,
  ])
    assert.throws(() => offset(value, edit));
  assert.throws(() => offset(edit.cut + 1, edit));
});

void test("unchanged dual and declaration-absent script paths reject unexpected helper text", () => {
  const dualText = `prefix\n${dual}\nsuffix`;
  const edit = rewind(dualText, dual);
  assert.equal(edit.text, `prefix\n${old}\nsuffix`);
  assert.equal(edit.delta, 50);
  assert.equal(edit.navigation.delta, 0);
  assert.equal(
    rewind("export const script = 1;\n", model, true).text,
    "export const script = 1;\n",
  );
  assert.throws(() => rewind(dualText + navigationDeclaration, dual));
  assert.throws(() => rewind(navigationDeclaration, model, true));
});
