import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import successor from "./warm-type-backed-project-config-null-completion-manifest.json" with { type: "json" };
import { projectConfigManifest as original } from "./warm-type-backed-project-config-manifest.ts";

type BodyDigest = (side: "before" | "after", file: string) => string | null;
const manifestSHA256 = createHash("sha256").update(JSON.stringify(successor)).digest("hex");
assert.equal(manifestSHA256, "8d3677de4d6cfa8e5d1a1a18f4eaf93c3c88fb5c7db454d55adae26968054d30");
assert.equal(successor.version, 1);
assert.equal(
  createHash("sha256").update(JSON.stringify(original)).digest("hex"),
  successor.originalConfigManifestSHA256,
);
assert.equal(successor.original400, 400);
assert.equal(successor.originalPackets, 79);
assert.equal(successor.supplementalResolves, 8);
assert.equal(successor.supplementalRefusals, 8);
assert.equal(successor.originalComparedFields, 20);
const [changedFile, predecessorSHA256, afterSHA256] = successor.harnessSuccessor;
const prior = original.harnessExtensions.filter(([file]) => file === changedFile);
assert.deepEqual(prior, [[changedFile, null, predecessorSHA256]]);
assert.notEqual(predecessorSHA256, afterSHA256);
assert.match(afterSHA256, /^[a-f0-9]{64}$/u);

/** An explicit whole90/51/3 successor; no digest projection or general helper exception. */
export function qualifyProjectConfigNullCompletionHost(
  production: string[],
  alreadyQualified: ReadonlySet<string>,
  digest: BodyDigest,
) {
  const expected = original.files.map(([file]) => file);
  const files = new Set(expected);
  if (new Set(production).size !== production.length) return null;
  if (production.every((file) => alreadyQualified.has(file))) return null;
  if (production.some((file) => !alreadyQualified.has(file) && !files.has(file))) return null;
  if (
    JSON.stringify(production.filter((file) => files.has(file)).toSorted()) !==
    JSON.stringify(expected)
  )
    return null;
  for (const [file, before, after] of [...original.files, ...original.preservedBodies])
    if (digest("before", file) !== before || digest("after", file) !== after) return null;
  for (const [file, absent, after] of original.harnessExtensions)
    if (
      digest("before", file) !== absent ||
      digest("after", file) !== (file === changedFile ? afterSHA256 : after)
    )
      return null;
  return {
    authority: "complete-reviewed-project-config-null-completion-successor",
    manifestSHA256,
    originalConfigManifestSHA256: successor.originalConfigManifestSHA256,
    originalSource: original.originalSource,
    reviewedSource: original.reviewedSource,
    predecessorSource: successor.predecessorSource,
    completeBodyPairs: original.files.length,
    preservedBodyPairs: original.preservedBodies.length,
    reviewedHarnessSuccessors: original.preservedBodies
      .filter(([, before, after]) => before !== after)
      .map(([file]) => file),
    harnessExtensions: original.harnessExtensions.map(([file]) => file),
    harnessSuccessor: successor.harnessSuccessor,
    files: expected,
  };
}
