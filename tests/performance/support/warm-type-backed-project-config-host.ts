import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";

type BodyDigest = (side: "before" | "after", file: string) => string | null;
const manifest = JSON.parse(
  fs.readFileSync(
    new URL("./warm-type-backed-project-config-manifest.json", import.meta.url),
    "utf8",
  ),
) as {
  version: number;
  originalSource: string;
  reviewedSource: string;
  files: Array<[string, string | null, string]>;
  preservedBodies: Array<[string, string, string]>;
  harnessExtensions: Array<[string, null, string]>;
};
const manifestSHA256 = createHash("sha256").update(JSON.stringify(manifest)).digest("hex");
assert.equal(manifestSHA256, "433e284764244dd3e171ff3513552054dbbd28b7b9603866c25871fc1dd904fc");
assert.equal(manifest.version, 2);
assert.equal(manifest.originalSource, "7386b2a79604ae5b74cb541be911eb19735e68b2");
assert.equal(manifest.reviewedSource, "0b9cbfebf12dbd49b16fd30a6073184d806c2c07");
const expectedFiles = manifest.files.map(([file]) => file);
assert.equal(expectedFiles.length, 90);
assert.deepEqual(expectedFiles, [...new Set(expectedFiles)].toSorted());
assert.equal(manifest.preservedBodies.length, 51);
for (const [, before, after] of manifest.files) {
  if (before !== null) assert.match(before, /^[a-f0-9]{64}$/u);
  assert.match(after, /^[a-f0-9]{64}$/u);
}

/** Admit only the entire reviewed config slice to the unchanged original400 measurement. */
export function qualifyProjectConfigHost(
  production: string[],
  alreadyQualified: ReadonlySet<string>,
  digest: BodyDigest,
) {
  if (new Set(production).size !== production.length) return null;
  const files = new Set(expectedFiles);
  if (production.every((file) => alreadyQualified.has(file))) return null;
  if (production.some((file) => !alreadyQualified.has(file) && !files.has(file))) return null;
  const footprint = production.filter((file) => files.has(file)).toSorted();
  if (JSON.stringify(footprint) !== JSON.stringify(expectedFiles)) return null;
  for (const [file, before, after] of manifest.files)
    if (digest("before", file) !== before || digest("after", file) !== after) return null;
  for (const [file, original, reviewed] of manifest.preservedBodies)
    if (digest("before", file) !== original || digest("after", file) !== reviewed) return null;
  for (const [file, absent, reviewed] of manifest.harnessExtensions)
    if (digest("before", file) !== absent || digest("after", file) !== reviewed) return null;
  return {
    authority: "complete-reviewed-project-config-slice",
    manifestSHA256,
    originalSource: manifest.originalSource,
    reviewedSource: manifest.reviewedSource,
    completeBodyPairs: manifest.files.length,
    preservedBodyPairs: manifest.preservedBodies.length,
    reviewedHarnessSuccessors: manifest.preservedBodies
      .filter(([, before, after]) => before !== after)
      .map(([file]) => file),
    harnessExtensions: manifest.harnessExtensions.map(([file]) => file),
    files: expectedFiles,
  };
}
