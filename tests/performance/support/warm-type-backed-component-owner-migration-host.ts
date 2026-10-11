import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import "./warm-type-backed-component-context-host.ts";
import { componentContextManifest as original } from "./warm-type-backed-component-context-manifest.ts";
import { qualifyComponentContextLoaderContext } from "./warm-type-backed-component-context-loader-host.ts";
import successor from "./warm-type-backed-component-owner-migration-manifest.json" with { type: "json" };
import nullCompletion from "./warm-type-backed-project-config-null-completion-manifest.json" with { type: "json" };

type BodyDigest = (side: "before" | "after", file: string) => string | null;
type Pair = [string, string | null, string];
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const manifestSHA256 = hash(successor);
assert.equal(manifestSHA256, "6d1bdcc6fa6561384abde169481f4e8b10c16d53d606b9364431bc15b828061d");
assert.equal(successor.version, 1);
assert.equal(hash(original), successor.originalComponentManifestSHA256);
assert.equal(original.parentManifestSHA256, successor.originalConfigManifestSHA256);
assert.equal(hash(nullCompletion), successor.nullCompletionManifestSHA256);
assert.equal(successor.original400, 400);
assert.equal(successor.originalPackets, 79);
assert.equal(successor.supplementalResolves, 8);
assert.equal(successor.supplementalRefusals, 8);
assert.equal(successor.originalComparedFields, 20);
const changed = new Map(
  successor.harnessSuccessors.map(([file, before, after]) => [file, { before, after }]),
);
const resolve = nullCompletion.harnessSuccessor[0];
assert.equal(changed.size, 3);
assert.deepEqual(
  [...changed.keys()],
  [
    "tests/performance/support/warm-type-backed-owner-migration.ts",
    "tests/performance/support/warm-type-backed-owner-resolve.ts",
    "tests/performance/support/warm-type-backed-requests.ts",
  ],
);
assert.deepEqual(
  successor.harnessSuccessors.find(([file]) => file === resolve),
  nullCompletion.harnessSuccessor,
);
for (const [file, before, after] of successor.harnessSuccessors) {
  const prior = [...original.inheritedCustodyBodies, ...original.inheritedHarnessExtensions].filter(
    ([path]) => path === file,
  );
  assert.equal(prior.length, 1);
  assert.equal(prior[0][2], before);
  assert.notEqual(before, after);
  assert.match(after, /^[a-f0-9]{64}$/u);
}

/** Independently bind the entire original successor, with three explicit whole-body changes. */
export function qualifyComponentOwnerMigrationHost(
  production: string[],
  _alreadyQualified: ReadonlySet<string>,
  digest: BodyDigest,
) {
  if (new Set(production).size !== production.length) return null;
  for (const composed of [false, true]) {
    const bodies = new Map<string, Pair>();
    if (composed)
      for (const [file, before, , after] of original.inheritedProductionBodies)
        bodies.set(file, [file, before, after]);
    for (const [file, inherited, after, before] of original.componentBodies)
      bodies.set(file, [file, composed ? before : inherited, after]);
    const files = [...bodies.keys()].toSorted();
    // This successor is a closed whole footprint; another authority cannot waive an extra body.
    if (JSON.stringify(production.toSorted()) !== JSON.stringify(files)) continue;
    const pairs: Pair[] = [
      ...bodies.values(),
      ...original.inheritedProductionBodies.map(([file, before, inherited, after]): Pair => [
        file,
        composed ? before : inherited,
        after,
      ]),
      ...original.inheritedCustodyBodies.map(([file, before, inherited]): Pair => [
        file,
        composed ? before : inherited,
        changed.get(file)?.after ?? inherited,
      ]),
      ...original.inheritedHarnessExtensions.map(([file, absent, inherited]): Pair => [
        file,
        composed ? absent : file === resolve ? changed.get(file)!.after : inherited,
        changed.get(file)?.after ?? inherited,
      ]),
    ];
    if (
      pairs.some(
        ([file, before, after]) =>
          digest("before", file) !== before || digest("after", file) !== after,
      )
    )
      continue;
    if (original.originalComponentBodies.some(([file, before]) => digest("after", file) !== before))
      continue;
    if (
      digest(
        "after",
        "tests/performance/support/warm-type-backed-project-config-null-completion-manifest.json",
      ) !== successor.nullCompletionManifestBodySHA256
    )
      continue;
    const loaderContext = qualifyComponentContextLoaderContext(digest);
    if (!loaderContext || loaderContext.manifestSHA256 !== successor.loaderManifestSHA256) continue;
    return {
      authority: composed
        ? "complete-project-config-and-component-owner-migration-successor"
        : "complete-parent-relative-component-owner-migration-successor",
      manifestSHA256,
      originalComponentManifestSHA256: successor.originalComponentManifestSHA256,
      parentManifestSHA256: original.parentManifestSHA256,
      nullCompletionManifestSHA256: successor.nullCompletionManifestSHA256,
      completeComponentBodies: original.componentBodies.length,
      inheritedProductionBodies: original.inheritedProductionBodies.length,
      inheritedCustodyBodies: original.inheritedCustodyBodies.length,
      inheritedHarnessExtensions: original.inheritedHarnessExtensions.length,
      originalComponentBodies: original.originalComponentBodies.length,
      harnessSuccessors: successor.harnessSuccessors,
      originalPackets: successor.originalPackets,
      supplementalResolves: successor.supplementalResolves,
      supplementalRefusals: successor.supplementalRefusals,
      originalComparedFields: successor.originalComparedFields,
      loaderContext,
      files,
    };
  }
  return null;
}
