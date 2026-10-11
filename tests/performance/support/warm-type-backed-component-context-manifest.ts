// Reassemble the exact finite authority without over-limit source files.
import assert from "node:assert/strict";
import metadata from "./warm-type-backed-component-context-manifest.json" with { type: "json" };
import productionFirst from "./warm-type-backed-component-context-production-1.json" with { type: "json" };
import productionSecond from "./warm-type-backed-component-context-production-2.json" with { type: "json" };
import custody from "./warm-type-backed-component-context-custody.json" with { type: "json" };

type Pair = [string, string | null, string];
export type ComponentContextManifest = {
  version: number;
  originalComponentSource: string;
  originalConfigSource: string;
  parentSource: string;
  reviewedSource: string;
  parentManifestSHA256: string;
  componentBodies: Array<[string, string | null, string, string | null]>;
  inheritedProductionBodies: Array<[string, string | null, string, string]>;
  inheritedCustodyBodies: Array<[string, string, string]>;
  inheritedHarnessExtensions: Pair[];
  originalComponentBodies: Array<[string, string]>;
};

assert.deepEqual(metadata.inheritedProductionBodies, [
  "warm-type-backed-component-context-production-1.json",
  "warm-type-backed-component-context-production-2.json",
]);
assert.deepEqual(metadata.inheritedCustodyBodies, [
  "warm-type-backed-component-context-custody.json",
]);
assert.equal(productionFirst.length, 45);
assert.equal(productionSecond.length, 45);
assert.equal(custody.length, 51);

export const componentContextManifest = {
  ...metadata,
  inheritedProductionBodies: [...productionFirst, ...productionSecond],
  inheritedCustodyBodies: custody,
} as ComponentContextManifest;
