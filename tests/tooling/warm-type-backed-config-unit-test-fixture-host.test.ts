import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { test } from "node:test";
import {
  configUnitTestFixtureManifest as fixture,
  configUnitTestFixtureManifestSHA256,
  qualifyConfigUnitTestFixtureHost,
} from "../performance/support/warm-type-backed-config-unit-test-fixture-host.ts";
import { configResultFixtureManifest as resultFixture } from "../performance/support/warm-type-backed-config-result-fixture-host.ts";
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
type Digest = (side: "before" | "after", file: string) => string | null;
type Scope = "parent-pair" | "inherited";
const root = new URL("../../", import.meta.url);
const git = (...args: string[]) =>
  spawnSync("git", ["--no-replace-objects", ...args], { cwd: root });
const baseline = "a6633fb68b110d07abd5ee5a6049bc15f20f9c7f";
const frozenResultSource = "f1c12ca48658cf503076a2072f4fa709e11f177b";
for (const revision of [
  baseline,
  frozenResultSource,
  resultFixture.predecessorSource,
  fixture.predecessorSource,
  fixture.fixtureSource,
]) {
  if (git("cat-file", "-e", `${revision}^{commit}`).status !== 0) {
    const fetched = git("fetch", "--no-tags", "--depth=1", "origin", revision);
    assert.equal(fetched.status, 0, fetched.stderr.toString());
  }
  const object = git("cat-file", "commit", revision);
  assert.equal(object.status, 0, object.stderr.toString());
  const identity = createHash("sha1").update(`commit ${object.stdout.length}\0`);
  identity.update(object.stdout);
  assert.equal(identity.digest("hex"), revision);
}
const sha = (body: Buffer | string) => createHash("sha256").update(body).digest("hex");
const gitBodies = new Map<string, Buffer | null>();
const gitBody = (revision: string, file: string) => {
  const key = `${revision}:${file}`;
  if (gitBodies.has(key)) return gitBodies.get(key)!;
  const result = git("show", key);
  assert.ok(result.status === 0 || result.status === 128);
  gitBodies.set(key, result.status === 0 ? result.stdout : null);
  return gitBodies.get(key)!;
};
const gitDigest = (revision: string, file: string) => {
  const body = gitBody(revision, file);
  return body === null ? null : sha(body);
};
const current = (file: string) => {
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
  if (files.length !== 0 || owned.size !== 0) return null;
  for (const [file, [, after]] of parentPairs)
    if (actual("before", file) !== after || actual("after", file) !== after) return null;
  const original = qualifyIssuedCompletionHost(
    issuedCompletionProduction,
    new Set(),
    (side, file) => (side === "before" ? (parentPairs.get(file)?.[0] ?? null) : actual(side, file)),
  );
  return original && { ...original, files };
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
const rows = [...fixture.productionBodies, ...fixture.harnessBodies];
let historicalReadsClosed = false;
/** Actual full source and refusals close first; this grants no native execution credit. */
export function proveCurrentUnitFixtureSource() {
  let negatives = 0;
  for (const scope of ["parent-pair", "inherited"] as const) {
    const actual = digest(scope);
    const positive = () => {
      const result = qualify(scope, actual);
      assert.ok(result && "configUnitTestFixtureContext" in result, scope);
      assert.equal(result.files.length, scope === "parent-pair" ? 113 : 0);
      assert.equal(result.originalQualification.files.length, scope === "parent-pair" ? 96 : 0);
      assert.equal(result.completeBodyPairs, 96);
      assert.equal(result.preservedBodyPairs, 51);
      assert.equal(result.harnessExtensions.length, 3);
      assert.equal(result.configRepairContext.completeProductionBodyPairs.length, 7);
      assert.equal(result.configCanonBatchContext.completeProductionBodyPairs.length, 2);
      assert.equal(result.ownedCompletionContext.completeExtensions.length, 29);
      assert.equal(
        result.configResultFixtureContext.manifestSHA256,
        fixture.originalResultManifestSHA256,
      );
      assert.equal(
        result.configUnitTestFixtureContext.manifestSHA256,
        configUnitTestFixtureManifestSHA256,
      );
      assert.equal(result.configUnitTestFixtureContext.scope, scope);
      return result;
    };
    positive();
    const reject = (probe: Digest, files?: string[]) => {
      assert.equal(qualify(scope, probe, files), null);
      negatives++;
    };
    for (const [file, , predecessor] of rows)
      for (const side of ["before", "after"] as const)
        for (const corrupt of [null, predecessor, "0".repeat(64)]) {
          if (actual(side, file) === corrupt) continue;
          reject((selected, name) =>
            selected === side && name === file ? corrupt : actual(selected, name),
          );
        }
    positive();
    reject(digest(scope === "inherited" ? "parent-pair" : "inherited"));
    positive();
    for (const file of production) {
      if (scope === "parent-pair") {
        reject(
          actual,
          production.filter((name) => name !== file),
        );
        reject(actual, [...production, file]);
      } else reject(actual, [file]);
      for (const side of ["before", "after"] as const)
        reject((selected, name) =>
          selected === side && name === file ? "f".repeat(64) : actual(selected, name),
        );
    }
    positive();
    reject(actual, [...production, "crates/foreign.rs"]);
    positive();
  }
  for (const [file, , , after] of rows) assert.equal(current(file), after);
  historicalReadsClosed = true;
  return {
    composedFiles: 113,
    originalFiles: 96,
    preservedBodies: 51,
    extensions: 3,
    nativeExtensions: 29,
    refused: negatives,
  };
}
/** Only the two declared historical fixture bodies may follow the actual Unit proof. */
export function frozenResultFixtureBody(file: string): Buffer {
  assert.ok(historicalReadsClosed, "actual Unit source and refusal laws must close first");
  const row = rows.find(([name]) => name === file);
  assert.ok(row, "no other current file may be projected to the archival source");
  assert.equal(current(file), row[3], "the actual current body must remain qualified");
  const body = gitBody(frozenResultSource, file);
  assert.ok(body);
  assert.equal(sha(body), row[2]);
  return body;
}
test("the unit-entry guard binds both current bodies and preserves the complete frozen Result authority", () => {
  assert.equal(
    configUnitTestFixtureManifestSHA256,
    "0f2e71d4e056171c520ee9bebe3c43e373795043d4673d14d3f4526c85bbe200",
  );
  for (const [file, absent, predecessor, successor] of rows) {
    assert.equal(gitDigest(baseline, file), absent);
    assert.equal(gitDigest(fixture.predecessorSource, file), predecessor);
    assert.equal(current(file), successor);
  }
  const [producer, , , successor] = fixture.productionBodies[0];
  assert.equal(gitDigest(fixture.fixtureSource, producer), successor);
  for (const file of [
    "tests/performance/support/warm-type-backed-config-result-fixture-host.json",
    "tests/performance/support/warm-type-backed-config-result-fixture-host.ts",
  ])
    assert.equal(current(file), gitDigest(frozenResultSource, file));
  assert.equal(
    sha(
      gitBody(
        frozenResultSource,
        "tests/tooling/warm-type-backed-config-result-fixture-host.test.ts",
      )!,
    ),
    "5e1ff5a44fdd69a4ae765016da471c29319fe7caa29de4c0c6967d812807ec04",
  );
});
test("all three unit entries preserve the full helper prefix and every authored native test token", () => {
  const file = fixture.productionBodies[0][0];
  const before = gitBody(fixture.predecessorSource, file)!.toString();
  const after = fs.readFileSync(new URL(file, root), "utf8");
  const marker = "#[test]";
  const prefix = before.slice(0, before.indexOf(marker));
  assert.equal(after.slice(0, after.indexOf(marker)), prefix);
  assert.doesNotMatch(prefix, /\b(?:unwrap|expect|panic)\b/u);
  const tokens = (source: string) => source.match(/r#+"[^]*?"#+|"(?:\\.|[^"\\])*"|\w+|[^\s]/gu)!;
  const original = tokens(before.slice(before.indexOf(marker)));
  const expected: string[] = [];
  let signatures = 0,
    returns = 0,
    helperCalls = 0;
  for (let index = 0; index < original.length; index++) {
    if (original.slice(index, index + 7).join(" ") === "- > FixtureResult < ( ) >") {
      signatures++;
      index += 6;
      continue;
    }
    if (original.slice(index, index + 6).join(" ") === "Ok ( ( ) ) }") {
      returns++;
      index += 4;
      continue;
    }
    if (original[index] === "?") {
      assert.equal(original[index - 1], ")");
      let depth = 1,
        open = index - 2;
      for (; open >= 0; open--) {
        if (original[open] === ")") depth++;
        else if (original[open] === "(" && --depth === 0) break;
      }
      assert.ok(
        ["fixture", "position", "definition", "references", "file"].includes(original[open - 1]),
      );
      helperCalls++;
      expected.push(".", "unwrap", "(", ")");
      continue;
    }
    expected.push(original[index]);
  }
  assert.equal(signatures, 3);
  assert.equal(returns, 3);
  assert.equal(helperCalls, 23);
  assert.deepEqual(tokens(after.slice(after.indexOf(marker))), expected);
  const corpus = "tests/_fixtures/differential/lsp/project-navigation-cache-8371.json";
  assert.equal(current(corpus), gitDigest(fixture.predecessorSource, corpus));
});

test("the complete current native113 source passes both scopes and all missing/foreign laws", () => {
  const receipt = proveCurrentUnitFixtureSource();
  assert.ok(receipt.refused > 0);
  for (const [file] of rows)
    assert.equal(sha(frozenResultFixtureBody(file)), gitDigest(frozenResultSource, file));
  assert.throws(() => frozenResultFixtureBody("crates/foreign.rs"));
});
test("both complete strict and Result predecessor receipts remain independent of the current unit-entry receipt", () => {
  for (const revision of [resultFixture.predecessorSource, frozenResultSource]) {
    const original = qualify("parent-pair", (side, file) =>
      gitDigest(side === "before" ? baseline : revision, file),
    );
    assert.ok(original && "configFixtureContext" in original);
    assert.ok(!("configUnitTestFixtureContext" in original));
    assert.equal(original.files.length, 113);
    assert.equal(original.completeBodyPairs, 96);
    assert.equal(original.preservedBodyPairs, 51);
    assert.equal(original.ownedCompletionContext.completeExtensions.length, 29);
    assert.equal("configResultFixtureContext" in original, revision === frozenResultSource);
  }
});
test("the unit guard cannot invoke an authority for mixed, missing or foreign body pairs", () => {
  const [producer, , resultProducer, unitProducer] = fixture.productionBodies[0];
  const [caller, , resultCaller, unitCaller] = fixture.harnessBodies[0];
  const strictProducer = resultFixture.productionBodies[0][2];
  const strictCaller = resultFixture.harnessBodies[0][2];
  const forbidOriginal = (scope: Scope, actual: Digest) => {
    let calls = 0;
    assert.equal(
      qualifyConfigUnitTestFixtureHost(
        [],
        new Set(),
        actual,
        () => {
          calls++;
          return { files: [] };
        },
        scope,
      ),
      null,
    );
    assert.equal(calls, 0);
  };
  for (const scope of ["parent-pair", "inherited"] as const) {
    const actual = digest(scope);
    for (const [file, , predecessor] of rows)
      for (const side of ["before", "after"] as const)
        for (const corrupt of [null, predecessor, "e".repeat(64)]) {
          if (actual(side, file) === corrupt) continue;
          forbidOriginal(scope, (selected, name) =>
            selected === side && name === file ? corrupt : actual(selected, name),
          );
        }
    assert.equal(
      qualifyConfigUnitTestFixtureHost([], new Set(), actual, () => null, scope),
      null,
    );
    assert.ok(qualify(scope), "the actual full source still qualifies after the refusals");
    for (const side of ["before", "after"] as const)
      for (const [mixedProducer, mixedCaller] of [
        [strictProducer, unitCaller],
        [resultProducer, unitCaller],
        [unitProducer, resultCaller],
        [unitProducer, strictCaller],
      ]) {
        const mixed: Digest = (selected, file) =>
          selected !== side
            ? actual(selected, file)
            : file === producer
              ? mixedProducer
              : file === caller
                ? mixedCaller
                : actual(selected, file);
        assert.equal(
          qualify(scope, mixed),
          null,
          `${scope}:${side}:${mixedProducer}:${mixedCaller}`,
        );
        forbidOriginal(scope, mixed);
      }
    assert.ok(qualify(scope), "a fresh complete positive follows each mixed-pair group");
  }
});
