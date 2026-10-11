import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import raw from "./warm-type-backed-owned-completion-host.json" with { type: "json" };

type Digest = (side: "before" | "after", file: string) => string | null;
type Body = [file: string, originalBefore: string | null, predecessor: string, successor: string];
type Extension = [file: string, absent: null, successor: string];
export const ownedCompletionManifest = raw as Omit<typeof raw, "helperBodies" | "extensions"> & {
  helperBodies: Body[];
  extensions: Extension[];
};
export const ownedCompletionManifestSHA256 = createHash("sha256")
  .update(JSON.stringify(ownedCompletionManifest))
  .digest("hex");
assert.equal(
  ownedCompletionManifestSHA256,
  "7280e8c07888a234477bae5f896d091e2ff988d44f2875040a0d7cda0ab1938b",
);
assert.equal(ownedCompletionManifest.version, 1);
assert.equal(ownedCompletionManifest.predecessorSource, "48c6f9035e9852c617e7b2eba145490b75ca0824");
assert.deepEqual(
  ownedCompletionManifest.helperBodies.map(([file]) => file),
  [
    "tests/performance/support/warm-type-backed-owner-migration.ts",
    "tests/performance/support/warm-type-backed-requests.ts",
  ],
);
const bodies = new Map(ownedCompletionManifest.helperBodies.map((row) => [row[0], row]));
assert.equal(
  new Set(ownedCompletionManifest.extensions.map(([file]) => file)).size,
  ownedCompletionManifest.extensions.length,
);
for (const [, before, predecessor, after] of bodies.values()) {
  if (before !== null) assert.match(before, /^[a-f0-9]{64}$/u);
  assert.match(predecessor, /^[a-f0-9]{64}$/u);
  assert.match(after, /^[a-f0-9]{64}$/u);
  assert.notEqual(predecessor, after);
}

/** Authenticate both complete helper successors and every named witness before the original authority. */
export function qualifyOwnedCompletionHost<T extends { files: readonly string[] }>(
  production: string[],
  alreadyQualified: ReadonlySet<string>,
  digest: Digest,
  qualifyOriginal: (production: string[], owned: ReadonlySet<string>, digest: Digest) => T | null,
  scope: "parent-pair" | "inherited" = "parent-pair",
) {
  const historical = qualifyOriginal(production, alreadyQualified, digest);
  if (historical) return historical;
  if (scope !== "parent-pair" && scope !== "inherited") return null;
  for (const [file, before, , after] of bodies.values())
    if (
      digest("before", file) !== (scope === "inherited" ? after : before) ||
      digest("after", file) !== after
    )
      return null;
  for (const [file, absent, after] of ownedCompletionManifest.extensions)
    if (
      digest("before", file) !== (scope === "inherited" ? after : absent) ||
      digest("after", file) !== after
    )
      return null;
  const original = qualifyOriginal(production, alreadyQualified, (side, file) => {
    const body = bodies.get(file);
    return body && (side === "after" || scope === "inherited") ? body[2] : digest(side, file);
  });
  if (!original) return null;
  return {
    ...original,
    ownedCompletionContext: {
      authority: "complete-two-packet-independent-owner-successor",
      manifestSHA256: ownedCompletionManifestSHA256,
      fixtureManifestSHA256: ownedCompletionManifest.fixtureManifestSHA256,
      predecessorSource: ownedCompletionManifest.predecessorSource,
      completeHelperBodies: ownedCompletionManifest.helperBodies,
      completeExtensions: ownedCompletionManifest.extensions,
      originalPackets: 79,
      unchangedPackets: 77,
      comparedFields: 20,
      scope,
    },
  };
}
