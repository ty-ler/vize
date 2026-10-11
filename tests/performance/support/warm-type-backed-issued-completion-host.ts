import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import issuedJSON from "./warm-type-backed-issued-completion-manifest.json" with { type: "json" };
import loaderJSON from "./warm-type-backed-project-config-loader-manifest.json" with { type: "json" };
import { projectConfigManifest as original } from "./warm-type-backed-project-config-manifest.ts";
import nullCompletion from "./warm-type-backed-project-config-null-completion-manifest.json" with { type: "json" };

type BodyDigest = (side: "before" | "after", file: string) => string | null;
type BodyPair = [string, string | null, string | null];
const issued = issuedJSON as Omit<typeof issuedJSON, "producerBodies"> & {
  producerBodies: [string, string | null, string | null, string][];
};
const loader = loaderJSON as Omit<typeof loaderJSON, "legacyContext" | "composedContext"> & {
  legacyContext: BodyPair[];
  composedContext: BodyPair[];
};
export const issuedCompletionManifest = issued;
export const issuedCompletionManifestSHA256 = createHash("sha256")
  .update(JSON.stringify(issued))
  .digest("hex");
assert.equal(
  issuedCompletionManifestSHA256,
  "ef1ffd5636c09cb276a5f8365c24a899691a161ebc70839713e7a8721a0d7c48",
);
assert.equal(issued.version, 1);
for (const [value, expected] of [
  [original, issued.originalConfigManifestSHA256],
  [nullCompletion, issued.nullCompletionManifestSHA256],
  [loader, issued.loaderManifestSHA256],
] as const)
  assert.equal(createHash("sha256").update(JSON.stringify(value)).digest("hex"), expected);
assert.deepEqual(
  [
    issued.original400,
    issued.originalPackets,
    issued.supplementalResolves,
    issued.supplementalRefusals,
    issued.originalComparedFields,
  ],
  [400, 79, 8, 8, 20],
);
assert.equal(issued.producerBodies.length, 7);
assert.equal(new Set(issued.producerBodies.map(([file]) => file)).size, 7);
for (const [, before, predecessor, after] of issued.producerBodies) {
  for (const digest of [before, predecessor, after])
    if (digest !== null) assert.match(digest, /^[a-f0-9]{64}$/u);
  assert.notEqual(predecessor, after);
}
const changedOriginal = issued.producerBodies.filter(([file]) =>
  original.files.some(([name]) => name === file),
);
assert.equal(changedOriginal.length, 1);
for (const [file, before, predecessor] of changedOriginal)
  assert.deepEqual(
    original.files.filter(([name]) => name === file),
    [[file, before, predecessor]],
  );
const [nullFile, nullPredecessor, nullAfter] = nullCompletion.harnessSuccessor;
assert.deepEqual(
  original.harnessExtensions.filter(([file]) => file === nullFile),
  [[nullFile, null, nullPredecessor]],
);
export const issuedCompletionProduction = [
  ...new Set([
    ...original.files.map(([file]) => file),
    ...issued.producerBodies.map(([file]) => file),
  ]),
].toSorted();
assert.equal(issuedCompletionProduction.length, 96);

/** Bind every selected producer body; an inherited context must be unchanged on both sides. */
export function qualifyIssuedCompletionContext(
  digest: BodyDigest,
  scope: "parent-pair" | "inherited",
) {
  if (scope !== "parent-pair" && scope !== "inherited") return null;
  for (const [file, before, , after] of issued.producerBodies)
    if (
      digest("before", file) !== (scope === "inherited" ? after : before) ||
      digest("after", file) !== after
    )
      return null;
  return {
    authority: "complete-issued-completion-producer",
    manifestSHA256: issuedCompletionManifestSHA256,
    producerParent: issued.producerParent,
    producerSource: issued.producerSource,
    completeBodyPairs: issued.producerBodies.length,
    scope,
  };
}

/** A distinct exact96 successor preserves every original90/51/3 boundary and loader context. */
export function qualifyIssuedCompletionHost(
  production: string[],
  alreadyQualified: ReadonlySet<string>,
  digest: BodyDigest,
) {
  const files = new Set(issuedCompletionProduction);
  if (new Set(production).size !== production.length) return null;
  if (production.every((file) => alreadyQualified.has(file))) return null;
  if (production.some((file) => !files.has(file))) return null;
  if (
    JSON.stringify(production.filter((file) => files.has(file)).toSorted()) !==
    JSON.stringify(issuedCompletionProduction)
  )
    return null;
  const producer = qualifyIssuedCompletionContext(digest, "parent-pair");
  if (!producer) return null;
  for (const [file, before, after] of original.files)
    if (
      digest("before", file) !== before ||
      digest("after", file) !== (changedOriginal.find(([name]) => name === file)?.[3] ?? after)
    )
      return null;
  for (const [file, before, after] of original.preservedBodies)
    if (digest("before", file) !== before || digest("after", file) !== after) return null;
  for (const [file, before, after] of original.harnessExtensions)
    if (
      digest("before", file) !== before ||
      digest("after", file) !== (file === nullFile ? nullAfter : after)
    )
      return null;
  for (const [authority, pairs] of [
    ["original-reviewed-loader", loader.legacyContext],
    ["complete-composed-vite-loader", loader.composedContext],
  ] as const)
    if (
      pairs.every(
        ([file, before, after]) =>
          digest("before", file) === before && digest("after", file) === after,
      )
    )
      return {
        authority: "complete-reviewed-project-config-issued-completion-successor",
        manifestSHA256: issuedCompletionManifestSHA256,
        originalConfigManifestSHA256: issued.originalConfigManifestSHA256,
        completeBodyPairs: issuedCompletionProduction.length,
        preservedBodyPairs: original.preservedBodies.length,
        harnessExtensions: original.harnessExtensions.map(([file]) => file),
        reviewedHarnessSuccessors: original.preservedBodies
          .filter(([, before, after]) => before !== after)
          .map(([file]) => file),
        files: issuedCompletionProduction,
        issuedCompletionContext: producer,
        loaderContext: {
          authority,
          manifestSHA256: issued.loaderManifestSHA256,
          parentSource: loader.parentSource,
          composedSource: loader.composedSource,
          completeBodyPairs: pairs,
        },
      };
  return null;
}
