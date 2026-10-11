import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";

type Part = [string, string];
const index = JSON.parse(
  fs.readFileSync(
    new URL("./warm-type-backed-project-config-manifest.json", import.meta.url),
    "utf8",
  ),
) as {
  version: number;
  originalSource: string;
  reviewedSource: string;
  originalRawSHA256: string;
  manifestSHA256: string;
  files: Part[];
  preservedBodies: Part[];
  harnessExtensions: Part[];
};
const sha256 = (body: string | Uint8Array) => createHash("sha256").update(body).digest("hex");
assert.equal(
  sha256(JSON.stringify(index)),
  "85c5277b4b91d8e383b48f60057d117edfb73250003989018a8877a5c94bf69d",
);
assert.equal(
  index.originalRawSHA256,
  "990a922d0b400bedac3f6e29ce245b719ef3430b56430016a4ba0bafe65a309c",
);
assert.deepEqual(
  [...index.files, ...index.preservedBodies, ...index.harnessExtensions].map(([file]) => file),
  [
    "warm-type-backed-project-config-files-1.json",
    "warm-type-backed-project-config-files-2.json",
    "warm-type-backed-project-config-preserved-bodies.json",
    "warm-type-backed-project-config-harness-extensions.json",
  ],
);
function readParts<T>(parts: Part[]): T[] {
  return parts.flatMap(([file, hash]) => {
    const body = fs.readFileSync(new URL(file, import.meta.url));
    assert.equal(sha256(body), hash, `complete authority part: ${file}`);
    return JSON.parse(body.toString("utf8")) as T[];
  });
}

/** Exact original JSON value; bounded storage changes no body pair or authority. */
export const projectConfigManifest = {
  version: index.version,
  originalSource: index.originalSource,
  reviewedSource: index.reviewedSource,
  files: readParts<[string, string | null, string]>(index.files),
  preservedBodies: readParts<[string, string, string]>(index.preservedBodies),
  harnessExtensions: readParts<[string, null, string]>(index.harnessExtensions),
};
assert.equal(sha256(JSON.stringify(projectConfigManifest)), index.manifestSHA256);
assert.equal(
  index.manifestSHA256,
  "433e284764244dd3e171ff3513552054dbbd28b7b9603866c25871fc1dd904fc",
);
