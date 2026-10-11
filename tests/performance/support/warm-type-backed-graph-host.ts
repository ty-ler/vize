import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";

type BodyDigest = (side: "before" | "after", file: string) => string | null;
const manifest = JSON.parse(
  fs.readFileSync(new URL("./warm-type-backed-graph-manifest.json", import.meta.url), "utf8"),
) as {
  version: number;
  originalSource: string;
  reviewedSource: string;
  files: string[];
  preservedBodies: string[];
};
const manifestSHA256 = createHash("sha256").update(JSON.stringify(manifest)).digest("hex");
assert.equal(manifestSHA256, "df60a825b45d1ed2badb5cfa645e9958e1e2a509deae2aaab9cdf2c7e8bef9ab");
assert.equal(manifest.version, 1);
assert.equal(manifest.originalSource, "fc551dc09faaa3187cd37a3a02cb94ebab0c3352");
assert.equal(manifest.reviewedSource, "bbf94a5c634fd2859daaeb62e43a06cdce60844c");
assert.equal(manifest.files.length, 188);
assert.equal(manifest.preservedBodies.length, 45);
const decode = (row: string, fields: number) => {
  const values = row.split("\t");
  assert.equal(values.length, fields);
  assert.ok(values[0] && !values[0].startsWith("/") && !values[0].split("/").includes(".."));
  for (const value of values.slice(1)) assert.match(value, /^(?:[a-f0-9]{64}|-)$/u);
  return values;
};
const pairs = manifest.files.map((row) => {
  const [file, before, after] = decode(row, 3);
  assert.ok(before !== "-" || after !== "-");
  return [file, before === "-" ? null : before, after === "-" ? null : after] as const;
});
const preserved = manifest.preservedBodies.map((row) => {
  const [file, body] = decode(row, 2);
  assert.notEqual(body, "-");
  return [file, body] as const;
});
const expectedFiles = Object.freeze(pairs.map(([file]) => file));
for (const files of [expectedFiles, preserved.map(([file]) => file)]) {
  assert.equal(new Set(files).size, files.length);
  assert.deepEqual(files, files.toSorted());
}

/** Admit only this complete reviewed producer and unchanged original workload. */
export function qualifyGraphHost(production: string[], digest: BodyDigest) {
  if (new Set(production).size !== production.length) return null;
  if (JSON.stringify(production.toSorted()) !== JSON.stringify(expectedFiles)) return null;
  // gitBodyDigest requires a complete ordinary 100644 Git blob on both sides,
  // or literal absence; same bytes under another mode/type do not qualify.
  for (const [file, before, after] of pairs)
    if (digest("before", file) !== before || digest("after", file) !== after) return null;
  for (const [file, original] of preserved)
    if (digest("before", file) !== original || digest("after", file) !== original) return null;
  return {
    authority: "complete-reviewed-native-graph-slice",
    manifestSHA256,
    originalSource: manifest.originalSource,
    reviewedSource: manifest.reviewedSource,
    completeBodyPairs: pairs.length,
    preservedBodyPairs: preserved.length,
    files: expectedFiles,
  };
}
