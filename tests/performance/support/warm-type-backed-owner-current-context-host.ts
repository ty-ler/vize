import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { componentContextManifest as original } from "./warm-type-backed-component-context-manifest.ts";
import {
  qualifyComponentIssuedHost,
  componentIssuedManifestSHA256,
} from "./warm-type-backed-component-issued-host.ts";
import {
  issuedCompletionManifest as issued,
  issuedCompletionManifestSHA256,
} from "./warm-type-backed-issued-completion-host.ts";
import successor from "./warm-type-backed-component-owner-migration-manifest.json" with { type: "json" };
import { ownerCurrentContext } from "./warm-type-backed-owner-current-context.ts";

type Digest = (source: string, file: string) => string | null;
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const expectedSHA256 = "6bedbdf5beb83e75ff40bd69151ca3dc2a1f795d936f388b3073b50451857d93";
assert.equal(hash(ownerCurrentContext), expectedSHA256);
assert.equal(hash(original), ownerCurrentContext.originalComponentManifestSHA256);
assert.equal(hash(successor), ownerCurrentContext.componentOwnerManifestSHA256);
assert.equal(original.parentManifestSHA256, ownerCurrentContext.originalConfigManifestSHA256);
assert.equal(issuedCompletionManifestSHA256, ownerCurrentContext.issuedCompletionManifestSHA256);
assert.equal(componentIssuedManifestSHA256, ownerCurrentContext.componentIssuedManifestSHA256);

/** Whole measured product bodies; driver instrumentation is bound separately to its own Git tree. */
export function qualifyCurrentOwnerSourceContext(
  production: string[],
  digest: Digest,
  mode: Digest,
  context = ownerCurrentContext,
) {
  if (hash(context) !== expectedSHA256) return null;
  const { baseline, head, actualParent, actualMain, publicBaseline } = context.sources;
  const bodies = new Map<string, true>(
    original.inheritedProductionBodies.map(([file]) => {
      assert.ok(typeof file === "string", "an inherited source body needs its actual path");
      return [file, true];
    }),
  );
  for (const [file] of original.componentBodies) {
    assert.ok(typeof file === "string", "a component source body needs its actual path");
    bodies.set(file, true);
  }
  const producer = new Map(issued.producerBodies.map((row) => [row[0], row]));
  for (const [file] of issued.producerBodies) bodies.set(file, true);
  if (bodies.size !== 119) return null;
  const additional = [...context.inheritedBodies, ...context.loaderMigration];
  const files = [
    ...bodies.keys(),
    ...additional.map(([file]) => {
      assert.ok(typeof file === "string", "a complete source body needs its actual path");
      return file;
    }),
  ].toSorted((left: string, right: string) => (left < right ? -1 : left > right ? 1 : 0));
  if (
    files.length !== 285 ||
    new Set(files).size !== files.length ||
    JSON.stringify(production.toSorted()) !== JSON.stringify(files)
  )
    return null;
  const changed = new Map(successor.harnessSuccessors.map(([file, , after]) => [file, after]));
  const pairs = [
    ...original.inheritedProductionBodies.map(([file, before, , after]) => [
      file,
      before,
      producer.get(file)?.[3] ?? after,
    ]),
    ...original.componentBodies.map(([file, , after, before]) => [file, before, after]),
    ...issued.producerBodies.map(([file, before, , after]) => [file, before, after]),
    ...original.inheritedCustodyBodies.map(([file, before, after]) => [
      file,
      before,
      changed.get(file) ?? after,
    ]),
    ...original.inheritedHarnessExtensions.map(([file, before, after]) => [
      file,
      before,
      changed.get(file) ?? after,
    ]),
  ];
  if (
    pairs.some(
      ([file, before, after]) =>
        digest(baseline, file!) !== before || digest(head, file!) !== after,
    )
  )
    return null;
  for (const [file, before, after] of pairs) {
    if (!bodies.has(file!)) continue;
    const beforeMode =
      before === null
        ? null
        : context.originalExecutableBefore.includes(file!)
          ? "100755"
          : "100644";
    const afterMode =
      after === null ? null : context.originalExecutableAfter.includes(file!) ? "100755" : "100644";
    if (mode(baseline, file!) !== beforeMode || mode(head, file!) !== afterMode) return null;
  }
  if (original.originalComponentBodies.some(([file, body]) => digest(head, file) !== body))
    return null;
  const publicAuthority = qualifyComponentIssuedHost([...bodies.keys()], new Set(), (side, file) =>
    digest(side === "before" ? publicBaseline : head, file),
  );
  if (
    !publicAuthority ||
    publicAuthority.loaderContext.manifestSHA256 !== context.originalLoaderManifestSHA256
  )
    return null;
  for (const [file, before, after, beforeMode, afterMode, anchor] of context.inheritedBodies) {
    if (
      digest(baseline, file!) !== before ||
      mode(baseline, file!) !== beforeMode ||
      digest(head, file!) !== after ||
      mode(head, file!) !== afterMode ||
      digest(actualParent, file!) !== after ||
      mode(actualParent, file!) !== afterMode ||
      digest(publicBaseline, file!) !== after ||
      mode(publicBaseline, file!) !== afterMode
    )
      return null;
    if (
      anchor === "actual-merged-main" &&
      (digest(actualMain, file!) !== after || mode(actualMain, file!) !== afterMode)
    )
      return null;
    if (anchor !== "actual-merged-main" && anchor !== "actual-public-lower-stack") return null;
  }
  for (const [file, before, after, beforeMode, afterMode] of context.loaderMigration) {
    if (
      digest(baseline, file!) !== before ||
      mode(baseline, file!) !== beforeMode ||
      digest(head, file!) !== after ||
      mode(head, file!) !== afterMode ||
      digest(actualParent, file!) !== after ||
      mode(actualParent, file!) !== afterMode ||
      digest(publicBaseline, file!) !== after ||
      mode(publicBaseline, file!) !== afterMode
    )
      return null;
  }
  return {
    authority: "private-complete-composed-original-owner-source-context",
    manifestSHA256: expectedSHA256,
    sources: context.sources,
    originalConfigManifestSHA256: context.originalConfigManifestSHA256,
    originalComponentManifestSHA256: context.originalComponentManifestSHA256,
    originalLoaderManifestSHA256: context.originalLoaderManifestSHA256,
    nullCompletionManifestSHA256: context.nullCompletionManifestSHA256,
    componentOwnerManifestSHA256: context.componentOwnerManifestSHA256,
    issuedCompletionManifestSHA256: context.issuedCompletionManifestSHA256,
    componentIssuedManifestSHA256: context.componentIssuedManifestSHA256,
    publicAuthority,
    inheritedBodies: context.inheritedBodies,
    loaderMigration: context.loaderMigration,
    files,
    runtimeOwnerAuthority: false,
  };
}
