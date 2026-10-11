import {
  frozenResultFixtureBody,
  proveCurrentUnitFixtureSource,
} from "./warm-type-backed-config-unit-test-fixture-host.test.ts";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { test } from "node:test";
import {
  configResultFixtureManifest as fixture,
  qualifyConfigResultFixtureHost,
} from "../performance/support/warm-type-backed-config-result-fixture-host.ts";
import { qualifyConfigRepairedReviewHost } from "../performance/support/warm-type-backed-config-repair-host.ts";
import {
  issuedCompletionManifest,
  issuedCompletionProduction,
  qualifyIssuedCompletionHost,
} from "../performance/support/warm-type-backed-issued-completion-host.ts";
import { projectConfigManifest } from "../performance/support/warm-type-backed-project-config-manifest.ts";
import nullCompletion from "../performance/support/warm-type-backed-project-config-null-completion-manifest.json" with { type: "json" };
import loader from "../performance/support/warm-type-backed-project-config-loader-manifest.json" with { type: "json" };
import { canonBatchConfigProduction as production } from "./support/config-reviewed-source.ts";

// Actual current Unit113 and all refusals close before the two archived Result
// body reads. The unchanged old113 laws below grant only their f1 source receipt.
proveCurrentUnitFixtureSource();
const frozenResultFiles = new Set(
  [...fixture.productionBodies, ...fixture.harnessBodies].map(([file]) => file),
);

type Digest = (side: "before" | "after", file: string) => string | null;
type Scope = "parent-pair" | "inherited";
const root = new URL("../../", import.meta.url);
const baseline = "a6633fb68b110d07abd5ee5a6049bc15f20f9c7f";
for (const revision of [baseline, fixture.predecessorSource, fixture.fixtureSource]) {
  if (spawnSync("git", ["cat-file", "-e", `${revision}^{commit}`], { cwd: root }).status !== 0) {
    const result = spawnSync("git", ["fetch", "--no-tags", "--depth=1", "origin", revision], {
      cwd: root,
    });
    assert.equal(result.status, 0, result.stderr.toString());
  }
}
const sha = (source: string | Buffer) => createHash("sha256").update(source).digest("hex");
const cache = new Map<string, string | null>();
const gitSource = (revision: string, file: string) => {
  const result = spawnSync("git", ["show", `${revision}:${file}`], { cwd: root });
  assert.ok(result.status === 0 || result.status === 128);
  return result.status === 0 ? result.stdout : null;
};
const gitDigest = (revision: string, file: string) => {
  const key = `${revision}:${file}`;
  if (!cache.has(key)) {
    const body = gitSource(revision, file);
    cache.set(key, body === null ? null : sha(body));
  }
  return cache.get(key)!;
};
const current = (file: string) => {
  if (frozenResultFiles.has(file)) return sha(frozenResultFixtureBody(file));
  try {
    return sha(fs.readFileSync(new URL(file, root)));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
};
const digest =
  (scope: Scope): Digest =>
  (side, file) =>
    side === "before" && scope === "parent-pair" ? gitDigest(baseline, file) : current(file);
const parentPairs = new Map(
  [
    ...projectConfigManifest.files,
    ...projectConfigManifest.preservedBodies,
    ...projectConfigManifest.harnessExtensions,
  ].map(([file, before, after]) => [file, [before, after] as const]),
);
for (const [file, before, , after] of issuedCompletionManifest.producerBodies)
  parentPairs.set(file, [before, after]);
const [nullFile, , nullAfter] = nullCompletion.harnessSuccessor;
parentPairs.set(nullFile, [parentPairs.get(nullFile)![0], nullAfter]);
for (const [file, before, after] of loader.composedContext) parentPairs.set(file, [before, after]);
const inheritedOriginal = (files: string[], owned: ReadonlySet<string>, actual: Digest) => {
  // An unchanged parent grants no invented child footprint. Both complete parent
  // sides must authenticate before invoking the original full96 qualifier.
  if (files.length !== 0 || owned.size !== 0) return null;
  for (const [file, [, after]] of parentPairs)
    if (actual("before", file) !== after || actual("after", file) !== after) return null;
  const result = qualifyIssuedCompletionHost(issuedCompletionProduction, new Set(), (side, file) =>
    side === "before" ? (parentPairs.get(file)?.[0] ?? null) : actual(side, file),
  );
  return result && { ...result, files };
};
const qualify = (
  scope: Scope,
  actual: Digest = digest(scope),
  files = scope === "parent-pair" ? production : [],
) =>
  qualifyConfigRepairedReviewHost(
    files,
    new Set(),
    actual,
    scope === "parent-pair" ? qualifyIssuedCompletionHost : inheritedOriginal,
    scope,
  );

test("the fallible fixture is the one actual complete successor with its exact named caller", () => {
  for (const [file, absent, predecessor, successor] of [
    ...fixture.productionBodies,
    ...fixture.harnessBodies,
  ]) {
    assert.equal(gitDigest(baseline, file), absent, file);
    assert.equal(gitDigest(fixture.predecessorSource, file), predecessor, file);
    assert.equal(current(file), successor, file);
  }
  for (const [file, , , after] of fixture.productionBodies)
    assert.equal(gitDigest(fixture.fixtureSource, file), after);
  const filename = fixture.harnessBodies[0][0];
  const original = gitSource(fixture.predecessorSource, filename)!.toString();
  const successor = frozenResultFixtureBody(filename).toString();
  const marker = "  const historical = qualifyOriginal(production, alreadyQualified, digest);";
  assert.equal(
    successor.slice(successor.indexOf(marker)),
    original.slice(original.indexOf(marker)),
  );
});

test("all three original native tests retain every statement and assertion with fallible setup", () => {
  const filename = fixture.productionBodies[0][0];
  const original = gitSource(fixture.predecessorSource, filename)!.toString();
  const successor = frozenResultFixtureBody(filename).toString();
  const originalHelpers = original.slice(0, original.indexOf("#[test]"));
  assert.equal((originalHelpers.match(/\bpanic!\(/gu) ?? []).length, 14);
  const helpers = successor.slice(0, successor.indexOf("#[test]"));
  assert.doesNotMatch(helpers, /\b(?:expect|unwrap|unwrap_or_else|panic)\b/u);
  assert.match(helpers, /type FixtureResult<T> = Result<T, Box<dyn std::error::Error>>;/u);
  assert.match(helpers, /\.collect::<FixtureResult<Vec<_>>>\(\)\?/u);
  const tokens = (source: string) => source.match(/"(?:\\.|[^"\\])*"|\w+|[^\s]/gu);
  const oldTests = original.slice(original.indexOf("#[test]"));
  const newTests = successor
    .slice(successor.indexOf("#[test]"))
    .replace(/\s*->\s*FixtureResult<\(\)>/gu, "")
    .replaceAll("?", "")
    .replace(/\n\s*Ok\(\(\)\)\n\}/gu, "\n}");
  assert.equal((oldTests.match(/#\[test\]/gu) ?? []).length, 3);
  assert.deepEqual(tokens(newTests), tokens(oldTests));
  const corpus = "tests/_fixtures/differential/lsp/project-navigation-cache-8371.json";
  assert.equal(current(corpus), gitDigest(fixture.predecessorSource, corpus));
});

test("both composed and inherited qualification retain the complete original source authority", () => {
  for (const scope of ["parent-pair", "inherited"] as const) {
    const result = qualify(scope);
    assert.ok(result && "configResultFixtureContext" in result, scope);
    assert.equal(result.files.length, scope === "parent-pair" ? 113 : 0);
    assert.equal(result.originalQualification.files.length, scope === "parent-pair" ? 96 : 0);
    assert.equal(result.completeBodyPairs, 96);
    assert.equal(result.preservedBodyPairs, 51);
    assert.equal(result.harnessExtensions.length, 3);
    assert.equal(result.configRepairContext.completeProductionBodyPairs.length, 7);
    assert.equal(result.configCanonBatchContext.completeProductionBodyPairs.length, 2);
    assert.equal(result.ownedCompletionContext.completeExtensions.length, 29);
    assert.equal(result.configResultFixtureContext.scope, scope);
  }
});

test("the original complete strict source receipt remains valid and unchanged", () => {
  const result = qualify("parent-pair", (side, file) =>
    gitDigest(side === "before" ? baseline : fixture.predecessorSource, file),
  );
  assert.ok(result && "configFixtureContext" in result);
  assert.ok(!("configResultFixtureContext" in result));
});

test("missing, mixed, foreign and wrong-scope bodies cannot qualify the fallible fixture", () => {
  for (const scope of ["parent-pair", "inherited"] as const) {
    const actual = digest(scope);
    for (const [file, , predecessor] of [...fixture.productionBodies, ...fixture.harnessBodies])
      for (const side of ["before", "after"] as const)
        for (const corrupt of [null, predecessor, "0".repeat(64)]) {
          if (actual(side, file) === corrupt) continue;
          // The exact complete historical fixture is independently qualified.
          if (
            side === "after" &&
            file === fixture.productionBodies[0][0] &&
            corrupt === predecessor
          )
            continue;
          assert.equal(
            qualify(scope, (candidate, name) =>
              candidate === side && name === file ? corrupt : actual(candidate, name),
            ),
            null,
            `${scope}:${side}:${file}:${corrupt}`,
          );
        }
    assert.equal(qualify(scope, digest(scope === "inherited" ? "parent-pair" : "inherited")), null);
    for (const file of production) {
      if (scope === "parent-pair") {
        assert.equal(
          qualify(
            scope,
            actual,
            production.filter((name) => name !== file),
          ),
          null,
          file,
        );
        assert.equal(qualify(scope, actual, [...production, file]), null, file);
      } else {
        assert.equal(qualify(scope, actual, [file]), null, file);
      }
      for (const side of ["before", "after"] as const)
        assert.equal(
          qualify(scope, (candidate, name) =>
            candidate === side && name === file ? "f".repeat(64) : actual(candidate, name),
          ),
          null,
          `${scope}:${side}:${file}`,
        );
    }
    assert.equal(qualify(scope, actual, [...production, "crates/foreign.rs"]), null);
    assert.ok(qualify(scope), "a fresh positive still qualifies after every refusal group");
  }
  assert.equal(
    qualifyConfigResultFixtureHost(
      production,
      new Set(),
      digest("parent-pair"),
      () => null,
      "parent-pair",
    ),
    null,
  );
});
