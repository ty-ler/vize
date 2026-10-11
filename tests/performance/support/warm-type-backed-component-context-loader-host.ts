import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import manifest from "./warm-type-backed-project-config-loader-manifest.json" with { type: "json" };

type BodyDigest = (side: "before" | "after", file: string) => string | null;
const manifestSHA256 = createHash("sha256").update(JSON.stringify(manifest)).digest("hex");
assert.equal(manifestSHA256, "a7ff805231e2d318d4bebbbce3926a2bbdb0d4f0d5209c458bedb268ceef66c4");
assert.equal(manifest.version, 1);
assert.equal(
  manifest.originalConfigManifestSHA256,
  "433e284764244dd3e171ff3513552054dbbd28b7b9603866c25871fc1dd904fc",
);
const files = [
  "crates/vize_carton/src/config/loader/js.rs",
  "crates/vize_carton/src/config/loader/module-runtime.mjs",
];
for (const pairs of [manifest.legacyContext, manifest.composedContext]) {
  assert.equal(pairs.length, 2);
  assert.deepEqual(
    pairs.map(([file]) => file),
    files,
  );
  for (const [, before, after] of pairs)
    for (const digest of [before, after])
      if (digest !== null) assert.match(digest, /^[a-f0-9]{64}$/u);
}

/** Called only after the child's complete 28/113 production and custody qualify. */
export function qualifyComponentContextLoaderContext(digest: BodyDigest) {
  const contexts = [
    ["original-reviewed-loader", manifest.legacyContext],
    ["complete-composed-vite-loader", manifest.composedContext],
  ] as const;
  for (const [authority, pairs] of contexts) {
    if (
      pairs.every(
        ([file, before, after]) =>
          typeof file === "string" &&
          digest("before", file) === before &&
          digest("after", file) === after,
      )
    )
      return {
        authority,
        manifestSHA256,
        parentSource: manifest.parentSource,
        composedSource: manifest.composedSource,
        completeBodyPairs: pairs,
      };
  }
  return null;
}
