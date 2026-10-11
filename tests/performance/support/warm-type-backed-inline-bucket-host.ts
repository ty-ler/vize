import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";

type BodyDigest = (side: "before" | "after", file: string) => string | null;
const manifest = JSON.parse(
  fs.readFileSync(
    new URL("./warm-type-backed-inline-bucket-manifest.json", import.meta.url),
    "utf8",
  ),
) as {
  version: number;
  originalSource: string;
  reviewedSource: string;
  files: string[];
  preservedBodies: string[];
};
const previous = JSON.parse(
  fs.readFileSync(new URL("./warm-type-backed-graph-manifest.json", import.meta.url), "utf8"),
) as { files: string[]; preservedBodies: string[] };
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const manifestSHA256 = hash(manifest);
assert.equal(manifestSHA256, "ba362ecf06dc733b802e448f3d4362cd4a5d5915075f8995cbd8e7b721093d6f");
assert.equal(hash(previous), "da67c0b266a29d54ee9561d7dc7dbe739e621cbc66e796ebeee2bdefbb009adc");
assert.equal(manifest.version, 1);
assert.equal(manifest.originalSource, "b63d18511ce087e5ef9f6b1da17031f258ef7276");
assert.equal(manifest.reviewedSource, "ab497e944cbfb57952db8dad1f787b0f6df5cd9b");
assert.equal(manifest.files.length, 196);
assert.equal(manifest.preservedBodies.length, 45);
assert.deepEqual(manifest.preservedBodies, previous.preservedBodies);
const prefix =
  "crates/vize_canon/src/corsa_bridge/vue_dependencies_alias/context/build/consumption";
const changed = [
  `${prefix}.rs`,
  `${prefix}/population.rs`,
  `${prefix}/tests.rs`,
  `${prefix}/tests/inline_bucket.rs`,
].toSorted();
const decode = (row: string, count: number) => {
  const parts = row.split("\t");
  assert.equal(parts.length, count);
  assert.ok(parts[0] && !parts[0].startsWith("/") && !parts[0].split("/").includes(".."));
  for (const body of parts.slice(1)) assert.match(body, /^(?:[a-f0-9]{64}|-)$/u);
  return parts;
};
const pairs = manifest.files.map((row) => decode(row, 3));
const files = pairs.map(([file]) => file);
assert.equal(new Set(files).size, 196);
assert.deepEqual(files, files.toSorted());
assert.deepEqual(
  pairs.filter(([, before, after]) => before !== after).map(([file]) => file),
  changed,
);
const oldBodies = new Map(
  previous.files.map((row) => {
    const [file, , after] = decode(row, 3);
    return [file, after];
  }),
);
for (const [file, before] of pairs) {
  assert.equal(before, oldBodies.get(file) ?? "-");
  if (!oldBodies.has(file)) assert.equal(file, `${prefix}/tests/inline_bucket.rs`);
}

/** A four-path storage successor must retain every preceding native producer. */
export function qualifyInlineBucketHost(production: string[], digest: BodyDigest) {
  if (new Set(production).size !== production.length) return null;
  if (JSON.stringify(production.toSorted()) !== JSON.stringify(changed)) return null;
  for (const [file, before, after] of pairs)
    if (
      digest("before", file) !== (before === "-" ? null : before) ||
      digest("after", file) !== (after === "-" ? null : after)
    )
      return null;
  for (const row of manifest.preservedBodies) {
    const [file, body] = decode(row, 2);
    if (digest("before", file) !== body || digest("after", file) !== body) return null;
  }
  return {
    authority: "complete-reviewed-inline-native-fact-storage",
    originalSource: manifest.originalSource,
    reviewedSource: manifest.reviewedSource,
    manifestSHA256,
    completeBodyPairs: 196,
    preservedBodyPairs: 45,
    files: changed,
  };
}
