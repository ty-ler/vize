import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { configFixtureManifest as fixture } from "../performance/support/warm-type-backed-config-fixture-host.ts";
import { qualifyConfigRepairedReviewHost } from "../performance/support/warm-type-backed-config-repair-host.ts";
import { qualifyIssuedCompletionHost } from "../performance/support/warm-type-backed-issued-completion-host.ts";
import { canonBatchConfigProduction as production } from "./support/config-reviewed-source.ts";

type Digest = (side: "before" | "after", file: string) => string | null;
const root = new URL("../../", import.meta.url);
const baseline = "67e3d0e6775cc3a1f29bfb9309d991252f9e75ff";
for (const revision of [baseline, fixture.predecessorSource, fixture.repairedSource]) {
  if (spawnSync("git", ["cat-file", "-e", `${revision}^{commit}`], { cwd: root }).status !== 0) {
    const result = spawnSync("git", ["fetch", "--no-tags", "--depth=1", "origin", revision], {
      cwd: root,
    });
    assert.equal(result.status, 0, result.stderr.toString());
  }
}
const cache = new Map<string, string | null>();
const gitDigest = (revision: string, file: string) => {
  const key = `${revision}:${file}`;
  if (!cache.has(key)) {
    const result = spawnSync("git", ["show", key], { cwd: root });
    assert.ok(result.status === 0 || result.status === 128);
    cache.set(
      key,
      result.status === 0 ? createHash("sha256").update(result.stdout).digest("hex") : null,
    );
  }
  return cache.get(key)!;
};
const digest: Digest = (side, file) =>
  gitDigest(side === "before" ? baseline : fixture.repairedSource, file);
const qualify = (current: Digest = digest, files = production) =>
  qualifyConfigRepairedReviewHost(files, new Set(), current, qualifyIssuedCompletionHost);

test("the complete strict fixture successor authenticates actual original, predecessor and repaired bodies", () => {
  for (const [file, before, previous, after] of fixture.productionBodies)
    assert.deepEqual(
      [
        gitDigest(baseline, file),
        gitDigest(fixture.predecessorSource, file),
        gitDigest(fixture.repairedSource, file),
      ],
      [before, previous, after],
    );
});

test("strict extraction preserves the whole113 source and all original96/51/3 and Canon witnesses", () => {
  const result = qualify();
  assert.ok(result && "configFixtureContext" in result);
  assert.equal(result.files.length, 113);
  assert.equal(result.originalQualification.files.length, 96);
  assert.equal(result.completeBodyPairs, 96);
  assert.equal(result.preservedBodyPairs, 51);
  assert.equal(result.harnessExtensions.length, 3);
  assert.equal(result.configRepairContext.completeProductionBodyPairs.length, 7);
  assert.equal(result.configCanonBatchContext.completeProductionBodyPairs.length, 2);
  assert.equal(result.configCanonBatchContext.completeCorpusBodyPairs.length, 1);
  assert.deepEqual(
    result.configFixtureContext.completeProductionBodyPairs,
    fixture.productionBodies,
  );
});

test("complete historical strict source retains its unchanged receipt", () => {
  const result = qualify((side, file) =>
    gitDigest(side === "before" ? baseline : fixture.predecessorSource, file),
  );
  assert.ok(result && "configCanonBatchContext" in result);
  assert.ok(!("configFixtureContext" in result));
});

test("missing, mixed and changed strict fixture bodies never bypass the complete original authority", () => {
  for (const [file, , previous] of fixture.productionBodies)
    for (const side of ["before", "after"] as const)
      for (const corrupt of [null, previous, "0".repeat(64)]) {
        if (digest(side, file) === corrupt) continue;
        // A complete historical after body remains valid under its original authority.
        if (side === "after" && corrupt === previous) continue;
        assert.equal(
          qualify((candidate, name) =>
            candidate === side && name === file ? corrupt : digest(candidate, name),
          ),
          null,
        );
      }
  for (const file of production) {
    assert.equal(
      qualify(
        digest,
        production.filter((name) => name !== file),
      ),
      null,
      file,
    );
    assert.equal(qualify(digest, [...production, file]), null, file);
  }
  assert.equal(qualify(digest, [...production, "crates/foreign.rs"]), null);
});
