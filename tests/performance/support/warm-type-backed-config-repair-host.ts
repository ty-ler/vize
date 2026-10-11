import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import raw from "./warm-type-backed-config-repair-host.json" with { type: "json" };
import {
  configReviewManifest,
  configReviewManifestSHA256,
  qualifyConfigReviewHost,
  type ConfigReviewScope,
} from "./warm-type-backed-config-review-host.ts";
import { projectConfigManifest } from "./warm-type-backed-project-config-manifest.ts";
import { issuedCompletionManifest } from "./warm-type-backed-issued-completion-host.ts";

type Digest = (side: "before" | "after", file: string) => string | null;
type Row = [file: string, originalBefore: string | null, reviewed: string, repaired: string];
type CorpusRow = [file: string, originalBefore: null, repaired: string];
export const configRepairManifest = raw as Omit<typeof raw, "productionBodies" | "corpusBodies"> & {
  productionBodies: Row[];
  corpusBodies: CorpusRow[];
};
for (const row of configRepairManifest.productionBodies) Object.freeze(row);
for (const row of configRepairManifest.corpusBodies) Object.freeze(row);
Object.freeze(configRepairManifest.productionBodies);
Object.freeze(configRepairManifest.corpusBodies);
Object.freeze(configRepairManifest);
export const configRepairManifestSHA256 = createHash("sha256")
  .update(JSON.stringify(configRepairManifest))
  .digest("hex");
assert.equal(configRepairManifest.version, 1);
assert.equal(
  configRepairManifestSHA256,
  "9858bd7d0c5cfc24c2722c58bdc629f7125d2e40bfc64d6f47c67423bfb2bc9f",
);
assert.equal(configRepairManifest.originalReviewManifestSHA256, configReviewManifestSHA256);
assert.equal(configRepairManifest.originalReviewedSource, configReviewManifest.reviewedSource);
assert.match(configRepairManifest.repairedSource, /^[a-f0-9]{40}$/u);
assert.equal(configRepairManifest.corpusBodies.length, 1);
assert.equal(
  configRepairManifest.corpusBodies[0][0],
  "tests/_fixtures/differential/config/materialized-two-buffer-topology-8476.json",
);
assert.equal(configRepairManifest.corpusBodies[0][1], null);
assert.match(configRepairManifest.corpusBodies[0][2], /^[a-f0-9]{64}$/u);
const rows = new Map(configRepairManifest.productionBodies.map((row) => [row[0], row]));
assert.equal(rows.size, configRepairManifest.productionBodies.length);
for (const [file, before, reviewed, repaired] of rows.values()) {
  const original = configReviewManifest.productionBodies.find(([name]) => name === file);
  const producer = issuedCompletionManifest.producerBodies.find(([name]) => name === file);
  const config = projectConfigManifest.files.find(([name]) => name === file);
  assert.ok(original || producer || config);
  assert.deepEqual(
    [before, reviewed],
    original
      ? [original[1], original[3]]
      : producer
        ? [producer[1], producer[3]]
        : [config![1], config![2]],
  );
  assert.match(repaired, /^[a-f0-9]{64}$/u);
  assert.notEqual(reviewed, repaired);
}

/** Exact repair bodies still require the whole original reviewed qualification. */
export function qualifyConfigRepairedReviewHost<T extends { files: readonly string[] }>(
  production: string[],
  alreadyQualified: ReadonlySet<string>,
  digest: Digest,
  qualifyOriginal: (
    production: string[],
    alreadyQualified: ReadonlySet<string>,
    digest: Digest,
  ) => T | null,
  scope: ConfigReviewScope = "parent-pair",
) {
  const original = qualifyConfigReviewHost(
    production,
    alreadyQualified,
    digest,
    qualifyOriginal,
    scope,
  );
  if (original) return original;
  if (scope !== "parent-pair" && scope !== "inherited") return null;
  for (const [file, before, , repaired] of rows.values())
    if (
      digest("before", file) !== (scope === "inherited" ? repaired : before) ||
      digest("after", file) !== repaired
    )
      return null;
  for (const [file, before, repaired] of configRepairManifest.corpusBodies)
    if (
      digest("before", file) !== (scope === "inherited" ? repaired : before) ||
      digest("after", file) !== repaired
    )
      return null;
  const witness = qualifyConfigReviewHost(
    production,
    alreadyQualified,
    (side, file) => {
      const row = rows.get(file);
      return row && (side === "after" || scope === "inherited") ? row[2] : digest(side, file);
    },
    qualifyOriginal,
    scope,
  );
  if (!witness) return null;
  return {
    ...witness,
    configRepairContext: {
      manifestSHA256: configRepairManifestSHA256,
      originalReviewedSource: configRepairManifest.originalReviewedSource,
      repairedSource: configRepairManifest.repairedSource,
      completeProductionBodyPairs: configRepairManifest.productionBodies,
      completeCorpusBodyPairs: configRepairManifest.corpusBodies,
      scope,
    },
  };
}
