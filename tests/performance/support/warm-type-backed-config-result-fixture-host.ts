import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import raw from "./warm-type-backed-config-result-fixture-host.json" with { type: "json" };
import original from "./warm-type-backed-config-fixture-host.json" with { type: "json" };

type Digest = (side: "before" | "after", file: string) => string | null;
type Scope = "parent-pair" | "inherited";
type Body = [file: string, originalBefore: null, predecessor: string, successor: string];
export const configResultFixtureManifest = raw as Omit<
  typeof raw,
  "productionBodies" | "harnessBodies"
> & { productionBodies: Body[]; harnessBodies: Body[] };
for (const row of [
  ...configResultFixtureManifest.productionBodies,
  ...configResultFixtureManifest.harnessBodies,
])
  Object.freeze(row);
Object.freeze(configResultFixtureManifest.productionBodies);
Object.freeze(configResultFixtureManifest.harnessBodies);
Object.freeze(configResultFixtureManifest);
export const configResultFixtureManifestSHA256 = createHash("sha256")
  .update(JSON.stringify(configResultFixtureManifest))
  .digest("hex");
assert.equal(
  configResultFixtureManifestSHA256,
  "92e269db5823d79ea30899889125053310001b13b4ef6f988ddc895f28241d48",
);
assert.equal(configResultFixtureManifest.version, 1);
assert.equal(
  configResultFixtureManifest.originalFixtureManifestSHA256,
  createHash("sha256").update(JSON.stringify(original)).digest("hex"),
);
assert.equal(configResultFixtureManifest.productionBodies.length, 1);
assert.equal(configResultFixtureManifest.harnessBodies.length, 1);
const [file, absent, predecessor] = configResultFixtureManifest.productionBodies[0];
assert.deepEqual(
  [file, absent, predecessor],
  [
    original.productionBodies[0][0],
    original.productionBodies[0][1],
    original.productionBodies[0][3],
  ],
);
assert.equal(
  configResultFixtureManifest.harnessBodies[0][0],
  "tests/performance/support/warm-type-backed-config-fixture-host.ts",
);
for (const [, before, previous, after] of [
  ...configResultFixtureManifest.productionBodies,
  ...configResultFixtureManifest.harnessBodies,
]) {
  assert.equal(before, null);
  assert.match(previous, /^[a-f0-9]{64}$/u);
  assert.match(after, /^[a-f0-9]{64}$/u);
  assert.notEqual(previous, after);
}

/** Bind the one fallible fixture and its exact caller before reusing the frozen authority. */
export function qualifyConfigResultFixtureHost<T extends { files: readonly string[] }>(
  production: string[],
  alreadyQualified: ReadonlySet<string>,
  digest: Digest,
  qualifyOriginal: (files: string[], owned: ReadonlySet<string>, actual: Digest) => T | null,
  scope: Scope,
) {
  if (scope !== "parent-pair" && scope !== "inherited") return null;
  const historical = qualifyOriginal(production, alreadyQualified, digest);
  if (historical) return historical;
  for (const [name, before, , after] of [
    ...configResultFixtureManifest.productionBodies,
    ...configResultFixtureManifest.harnessBodies,
  ])
    if (
      digest("before", name) !== (scope === "inherited" ? after : before) ||
      digest("after", name) !== after
    )
      return null;
  const witness = qualifyOriginal(production, alreadyQualified, (side, name) =>
    name === file && (side === "after" || scope === "inherited") ? predecessor : digest(side, name),
  );
  if (!witness) return null;
  return {
    ...witness,
    configResultFixtureContext: {
      authority: "complete-fallible-navigation-fixture-successor",
      manifestSHA256: configResultFixtureManifestSHA256,
      predecessorSource: configResultFixtureManifest.predecessorSource,
      fixtureSource: configResultFixtureManifest.fixtureSource,
      completeProductionBodyPairs: configResultFixtureManifest.productionBodies,
      completeHarnessBodyPairs: configResultFixtureManifest.harnessBodies,
      scope,
    },
  };
}
