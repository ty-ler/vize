import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import raw from "./warm-type-backed-project-config-runtime-repair.json" with { type: "json" };
import loader from "./warm-type-backed-project-config-loader-manifest.json" with { type: "json" };

type Digest = (side: "before" | "after", file: string) => string | null;
type Row = [file: string, original: string, repaired: string];
export const runtimeRepairManifest = raw as Omit<typeof raw, "inheritedBodies"> & {
  inheritedBodies: Row[];
};
for (const row of runtimeRepairManifest.inheritedBodies) Object.freeze(row);
Object.freeze(runtimeRepairManifest.inheritedBodies);
Object.freeze(runtimeRepairManifest);
export const runtimeRepairManifestSHA256 = createHash("sha256")
  .update(JSON.stringify(runtimeRepairManifest))
  .digest("hex");
assert.equal(
  runtimeRepairManifestSHA256,
  "0eec8f385b734ff5a04ddbc7a8fb9ac9940fd51d115f44d3a0e7605c36f6fd8f",
);
assert.equal(runtimeRepairManifest.version, 1);
assert.deepEqual(
  runtimeRepairManifest.inheritedBodies.map(([file, original]) => [file, original]),
  loader.composedContext.map(([file, before, after]) => {
    assert.equal(before, after);
    return [file, after];
  }),
);
const rows = new Map(runtimeRepairManifest.inheritedBodies.map((row) => [row[0], row]));
assert.equal(rows.size, 2);
assert.equal(
  runtimeRepairManifest.inheritedBodies.filter(([, before, after]) => before !== after).length,
  1,
);

/** A preceding Windows fix retains both actual loader bodies on both sides. */
export function qualifyProjectConfigRuntimeRepairHost<T extends { files: readonly string[] }>(
  production: string[],
  alreadyQualified: ReadonlySet<string>,
  digest: Digest,
  qualifyOriginal: (
    production: string[],
    alreadyQualified: ReadonlySet<string>,
    digest: Digest,
  ) => T | null,
) {
  const original = qualifyOriginal(production, alreadyQualified, digest);
  if (original) return original;
  for (const [file, , repaired] of rows.values())
    if (digest("before", file) !== repaired || digest("after", file) !== repaired) return null;
  const witness = qualifyOriginal(
    production,
    alreadyQualified,
    (side, file) => rows.get(file)?.[1] ?? digest(side, file),
  );
  if (!witness) return null;
  return {
    ...witness,
    projectConfigRuntimeRepairContext: {
      authority: "complete-inherited-windows-module-import-boundary",
      manifestSHA256: runtimeRepairManifestSHA256,
      originalSource: runtimeRepairManifest.originalSource,
      repairedSource: runtimeRepairManifest.repairedSource,
      completeInheritedBodies: runtimeRepairManifest.inheritedBodies,
    },
  };
}
