import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import raw from "./warm-type-backed-config-review-host.json" with { type: "json" };
import issued from "./warm-type-backed-issued-completion-manifest.json" with { type: "json" };
import { projectConfigManifest as original } from "./warm-type-backed-project-config-manifest.ts";

type BodyDigest = (side: "before" | "after", file: string) => string | null;
type ReviewBody = [file: string, before: string | null, predecessor: string | null, after: string];
type Manifest = Omit<typeof raw, "productionBodies" | "harnessBodies"> & {
  productionBodies: ReviewBody[];
  harnessBodies: ReviewBody[];
};
export type ConfigReviewScope = "parent-pair" | "inherited";
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const member of Object.values(value)) freeze(member);
    Object.freeze(value);
  }
  return value;
}
export const configReviewManifest = freeze(raw as Manifest);
export const configReviewManifestSHA256 = hash(configReviewManifest);
assert.equal(
  configReviewManifestSHA256,
  "1e3adcb1df0d9433add5e0903fe5d1b631787fc7df8bce094b677466e5d4a754",
);
assert.equal(configReviewManifest.version, 1);
assert.equal(configReviewManifest.actualBaseline, "df7f2e83722371a71c75bc29208be0ed51491579");
assert.equal(configReviewManifest.predecessorSource, "ad9efeef994cb58b39a76c84fc9cac497f65f695");
assert.equal(configReviewManifest.reviewedSource, "27243d0b5ed2e0ba24bf90a3904615f3ab628a6b");
assert.equal(hash(original), configReviewManifest.originalConfigManifestSHA256);
assert.equal(hash(issued), configReviewManifest.issuedCompletionManifestSHA256);
const originalProduction = new Set([
  ...original.files.map(([file]) => file),
  ...issued.producerBodies.map(([file]) => file),
]);
assert.equal(originalProduction.size, 96);
assert.equal(configReviewManifest.productionBodies.length, 27);
assert.equal(configReviewManifest.harnessBodies.length, 4);
const rows = [...configReviewManifest.productionBodies, ...configReviewManifest.harnessBodies];
const reviewed = new Map(rows.map((row) => [row[0], row]));
assert.equal(reviewed.size, rows.length);
for (const [file, before, predecessor, after] of rows) {
  assert.ok(file.length > 0 && !file.startsWith("/") && !file.split("/").includes(".."));
  for (const digest of [before, predecessor, after])
    if (digest !== null) assert.match(digest, /^[a-f0-9]{64}$/u);
  assert.notEqual(predecessor, after);
}
const productionRows = configReviewManifest.productionBodies;
assert.deepEqual(
  configReviewManifest.reviewedProductionFiles,
  productionRows.filter(([file]) => !originalProduction.has(file)).map(([file]) => file),
);
assert.equal(configReviewManifest.reviewedProductionFiles.length, 16);
assert.deepEqual(
  configReviewManifest.newProductionFiles,
  productionRows
    .filter(([, before, predecessor]) => before === null && predecessor === null)
    .map(([file]) => file),
);
assert.equal(configReviewManifest.newProductionFiles.length, 6);
const removed = new Set(configReviewManifest.reviewedProductionFiles);

/** Extend only exact reviewed bodies; the complete original qualifier remains mandatory. */
export function qualifyConfigReviewHost<T extends { files: readonly string[] }>(
  production: string[],
  alreadyQualified: ReadonlySet<string>,
  digest: BodyDigest,
  qualifyOriginal: (
    production: string[],
    alreadyQualified: ReadonlySet<string>,
    digest: BodyDigest,
  ) => T | null,
  scope: ConfigReviewScope = "parent-pair",
) {
  if (scope !== "parent-pair" && scope !== "inherited") return null;
  if (new Set(production).size !== production.length) return null;
  if (scope === "parent-pair" && productionRows.some(([file]) => !production.includes(file)))
    return null;
  if (scope === "inherited" && production.some((file) => removed.has(file))) return null;
  for (const [file, before, , after] of rows)
    if (
      digest("before", file) !== (scope === "inherited" ? after : before) ||
      digest("after", file) !== after
    )
      return null;
  const projected: BodyDigest = (side, file) => {
    const body = reviewed.get(file);
    return body
      ? side === "after" || scope === "inherited"
        ? body[2]
        : body[1]
      : digest(side, file);
  };
  const witness = qualifyOriginal(
    production.filter((file) => !removed.has(file)),
    alreadyQualified,
    projected,
  );
  if (!witness) return null;
  return {
    ...witness,
    // Preserve the complete original witness separately from the extended
    // parent receipt footprint. An inherited child receives no invented files.
    originalQualification: witness,
    files:
      scope === "parent-pair"
        ? [
            ...new Set([...witness.files, ...configReviewManifest.reviewedProductionFiles]),
          ].toSorted()
        : witness.files,
    reviewedProductionFiles: configReviewManifest.reviewedProductionFiles,
    configReviewContext: {
      authority: "finite-reviewed-config-lock-overlay-and-navigation-successor",
      manifestSHA256: configReviewManifestSHA256,
      actualBaseline: configReviewManifest.actualBaseline,
      predecessorSource: configReviewManifest.predecessorSource,
      reviewedSource: configReviewManifest.reviewedSource,
      completeProductionBodyPairs: productionRows,
      completeHarnessBodyPairs: configReviewManifest.harnessBodies,
      newProductionFiles: configReviewManifest.newProductionFiles,
      scope,
    },
  };
}
