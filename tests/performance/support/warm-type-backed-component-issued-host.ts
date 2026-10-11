import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import "./warm-type-backed-component-owner-migration-host.ts";
import { componentContextManifest as original } from "./warm-type-backed-component-context-manifest.ts";
import { qualifyComponentContextLoaderContext } from "./warm-type-backed-component-context-loader-host.ts";
import migration from "./warm-type-backed-component-owner-migration-manifest.json" with { type: "json" };
import successor from "./warm-type-backed-component-issued-manifest.json" with { type: "json" };
import {
  issuedCompletionManifest as issued,
  issuedCompletionManifestSHA256,
  qualifyIssuedCompletionContext,
} from "./warm-type-backed-issued-completion-host.ts";

type BodyDigest = (side: "before" | "after", file: string) => string | null;
type Pair = [string, string | null, string];
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const componentIssuedManifest = successor;
export const componentIssuedManifestSHA256 = hash(successor);
assert.equal(
  componentIssuedManifestSHA256,
  "240c692658ad78ee2207cddc2f5ef3b1d1c4e3ad6d9d003ca0e96e067876cc28",
);
assert.equal(successor.version, 1);
assert.equal(hash(original), successor.originalComponentManifestSHA256);
assert.equal(original.parentManifestSHA256, successor.originalConfigManifestSHA256);
assert.equal(hash(migration), successor.ownerMigrationManifestSHA256);
assert.equal(issuedCompletionManifestSHA256, successor.issuedCompletionManifestSHA256);
for (const key of [
  "originalConfigManifestSHA256",
  "loaderManifestSHA256",
  "nullCompletionManifestSHA256",
  "original400",
  "originalPackets",
  "supplementalResolves",
  "supplementalRefusals",
  "originalComparedFields",
] as const)
  assert.equal(migration[key], successor[key]);
assert.equal(issued.originalConfigManifestSHA256, successor.originalConfigManifestSHA256);
assert.equal(successor.completeComponentBodies, original.componentBodies.length);
const producer = new Map(issued.producerBodies.map((row) => [row[0], row]));
assert.ok(original.componentBodies.every(([file]) => !producer.has(file)));
const changed = new Map(migration.harnessSuccessors.map(([file, , after]) => [file, after]));
const resolve = "tests/performance/support/warm-type-backed-owner-resolve.ts";
export const componentIssuedProduction = [
  ...new Set([
    ...original.inheritedProductionBodies.map(([file]) => file),
    ...original.componentBodies.map(([file]) => file),
    ...producer.keys(),
  ]),
].toSorted();
assert.equal(componentIssuedProduction.length, successor.composedProductionBodies);

/** Bind the complete original component and owner successor with the exact issued-item producer. */
export function qualifyComponentIssuedHost(
  production: string[],
  _alreadyQualified: ReadonlySet<string>,
  digest: BodyDigest,
) {
  if (new Set(production).size !== production.length) return null;
  for (const composed of [false, true]) {
    const bodies = new Map<string, Pair>();
    if (composed)
      for (const [file, before, , after] of original.inheritedProductionBodies)
        bodies.set(file, [file, before, producer.get(file)?.[3] ?? after]);
    for (const [file, inherited, after, before] of original.componentBodies)
      bodies.set(file, [file, composed ? before : inherited, after]);
    if (composed)
      for (const [file, before, , after] of issued.producerBodies)
        bodies.set(file, [file, before, after!]);
    const files = [...bodies.keys()].toSorted();
    if (JSON.stringify(production.toSorted()) !== JSON.stringify(files)) continue;
    const pairs: Pair[] = [
      ...bodies.values(),
      ...original.inheritedProductionBodies.map(([file, before, inherited, after]): Pair => [
        file,
        composed ? before : (producer.get(file)?.[3] ?? inherited),
        producer.get(file)?.[3] ?? after,
      ]),
      ...original.inheritedCustodyBodies.map(([file, before, inherited]): Pair => [
        file,
        composed ? before : inherited,
        changed.get(file) ?? inherited,
      ]),
      ...original.inheritedHarnessExtensions.map(([file, absent, inherited]): Pair => [
        file,
        composed ? absent : file === resolve ? changed.get(file)! : inherited,
        changed.get(file) ?? inherited,
      ]),
    ];
    if (
      pairs.some(
        ([file, before, after]) =>
          digest("before", file) !== before || digest("after", file) !== after,
      )
    )
      continue;
    if (original.originalComponentBodies.some(([file, after]) => digest("after", file) !== after))
      continue;
    if (
      digest(
        "after",
        "tests/performance/support/warm-type-backed-project-config-null-completion-manifest.json",
      ) !== migration.nullCompletionManifestBodySHA256
    )
      continue;
    if (
      digest(
        "after",
        "tests/performance/support/warm-type-backed-issued-completion-manifest.json",
      ) !== successor.issuedManifestBodySHA256
    )
      continue;
    const loaderContext = qualifyComponentContextLoaderContext(digest);
    if (!loaderContext || loaderContext.manifestSHA256 !== successor.loaderManifestSHA256) continue;
    const issuedCompletionContext = qualifyIssuedCompletionContext(
      digest,
      composed ? "parent-pair" : "inherited",
    );
    if (!issuedCompletionContext) continue;
    return {
      authority: composed
        ? "complete-project-config-component-issued-completion-successor"
        : "complete-parent-relative-component-issued-completion-successor",
      manifestSHA256: componentIssuedManifestSHA256,
      originalComponentManifestSHA256: successor.originalComponentManifestSHA256,
      parentManifestSHA256: original.parentManifestSHA256,
      ownerMigrationManifestSHA256: successor.ownerMigrationManifestSHA256,
      nullCompletionManifestSHA256: successor.nullCompletionManifestSHA256,
      completeComponentBodies: original.componentBodies.length,
      inheritedProductionBodies: original.inheritedProductionBodies.length,
      inheritedCustodyBodies: original.inheritedCustodyBodies.length,
      inheritedHarnessExtensions: original.inheritedHarnessExtensions.length,
      originalComponentBodies: original.originalComponentBodies.length,
      harnessSuccessors: migration.harnessSuccessors,
      originalPackets: successor.originalPackets,
      supplementalResolves: successor.supplementalResolves,
      supplementalRefusals: successor.supplementalRefusals,
      originalComparedFields: successor.originalComparedFields,
      loaderContext,
      issuedCompletionContext,
      files,
    };
  }
  return null;
}
