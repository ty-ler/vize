import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { planSourceChecks } from "../../tools/support/compat/github/plan-source-checks.ts";
import { planAffectedRust } from "../../tools/support/compat/github/plan-affected-rust.mjs";
import {
  localImportInputs,
  planToolingTests,
  toolingTestFiles,
} from "../../tools/support/compat/github/plan-tooling-tests.mjs";
import { fixture } from "./_helpers/rust-workspace-fixture.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const metadata = "docs/scripts/rules/catalogue-subgroups.ts";
const toolingOnly = { rust: false, js: false, tooling: true, playground: false };
const full = { rust: true, js: true, tooling: true, playground: true };

void test("only the original subgroup metadata selects Docs tooling without Rust products", () => {
  assert.deepEqual(planSourceChecks([metadata]), toolingOnly);
  assert.deepEqual(
    planSourceChecks([metadata, "docs/content/ja/rules/vue-components.md"]),
    toolingOnly,
  );
  const rust = planAffectedRust(fixture(), [metadata]);
  assert.equal(rust.scope, "none");
  assert.deepEqual(rust.packages, []);
  const plan = planToolingTests([metadata]);
  const consumers = toolingTestFiles().filter((file) =>
    localImportInputs(file).files.includes(metadata),
  );
  assert.ok(consumers.includes("tests/tooling/docs-all-lint-rules.test.ts"));
  assert.ok(consumers.includes("tests/tooling/docs-materialized-content.test.ts"));
  for (const file of consumers) assert.ok(plan.tests.includes(file), file);
});

void test("the exception retains literal metadata and every actual Docs render consumer", () => {
  assert.deepEqual(localImportInputs(metadata), { files: [metadata], complete: true });
  assert.match(readFileSync(join(root, metadata), "utf8"), /export const catalogueSubgroups:/);
  for (const file of [
    "docs/scripts/generate-patina-rules-page.ts",
    "docs/scripts/materialize-content.ts",
    "docs/scripts/verify-navigation-render.ts",
    "docs/scripts/generate-og-images.ts",
    "docs/scripts/verify-og-images.ts",
  ]) {
    const closure = localImportInputs(file);
    // Embedded documentation examples can resemble unresolved local imports.
    // Retain real consumer edges without treating this scanner as a parser.
    assert.ok(closure.files.includes(metadata), file);
  }
  const check = readFileSync(join(root, ".github/workflows/check.yml"), "utf8");
  assert.match(check, /tsc --noEmit --pretty false --project docs\/tsconfig\.json/);
  assert.match(readFileSync(join(root, "docs/tsconfig.json"), "utf8"), /scripts\/\*\*\/\*\.ts/);
  assert.match(
    readFileSync(join(root, ".github/workflows/pr-source-checks.yml"), "utf8"),
    /run-cli: "\$\{\{ needs\.pr-source-plan\.outputs\.tooling == 'true' \}\}"/,
  );
});

void test("no tracked Rust or product runtime consumes subgroup metadata", () => {
  const files = execFileSync("git", ["ls-files", "-z"], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  })
    .split("\0")
    .filter(Boolean);
  const consumers = files.filter(
    (file) =>
      file === "Cargo.toml" ||
      /^(?:crates|davinci|tests\/davinci_test_support)\/.*(?:\.rs|Cargo\.toml)$/.test(file) ||
      /^(?:npm|playground)\/.*\.(?:mjs|cjs|js|ts|tsx|vue|rs|json)$/.test(file),
  );
  assert.ok(consumers.length > 0);
  for (const file of consumers) {
    assert.doesNotMatch(
      readFileSync(join(root, file), "utf8"),
      /catalogue-subgroups|catalogueSubgroups/,
      file,
    );
  }
});

void test("nearby contracts and mixed product changes retain their required gates", () => {
  for (const path of [
    "docs/scripts/rules/catalogue-subgroups-extra.ts",
    "docs/scripts/rules/catalogue-routes.ts",
    "docs/scripts/materialize-content.ts",
    "docs/scripts/rules/catalogue-subgroups.json",
    "docs/scripts/rules/Catalogue-subgroups.ts",
    "docs/scripts/rules/../rules/catalogue-subgroups.ts",
  ]) {
    assert.deepEqual(planSourceChecks([metadata, path]), full, path);
    assert.equal(planAffectedRust(fixture(), [metadata, path]).scope, "workspace", path);
  }
  assert.deepEqual(planSourceChecks([metadata, "davinci/vize_l1/src/lib.rs"]), full);
  assert.deepEqual(planSourceChecks([metadata, "npm/native/src/index.ts"]), {
    rust: false,
    js: true,
    tooling: true,
    playground: true,
  });
  for (const paths of [[metadata], [metadata, "README.md"], []]) {
    assert.deepEqual(planSourceChecks(paths, "merge_group"), full);
  }
  assert.equal(
    planToolingTests([metadata], { tier: "merge" }).tests.length,
    toolingTestFiles().length,
  );
});
