import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { test } from "node:test";
import {
  configRepairManifest as repair,
  qualifyConfigRepairedReviewHost,
} from "../performance/support/warm-type-backed-config-repair-host.ts";
import { configReviewManifest as review } from "../performance/support/warm-type-backed-config-review-host.ts";
import {
  issuedCompletionManifest as issued,
  qualifyIssuedCompletionHost,
} from "../performance/support/warm-type-backed-issued-completion-host.ts";
import { projectConfigManifest as original } from "../performance/support/warm-type-backed-project-config-manifest.ts";
import loader from "../performance/support/warm-type-backed-project-config-loader-manifest.json" with { type: "json" };
import { reviewedConfigProduction as production } from "./support/config-reviewed-source.ts";

type Side = "before" | "after";
type Digest = (side: Side, file: string) => string | null;
const root = new URL("../../", import.meta.url);
const before = new Map(
  [
    ...original.files,
    ...original.preservedBodies,
    ...original.harnessExtensions,
    ...loader.composedContext,
  ].map(([file, value]) => [file, value]),
);
for (const [file, value] of issued.producerBodies) before.set(file, value);
for (const [file, value] of [...review.productionBodies, ...review.harnessBodies])
  before.set(file, value);
const digest: Digest = (side, file) => {
  if (side === "before") return before.get(file) ?? null;
  try {
    return createHash("sha256")
      .update(fs.readFileSync(new URL(file, root)))
      .digest("hex");
  } catch {
    return null;
  }
};
const qualify = (current: Digest = digest, files = production, owned = new Set<string>()) =>
  qualifyConfigRepairedReviewHost(files, owned, current, qualifyIssuedCompletionHost);

test("the preserved literal repair commit authenticates every named complete body", () => {
  if (
    spawnSync("git", ["cat-file", "-e", `${repair.repairedSource}^{commit}`], { cwd: root })
      .status !== 0
  ) {
    const fetched = spawnSync(
      "git",
      ["fetch", "--no-tags", "--depth=1", "origin", repair.repairedSource],
      { cwd: root },
    );
    assert.equal(fetched.status, 0, fetched.stderr.toString());
  }
  assert.equal(
    spawnSync("git", ["cat-file", "-e", `${repair.repairedSource}^{commit}`], { cwd: root }).status,
    0,
  );
  for (const [file, expected] of [
    ...repair.productionBodies.map(([file, , , after]) => [file, after]),
    ...repair.corpusBodies.map(([file, , after]) => [file, after]),
  ]) {
    const source = spawnSync("git", ["show", `${repair.repairedSource}:${file}`], { cwd: root });
    assert.equal(source.status, 0, source.stderr.toString());
    assert.equal(createHash("sha256").update(source.stdout).digest("hex"), expected, file);
  }
});

test("complete current repaired bodies retain the immutable original112/96/51/3 witness", () => {
  const result = qualify();
  assert.ok(result && "configRepairContext" in result);
  assert.equal(result.files.length, 112);
  assert.equal(result.completeBodyPairs, 96);
  assert.equal(result.preservedBodyPairs, 51);
  assert.equal(result.harnessExtensions.length, 3);
  assert.equal(result.issuedCompletionContext.completeBodyPairs, 7);
  assert.deepEqual(result.configReviewContext.completeProductionBodyPairs, review.productionBodies);
  assert.deepEqual(result.configReviewContext.completeHarnessBodyPairs, review.harnessBodies);
  assert.deepEqual(result.configRepairContext.completeProductionBodyPairs, repair.productionBodies);
  assert.deepEqual(result.configRepairContext.completeCorpusBodyPairs, repair.corpusBodies);
  assert.ok(Object.isFrozen(repair) && repair.productionBodies.every(Object.isFrozen));
});

test("the complete additive regression fixture has no absent or drifted substitute", () => {
  for (const [file, , after] of repair.corpusBodies)
    for (const side of ["before", "after"] as const)
      for (const replacement of [null, "f".repeat(64), after]) {
        if (digest(side, file) === replacement) continue;
        assert.equal(
          qualify((candidate, name) =>
            candidate === side && name === file ? replacement : digest(candidate, name),
          ),
          null,
          `${side}:${file}:${replacement}`,
        );
      }
});

test("every repaired whole body and original before member remains mandatory", () => {
  for (const [file, , old] of repair.productionBodies)
    for (const side of ["before", "after"] as const)
      for (const replacement of [null, "f".repeat(64), old]) {
        if (digest(side, file) === replacement) continue;
        assert.equal(
          qualify((candidate, name) =>
            candidate === side && name === file ? replacement : digest(candidate, name),
          ),
          null,
          `${side}:${file}:${replacement}`,
        );
      }
});

test("repair admission never exempts an unchanged reviewed body or original source witness", () => {
  const files = new Set([
    ...review.productionBodies.map(([file]) => file),
    ...review.harnessBodies.map(([file]) => file),
    ...original.files.map(([file]) => file),
    ...original.preservedBodies.map(([file]) => file),
    ...original.harnessExtensions.map(([file]) => file),
  ]);
  for (const file of files)
    for (const side of ["before", "after"] as const)
      assert.equal(
        qualify((candidate, name) =>
          candidate === side && name === file ? "f".repeat(64) : digest(candidate, name),
        ),
        null,
        `${side}:${file}`,
      );
  assert.equal(
    qualifyConfigRepairedReviewHost(production, new Set(), digest, () => null),
    null,
  );
});

test("changed, omitted, duplicated and foreign claimed footprints still refuse", () => {
  for (const file of production) {
    assert.equal(
      qualify(
        digest,
        production.filter((name) => name !== file),
      ),
      null,
    );
    assert.equal(qualify(digest, [...production, file]), null);
  }
  const foreign = "crates/vize_maestro/src/unreviewed-config-repair.rs";
  assert.equal(qualify(digest, [...production, foreign], new Set([foreign])), null);
  assert.equal(qualify(digest, production, new Set(production)), null);
});
