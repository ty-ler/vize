import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { qualifyProjectConfigHost } from "./warm-type-backed-project-config-host.ts";
import { qualifyProjectConfigNullCompletionHost } from "./warm-type-backed-project-config-null-completion-host.ts";

type BodyDigest = (side: "before" | "after", file: string) => string | null;
type BodyPair = [string, string | null, string | null];
const manifest = JSON.parse(
  fs.readFileSync(
    new URL("./warm-type-backed-project-config-loader-manifest.json", import.meta.url),
    "utf8",
  ),
) as {
  version: number;
  parentSource: string;
  composedSource: string;
  originalConfigManifestSHA256: string;
  legacyContext: BodyPair[];
  composedContext: BodyPair[];
};
const manifestSHA256 = createHash("sha256").update(JSON.stringify(manifest)).digest("hex");
assert.equal(manifestSHA256, "a7ff805231e2d318d4bebbbce3926a2bbdb0d4f0d5209c458bedb268ceef66c4");
assert.equal(manifest.version, 1);
assert.equal(manifest.legacyContext.length, 2);
assert.equal(manifest.composedContext.length, 2);
assert.deepEqual(
  manifest.legacyContext.map(([file]) => file),
  manifest.composedContext.map(([file]) => file),
);
for (const pairs of [manifest.legacyContext, manifest.composedContext]) {
  assert.equal(new Set(pairs.map(([file]) => file)).size, pairs.length);
  for (const [, before, after] of pairs)
    for (const digest of [before, after])
      if (digest !== null) assert.match(digest, /^[a-f0-9]{64}$/u);
}

/** Retain the original90 authority and bind its complete inherited loader context. */
export function qualifyProjectConfigLoaderHost(
  production: string[],
  alreadyQualified: ReadonlySet<string>,
  digest: BodyDigest,
) {
  const original =
    qualifyProjectConfigHost(production, alreadyQualified, digest) ??
    qualifyProjectConfigNullCompletionHost(production, alreadyQualified, digest);
  if (!original) return null;
  assert.equal(
    "originalConfigManifestSHA256" in original
      ? original.originalConfigManifestSHA256
      : original.manifestSHA256,
    manifest.originalConfigManifestSHA256,
  );
  const context = [
    ["original-reviewed-loader", manifest.legacyContext],
    ["complete-composed-vite-loader", manifest.composedContext],
  ] as const;
  for (const [authority, pairs] of context) {
    if (
      pairs.every(
        ([file, before, after]) =>
          digest("before", file) === before && digest("after", file) === after,
      )
    )
      return {
        ...original,
        loaderContext: {
          authority,
          manifestSHA256,
          parentSource: manifest.parentSource,
          composedSource: manifest.composedSource,
          completeBodyPairs: pairs,
        },
      };
  }
  return null;
}
