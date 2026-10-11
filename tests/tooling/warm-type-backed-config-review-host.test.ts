import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { test } from "node:test";
import {
  configReviewManifest as review,
  qualifyConfigReviewHost,
} from "../performance/support/warm-type-backed-config-review-host.ts";
import {
  issuedCompletionManifest as issued,
  issuedCompletionProduction,
  qualifyIssuedCompletionHost,
} from "../performance/support/warm-type-backed-issued-completion-host.ts";
import { projectConfigManifest as original } from "../performance/support/warm-type-backed-project-config-manifest.ts";
import loader from "../performance/support/warm-type-backed-project-config-loader-manifest.json" with { type: "json" };
import nullCompletion from "../performance/support/warm-type-backed-project-config-null-completion-manifest.json" with { type: "json" };

type Side = "before" | "after";
type Digest = (side: Side, file: string) => string | null;
type Pair = [string, string | null, string | null];
const hash = (body: string | Uint8Array) => createHash("sha256").update(body).digest("hex");
const root = new URL("../../", import.meta.url);
const baseline = "df7f2e83722371a71c75bc29208be0ed51491579";
const predecessor = "ad9efeef994cb58b39a76c84fc9cac497f65f695";
const reviewedSource = "27243d0b5ed2e0ba24bf90a3904615f3ab628a6b";
// PR tooling uses a shallow checkout. Fetch only the immutable, archived
// source objects; a missing commit must never masquerade as an absent file.
const sourceCommits = [
  baseline,
  predecessor,
  reviewedSource,
  review.deferredActualMainComposition.actualMain,
];
const missingCommits = sourceCommits.filter(
  (ref) => spawnSync("git", ["cat-file", "-e", `${ref}^{commit}`], { cwd: root }).status !== 0,
);
if (missingCommits.length) {
  const fetched = spawnSync(
    "git",
    ["fetch", "--no-tags", "--depth=1", "origin", ...missingCommits],
    {
      cwd: root,
    },
  );
  assert.equal(fetched.status, 0, fetched.stderr.toString());
}
for (const ref of sourceCommits)
  assert.equal(spawnSync("git", ["cat-file", "-e", `${ref}^{commit}`], { cwd: root }).status, 0);
const bodies = new Map<string, string | null>();
function gitDigest(ref: string, file: string) {
  const key = `${ref}:${file}`;
  if (!bodies.has(key)) {
    const result = spawnSync("git", ["show", key], { cwd: root });
    assert.ok(result.status === 0 || result.status === 128);
    bodies.set(key, result.status === 0 ? hash(result.stdout) : null);
  }
  return bodies.get(key)!;
}
const digest: Digest = (side, file) =>
  gitDigest(side === "before" ? baseline : reviewedSource, file);
const production = [
  ...new Set([...issuedCompletionProduction, ...review.reviewedProductionFiles]),
].toSorted((a, b) => (a < b ? -1 : a > b ? 1 : 0));
const reviewedRows = [...review.productionBodies, ...review.harnessBodies];
const qualify = (files = production, current: Digest = digest, owned = new Set<string>()) =>
  qualifyConfigReviewHost(files, owned, current, qualifyIssuedCompletionHost);

await test("the authentic reviewed pair retains the complete original96/51/3 witness and closed sixteen-path extension", () => {
  const result = qualify();
  assert.ok(result);
  assert.equal(result.completeBodyPairs, 96);
  assert.equal(result.preservedBodyPairs, 51);
  assert.equal(result.harnessExtensions.length, 3);
  assert.deepEqual(result.originalQualification.files, issuedCompletionProduction);
  assert.deepEqual(result.files, production);
  assert.deepEqual(result.reviewedProductionFiles, review.reviewedProductionFiles);
  assert.deepEqual(result.configReviewContext.completeProductionBodyPairs, review.productionBodies);
  assert.deepEqual(result.configReviewContext.completeHarnessBodyPairs, review.harnessBodies);
  assert.equal(result.configReviewContext.scope, "parent-pair");
  assert.equal(review.newProductionFiles.length, 6);
  assert.equal(review.reviewedProductionFiles.length, 16);
  assert.equal(result.files.length, 112);
});

await test("literal reviewed source bodies and the complete genuine production diff authenticate every finite row", () => {
  assert.equal(review.actualBaseline, baseline);
  assert.equal(review.predecessorSource, predecessor);
  assert.equal(review.reviewedSource, reviewedSource);
  for (const [file, before, prior, after] of reviewedRows)
    assert.deepEqual(
      [gitDigest(baseline, file), gitDigest(predecessor, file), gitDigest(reviewedSource, file)],
      [before, prior, after],
      file,
    );
  const changed = (before: string, paths: string[]) => {
    const result = spawnSync(
      "git",
      ["diff", "--name-only", before, reviewedSource, "--", ...paths],
      {
        cwd: root,
        encoding: "utf8",
      },
    );
    assert.equal(result.status, 0);
    return result.stdout.trim().split("\n").toSorted();
  };
  assert.deepEqual(changed(baseline, ["crates"]), production);
  assert.deepEqual(
    changed(predecessor, []),
    [...reviewedRows.map(([file]) => file), ...review.excludedDecisionAndGeneratedPaths].toSorted(),
  );
});

await test("every whole reviewed before/after body, including new absent-before owners, is mandatory", () => {
  for (const [file, , predecessor] of reviewedRows)
    for (const side of ["before", "after"] as const)
      for (const replacement of [null, "f".repeat(64), predecessor]) {
        if (digest(side, file) === replacement) continue;
        assert.equal(
          qualify(production, (candidate, name) =>
            candidate === side && name === file ? replacement : digest(candidate, name),
          ),
          null,
          `${side}:${file}:${replacement}`,
        );
      }
});

await test("the original entire production/corpus/recipe/dependency and extension refusals still apply", () => {
  const originalNames = new Set(
    [
      ...original.files,
      ...original.preservedBodies,
      ...original.harnessExtensions,
      ...issued.producerBodies,
      ...loader.composedContext,
    ].map(([file]) => file),
  );
  for (const file of originalNames)
    for (const side of ["before", "after"] as const)
      assert.equal(
        qualify(production, (candidate, name) =>
          candidate === side && name === file ? "f".repeat(64) : digest(candidate, name),
        ),
        null,
        `${side}:${file}`,
      );
});

await test("unknown, duplicate, omitted, fully owned and partial replay footprints refuse", () => {
  for (const file of production) {
    assert.equal(qualify(production.filter((name) => name !== file)), null, file);
    assert.equal(qualify([...production, file]), null, file);
  }
  const unknown = "crates/vize_canon/src/unreviewed-config-surface.rs";
  assert.equal(qualify([...production, unknown]), null);
  assert.equal(qualify([...production, unknown], digest, new Set([unknown])), null);
  assert.equal(qualify(production, digest, new Set(production)), null);
  assert.equal(
    qualify(production.filter((file) => !review.newProductionFiles.includes(file))),
    null,
  );
  assert.equal(
    qualifyConfigReviewHost(production, new Set(), digest, () => null),
    null,
  );
  assert.equal(
    qualifyConfigReviewHost(
      production,
      new Set(),
      digest,
      qualifyIssuedCompletionHost,
      "wrong" as never,
    ),
    null,
  );
});

await test("actual main, mixed baselines and predecessor swapped into reviewed after cannot qualify this parent pair", () => {
  const main: Digest = (side, file) =>
    side === "before"
      ? gitDigest(review.deferredActualMainComposition.actualMain, file)
      : digest(side, file);
  assert.equal(qualify(production, main), null);
  for (const [file] of review.deferredActualMainComposition.baselineSuccessors)
    assert.equal(
      qualify(production, (side, name) =>
        name === file && side === "before" ? main(side, name) : digest(side, name),
      ),
      null,
      file,
    );
  for (const [file, , predecessor] of reviewedRows)
    assert.equal(
      qualify(production, (side, name) =>
        name === file && side === "after" ? predecessor : digest(side, name),
      ),
      null,
      file,
    );
});

// A generic child callback keeps its own complete before/after contract. The
// inherited parent source still goes through the unmodified full96 qualifier.
const parentPairs: Pair[] = [
  ...original.files,
  ...original.preservedBodies,
  ...original.harnessExtensions,
].map(([file, before, after]) => [file, before, after]);
for (const [file, before, , after] of issued.producerBodies) {
  const position = parentPairs.findIndex(([name]) => name === file);
  if (position < 0) parentPairs.push([file, before, after]);
  else parentPairs[position] = [file, before, after];
}
parentPairs.find(([file]) => file === nullCompletion.harnessSuccessor[0])![2] =
  nullCompletion.harnessSuccessor[2];
parentPairs.push(...(loader.composedContext as Pair[]));
const componentFiles = [
  "crates/vize_patina/src/owned-component-context.rs",
  "crates/vize/tests/owned-component-context.rs",
];
const componentPairs = componentFiles.map((file): Pair => [
  file,
  hash(`${file}:original child`),
  hash(`${file}:complete child`),
]);
const inheritedBodies = new Map(
  [...parentPairs.map(([file, , after]): Pair => [file, after, after]), ...componentPairs].map(
    ([file, before, after]) => [file, { before, after }],
  ),
);
for (const [file, , , after] of reviewedRows) inheritedBodies.set(file, { before: after, after });
const inheritedDigest: Digest = (side, file) => inheritedBodies.get(file)?.[side] ?? null;
function inheritedOriginal(files: string[], _owned: ReadonlySet<string>, current: Digest) {
  if (JSON.stringify(files) !== JSON.stringify(componentFiles)) return null;
  for (const [file, before, after] of componentPairs)
    if (current("before", file) !== before || current("after", file) !== after) return null;
  for (const [file, , after] of parentPairs)
    if (current("before", file) !== after || current("after", file) !== after) return null;
  const parent = qualifyIssuedCompletionHost(
    issuedCompletionProduction,
    new Set(),
    (side, file) => {
      const pair = parentPairs.find(([name]) => name === file);
      return side === "before" ? (pair?.[1] ?? null) : current(side, file);
    },
  );
  return parent && { ...parent, files, fullParentQualification: parent };
}

await test("inherited context preserves the child's complete own pairs and unchanged reviewed bodies on both sides", () => {
  const run = (current = inheritedDigest, files = componentFiles) =>
    qualifyConfigReviewHost(files, new Set(), current, inheritedOriginal, "inherited");
  const result = run();
  assert.ok(result);
  assert.deepEqual(result.files, componentFiles);
  assert.deepEqual(result.originalQualification.files, componentFiles);
  assert.equal(result.fullParentQualification.completeBodyPairs, 96);
  assert.equal(result.configReviewContext.scope, "inherited");
  for (const [file] of [...reviewedRows, ...componentPairs, ...parentPairs])
    for (const side of ["before", "after"] as const)
      assert.equal(
        run((candidate, name) =>
          candidate === side && name === file ? "f".repeat(64) : inheritedDigest(candidate, name),
        ),
        null,
        `${side}:${file}`,
      );
  assert.equal(run(inheritedDigest, componentFiles.slice(1)), null);
  assert.equal(run(inheritedDigest, [...componentFiles, componentFiles[0]]), null);
  assert.equal(run(inheritedDigest, [...componentFiles, "crates/unreviewed-child.rs"]), null);
});

await test("an inherited delta cannot append any covered parent path, even when it is already qualified", () => {
  for (const file of review.reviewedProductionFiles)
    for (const owned of [new Set<string>(), new Set([file])]) {
      let delegated = false;
      assert.equal(
        qualifyConfigReviewHost(
          [...componentFiles, file],
          owned,
          inheritedDigest,
          (...args) => {
            delegated = true;
            return inheritedOriginal(...args);
          },
          "inherited",
        ),
        null,
        file,
      );
      assert.equal(delegated, false, file);
    }
});
