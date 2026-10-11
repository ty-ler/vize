import assert from "node:assert/strict";
import metadata from "./warm-type-backed-owner-current-context.json" with { type: "json" };
import part1 from "./warm-type-backed-owner-current-context-part-1.json" with { type: "json" };
import part2 from "./warm-type-backed-owner-current-context-part-2.json" with { type: "json" };
import part3 from "./warm-type-backed-owner-current-context-part-3.json" with { type: "json" };
import part4 from "./warm-type-backed-owner-current-context-part-4.json" with { type: "json" };
import part5 from "./warm-type-backed-owner-current-context-part-5.json" with { type: "json" };
import part6 from "./warm-type-backed-owner-current-context-part-6.json" with { type: "json" };
const parts = [part1, part2, part3, part4, part5, part6];
assert.deepEqual(
  metadata.inheritedBodyParts.map(({ file }) => file),
  [
    "warm-type-backed-owner-current-context-part-1.json",
    "warm-type-backed-owner-current-context-part-2.json",
    "warm-type-backed-owner-current-context-part-3.json",
    "warm-type-backed-owner-current-context-part-4.json",
    "warm-type-backed-owner-current-context-part-5.json",
    "warm-type-backed-owner-current-context-part-6.json",
  ],
);
assert.deepEqual(
  metadata.inheritedBodyParts.map(({ rows }) => rows),
  [32, 32, 32, 32, 32, 4],
);
assert.deepEqual(
  parts.map((part) => part.length),
  [32, 32, 32, 32, 32, 4],
);
export const ownerCurrentContext = { ...metadata, inheritedBodies: parts.flat() };
export const ownerCurrentContextSHA256 =
  "6bedbdf5beb83e75ff40bd69151ca3dc2a1f795d936f388b3073b50451857d93";
