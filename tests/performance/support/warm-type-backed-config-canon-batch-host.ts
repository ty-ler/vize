import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import raw from "./warm-type-backed-config-canon-batch-host.json" with { type: "json" };
import original from "./warm-type-backed-config-repair-host.json" with { type: "json" };

type Digest = (side: "before" | "after", file: string) => string | null;
type Scope = "parent-pair" | "inherited";
type Row = [file: string, before: string | null, predecessor: string, after: string];
type CorpusRow = [file: string, before: null, after: string];
export const canonBatchManifest = raw as Omit<typeof raw, "productionBodies" | "corpusBodies"> & {
  productionBodies: Row[];
  corpusBodies: CorpusRow[];
};
for (const row of [...canonBatchManifest.productionBodies, ...canonBatchManifest.corpusBodies])
  Object.freeze(row);
Object.freeze(canonBatchManifest.productionBodies);
Object.freeze(canonBatchManifest.corpusBodies);
Object.freeze(canonBatchManifest.newProductionFiles);
Object.freeze(canonBatchManifest);
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const canonBatchManifestSHA256 = hash(canonBatchManifest);
assert.equal(
  canonBatchManifestSHA256,
  "850edaabddb9f1f7ad78ab9783869ea92c98702d90bed708bc3966676b9d0fdd",
);
assert.equal(canonBatchManifest.version, 1);
assert.equal(hash(original), canonBatchManifest.originalRepairManifestSHA256);
assert.equal(original.repairedSource, canonBatchManifest.predecessorSource);
const rows = new Map(canonBatchManifest.productionBodies.map((row) => [row[0], row]));
assert.equal(rows.size, 2);
assert.deepEqual(canonBatchManifest.newProductionFiles, [
  "crates/vize_canon/src/lsp_client/session/tests.rs",
]);
const removed = new Set(canonBatchManifest.newProductionFiles);
assert.equal(canonBatchManifest.corpusBodies.length, 1);
for (const [file, before, predecessor, after] of rows.values()) {
  const old = original.productionBodies.find(([name]) => name === file);
  if (old) assert.deepEqual([before, predecessor], [old[1], old[3]]);
  else assert.ok(removed.has(file) && before === predecessor);
  assert.notEqual(predecessor, after);
}

/** The exact Canon identity repair still requires the complete earlier source witness. */
export function qualifyConfigCanonBatchHost<T extends { files: readonly string[] }>(
  production: string[],
  alreadyQualified: ReadonlySet<string>,
  digest: Digest,
  qualifyOriginal: (
    production: string[],
    alreadyQualified: ReadonlySet<string>,
    digest: Digest,
  ) => T | null,
  scope: Scope,
) {
  const original = qualifyOriginal(production, alreadyQualified, digest);
  if (original) return original;
  if (scope !== "parent-pair" && scope !== "inherited") return null;
  if (new Set(production).size !== production.length) return null;
  if (scope === "parent-pair" && [...removed].some((file) => !production.includes(file)))
    return null;
  if (scope === "inherited" && production.some((file) => removed.has(file))) return null;
  for (const [file, before, , after] of rows.values())
    if (
      digest("before", file) !== (scope === "inherited" ? after : before) ||
      digest("after", file) !== after
    )
      return null;
  for (const [file, before, after] of canonBatchManifest.corpusBodies)
    if (
      digest("before", file) !== (scope === "inherited" ? after : before) ||
      digest("after", file) !== after
    )
      return null;
  const witness = qualifyOriginal(
    production.filter((file) => !removed.has(file)),
    alreadyQualified,
    (side, file) => {
      const row = rows.get(file);
      return row && (side === "after" || scope === "inherited") ? row[2] : digest(side, file);
    },
  );
  if (!witness) return null;
  return {
    ...witness,
    files:
      scope === "parent-pair"
        ? [...new Set([...witness.files, ...removed])].toSorted()
        : witness.files,
    configCanonBatchContext: {
      manifestSHA256: canonBatchManifestSHA256,
      predecessorSource: canonBatchManifest.predecessorSource,
      repairedSource: canonBatchManifest.repairedSource,
      completeProductionBodyPairs: canonBatchManifest.productionBodies,
      completeCorpusBodyPairs: canonBatchManifest.corpusBodies,
      scope,
    },
  };
}
