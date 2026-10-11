import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { componentContextManifest as manifest } from "./warm-type-backed-component-context-manifest.ts";
import { qualifyComponentContextLoaderContext } from "./warm-type-backed-component-context-loader-host.ts";
import { projectConfigManifest as parent } from "./warm-type-backed-project-config-manifest.ts";

type BodyDigest = (side: "before" | "after", file: string) => string | null;
type Pair = [string, string | null, string];
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const manifestSHA256 = hash(manifest);
assert.equal(manifestSHA256, "bcf13b6eaf587647a1ef04068b49c264156967f37278292ff2720bf14ef17686");
assert.equal(manifest.version, 1);
assert.equal(manifest.originalComponentSource, "c0dc03760aaf8cdb4810e3ed0417c668a36c4721");
assert.equal(manifest.originalConfigSource, parent.originalSource);
assert.equal(hash(parent), manifest.parentManifestSHA256);
assert.equal(manifest.componentBodies.length, 28);
assert.equal(manifest.inheritedProductionBodies.length, 90);
assert.equal(manifest.inheritedCustodyBodies.length, 51);
assert.equal(manifest.originalComponentBodies.length, 4);
assert.deepEqual(
  manifest.inheritedProductionBodies.map(([file, before, after]) => [file, before, after]),
  parent.files,
);
assert.deepEqual(
  manifest.inheritedCustodyBodies,
  parent.preservedBodies.map(([file, before, after]) => [file, before, after ?? before]),
);
assert.deepEqual(manifest.inheritedHarnessExtensions, parent.harnessExtensions ?? []);
const component = new Map(manifest.componentBodies.map((row) => [row[0], row]));
for (const [file, original, inherited, current] of manifest.inheritedProductionBodies) {
  const owned = component.get(file);
  assert.equal(current, owned?.[2] ?? inherited);
  if (owned) {
    assert.equal(owned[1], inherited);
    assert.equal(owned[3], original);
  }
}
for (const rows of [
  manifest.componentBodies,
  manifest.inheritedProductionBodies,
  manifest.inheritedCustodyBodies,
  manifest.inheritedHarnessExtensions,
  manifest.originalComponentBodies,
]) {
  const files = rows.map(([file]) => file);
  assert.deepEqual(files, [...new Set(files)].toSorted());
  for (const row of rows)
    for (const digest of row.slice(1)) if (digest !== null) assert.match(digest, /^[a-f0-9]{64}$/u);
}
assert.match(manifest.parentSource, /^[a-f0-9]{40}$/u);
assert.match(manifest.reviewedSource, /^[a-f0-9]{40}$/u);

/** Admit exactly this child or its complete parent composition; retain every parent authority. */
export function qualifyComponentContextHost(
  production: string[],
  alreadyQualified: ReadonlySet<string>,
  digest: BodyDigest,
) {
  if (new Set(production).size !== production.length) return null;
  for (const composed of [false, true]) {
    const bodies = new Map<string, Pair>();
    if (composed)
      for (const [file, before, , after] of manifest.inheritedProductionBodies)
        bodies.set(file, [file, before, after]);
    for (const [file, parentBefore, after, originalBefore] of manifest.componentBodies)
      bodies.set(file, [file, composed ? originalBefore : parentBefore, after]);
    const files = [...bodies.keys()].toSorted();
    if (production.some((file) => !alreadyQualified.has(file) && !bodies.has(file))) continue;
    if (
      JSON.stringify(production.filter((file) => bodies.has(file)).toSorted()) !==
      JSON.stringify(files)
    )
      continue;
    const pairs: Pair[] = [
      ...bodies.values(),
      ...manifest.inheritedProductionBodies.map(([file, original, inherited, current]): Pair => [
        file,
        composed ? original : inherited,
        current,
      ]),
      ...manifest.inheritedCustodyBodies.map(([file, original, inherited]): Pair => [
        file,
        composed ? original : inherited,
        inherited,
      ]),
      ...manifest.inheritedHarnessExtensions.map(([file, absent, inherited]): Pair => [
        file,
        composed ? absent : inherited,
        inherited,
      ]),
    ];
    if (
      pairs.some(
        ([file, before, after]) =>
          digest("before", file) !== before || digest("after", file) !== after,
      )
    )
      continue;
    if (
      manifest.originalComponentBodies.some(
        ([file, original]) => digest("after", file) !== original,
      )
    )
      continue;
    const loaderContext = qualifyComponentContextLoaderContext(digest);
    if (!loaderContext) continue;
    return {
      authority: composed
        ? "complete-project-config-and-component-context-slices"
        : "complete-parent-relative-component-context-slice",
      manifestSHA256,
      parentManifestSHA256: manifest.parentManifestSHA256,
      parentSource: manifest.parentSource,
      reviewedSource: manifest.reviewedSource,
      originalComponentSource: manifest.originalComponentSource,
      completeComponentBodies: manifest.componentBodies.length,
      inheritedProductionBodies: manifest.inheritedProductionBodies.length,
      inheritedCustodyBodies: manifest.inheritedCustodyBodies.length,
      inheritedHarnessExtensions: manifest.inheritedHarnessExtensions.length,
      originalComponentBodies: manifest.originalComponentBodies.length,
      loaderContext,
      files,
    };
  }
  return null;
}
