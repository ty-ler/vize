import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import raw from "./warm-type-backed-component-owned-completion-host.json" with { type: "json" };
import {
  ownedCompletionManifest,
  ownedCompletionManifestSHA256,
  qualifyOwnedCompletionHost,
} from "./warm-type-backed-owned-completion-host.ts";
import { qualifyConfigRepairedReviewHost } from "./warm-type-backed-config-repair-host.ts";
import { qualifyComponentIssuedHost } from "./warm-type-backed-component-issued-host.ts";

type Digest = (side: "before" | "after", file: string) => string | null;
export type ComponentOwnedScope = "parent-pair" | "inherited";
type Body = [
  file: string,
  composedBefore: string | null,
  nativeParent: string,
  componentHistorical: string,
  successor: string,
];
type TestBody = [
  file: string,
  composedBefore: string | null,
  nativeBefore: string,
  successor: string,
];
type Extension = [file: string, absent: null, successor: string];
export const componentOwnedManifest = raw as Omit<
  typeof raw,
  "helperBodies" | "integrationBodies" | "extensions"
> & {
  helperBodies: Body[];
  integrationBodies: Body[];
  extensions: Extension[];
  testBodies: TestBody[];
};
export const componentOwnedManifestSHA256 = createHash("sha256")
  .update(JSON.stringify(raw))
  .digest("hex");
assert.equal(
  componentOwnedManifestSHA256,
  "f72d08d2661608978afc6f05c4f82e2fa1eda12ede4f4391e613432ff693d10b",
);
assert.equal(raw.nativeManifestSHA256, ownedCompletionManifestSHA256);
assert.equal(raw.fixtureManifestSHA256, ownedCompletionManifest.fixtureManifestSHA256);
assert.equal(raw.version, 1);
assert.deepEqual(
  raw.helperBodies.map(([file]) => file),
  ownedCompletionManifest.helperBodies.map(([file]) => file),
);
const bodies = new Map(
  [...componentOwnedManifest.helperBodies, ...componentOwnedManifest.integrationBodies].map(
    (row) => [row[0], row],
  ),
);
assert.equal(bodies.size, 3);
assert.equal(new Set(raw.extensions.map(([file]) => file)).size, raw.extensions.length);
for (const row of bodies.values()) {
  if (row[1] !== null) assert.match(row[1], /^[a-f0-9]{64}$/u);
  for (const value of row.slice(2)) assert.match(value as string, /^[a-f0-9]{64}$/u);
  Object.freeze(row);
}
Object.freeze(componentOwnedManifest.helperBodies);
Object.freeze(componentOwnedManifest.integrationBodies);
for (const row of componentOwnedManifest.extensions) Object.freeze(row);
Object.freeze(componentOwnedManifest.extensions);
for (const row of componentOwnedManifest.testBodies) Object.freeze(row);
Object.freeze(componentOwnedManifest.testBodies);
Object.freeze(componentOwnedManifest);

/** This projection is used only at the final, still complete historical component predicate. */
export function componentHistoricalDigest(digest: Digest): Digest {
  return (side, file) =>
    side === "after" && bodies.has(file) ? bodies.get(file)![3] : digest(side, file);
}

/** Close both actual source sides before native qualification and its complete component predecessor. */
export function qualifyComponentOwnedCompletionHost<T extends { files: readonly string[] }>(
  production: string[],
  owned: ReadonlySet<string>,
  digest: Digest,
  predecessor: (production: string[], owned: ReadonlySet<string>, digest: Digest) => T | null,
  scope: ComponentOwnedScope,
) {
  if (scope !== "parent-pair" && scope !== "inherited") return null;
  for (const [file, original, native, , after] of bodies.values())
    if (
      digest("before", file) !== (scope === "inherited" ? native : original) ||
      digest("after", file) !== after
    )
      return null;
  for (const [file, absent, after] of componentOwnedManifest.extensions)
    if (digest("before", file) !== absent || digest("after", file) !== after) return null;
  for (const [file, original, native, after] of componentOwnedManifest.testBodies)
    if (
      digest("before", file) !== (scope === "inherited" ? native : original) ||
      digest("after", file) !== after
    )
      return null;
  const nativeView: Digest = (side, file) =>
    side === "after" && bodies.has(file) ? bodies.get(file)![2] : digest(side, file);
  const result = qualifyOwnedCompletionHost(
    production,
    owned,
    nativeView,
    (files, qualified, authenticated) => {
      // A historical callback cannot succeed on the unqualified native-successor view.
      for (const [file, , nativePredecessor] of ownedCompletionManifest.helperBodies)
        if (
          authenticated("after", file) !== nativePredecessor ||
          (scope === "inherited" && authenticated("before", file) !== nativePredecessor)
        )
          return null;
      return predecessor(files, qualified, authenticated);
    },
    scope,
  );
  if (!result || !("ownedCompletionContext" in result)) return null;
  return {
    ...result,
    componentOwnedCompletionContext: {
      manifestSHA256: componentOwnedManifestSHA256,
      nativeManifestSHA256: ownedCompletionManifestSHA256,
      fixtureManifestSHA256: componentOwnedManifest.fixtureManifestSHA256,
      completeHelperBodies: componentOwnedManifest.helperBodies,
      completeIntegrationBodies: componentOwnedManifest.integrationBodies,
      completeExtensions: componentOwnedManifest.extensions,
      originalPackets: 79,
      unchangedPackets: 77,
      comparedFields: 20,
      scope,
    },
  };
}

export function qualifyComponentCompleteOwnedHost(
  production: string[],
  owned: ReadonlySet<string>,
  digest: Digest,
  scope: ComponentOwnedScope,
) {
  return qualifyComponentOwnedCompletionHost(
    production,
    owned,
    digest,
    (files, qualified, authenticated) =>
      qualifyConfigRepairedReviewHost(
        files,
        qualified,
        authenticated,
        (selected, already, historical) =>
          qualifyComponentIssuedHost(selected, already, componentHistoricalDigest(historical)),
        scope,
      ),
    scope,
  );
}
