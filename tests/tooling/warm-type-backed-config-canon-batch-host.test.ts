import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { canonBatchManifest as batch } from "../performance/support/warm-type-backed-config-canon-batch-host.ts";
import { qualifyConfigRepairedReviewHost } from "../performance/support/warm-type-backed-config-repair-host.ts";
import { qualifyIssuedCompletionHost } from "../performance/support/warm-type-backed-issued-completion-host.ts";
import { canonBatchConfigProduction as production } from "./support/config-reviewed-source.ts";

type Digest = (side: "before" | "after", file: string) => string | null;
const root = new URL("../../", import.meta.url);
const baseline = "a23eca4ad51adaf897922c46cc7c7e57cf062269";
for (const revision of [baseline, batch.predecessorSource, batch.repairedSource]) {
  if (spawnSync("git", ["cat-file", "-e", `${revision}^{commit}`], { cwd: root }).status !== 0) {
    const result = spawnSync("git", ["fetch", "--no-tags", "--depth=1", "origin", revision], {
      cwd: root,
    });
    assert.equal(result.status, 0, result.stderr.toString());
  }
}
const bodies = new Map<string, string | null>();
const gitDigest = (revision: string, file: string) => {
  const key = `${revision}:${file}`;
  if (!bodies.has(key)) {
    const result = spawnSync("git", ["show", key], { cwd: root });
    assert.ok(result.status === 0 || result.status === 128);
    bodies.set(
      key,
      result.status === 0 ? createHash("sha256").update(result.stdout).digest("hex") : null,
    );
  }
  return bodies.get(key)!;
};
const digest: Digest = (side, file) =>
  gitDigest(side === "before" ? baseline : batch.repairedSource, file);
const qualify = (current: Digest = digest, files = production) =>
  qualifyConfigRepairedReviewHost(files, new Set(), current, qualifyIssuedCompletionHost);

test("the actual preserved Canon batch commits authenticate every complete before and after body", () => {
  for (const [file, before, predecessor, after] of batch.productionBodies)
    assert.deepEqual(
      [
        gitDigest(baseline, file),
        gitDigest(batch.predecessorSource, file),
        gitDigest(batch.repairedSource, file),
      ],
      [before, predecessor, after],
    );
  for (const [file, before, after] of batch.corpusBodies)
    assert.deepEqual(
      [gitDigest(baseline, file), gitDigest(batch.repairedSource, file)],
      [before, after],
    );
});

test("complete Canon identity source qualifies113 while retaining all original112/96/51/3 bodies", () => {
  const result = qualify();
  assert.ok(result && "configCanonBatchContext" in result);
  assert.equal(result.files.length, 113);
  assert.equal(result.completeBodyPairs, 96);
  assert.equal(result.preservedBodyPairs, 51);
  assert.equal(result.harnessExtensions.length, 3);
  assert.equal(result.originalQualification.files.length, 96);
  assert.equal(result.configRepairContext.completeProductionBodyPairs.length, 7);
  assert.deepEqual(
    result.configCanonBatchContext.completeProductionBodyPairs,
    batch.productionBodies,
  );
  assert.deepEqual(result.configCanonBatchContext.completeCorpusBodyPairs, batch.corpusBodies);
});

test("both complete changed source bodies and the additive whole fixture are mandatory", () => {
  for (const [file] of [...batch.productionBodies, ...batch.corpusBodies])
    for (const side of ["before", "after"] as const)
      for (const corrupt of [null, "0".repeat(64)]) {
        if (digest(side, file) === corrupt) continue;
        assert.equal(
          qualify((candidate, name) =>
            candidate === side && name === file ? corrupt : digest(candidate, name),
          ),
          null,
        );
      }
});

test("the extra Canon fixture cannot excuse an omitted, duplicate or foreign production member", () => {
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
  assert.equal(qualify(digest, [...production, "crates/foreign.rs"]), null);
  assert.equal(
    qualifyConfigRepairedReviewHost(production, new Set(), digest, () => null),
    null,
  );
});
