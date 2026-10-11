import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import raw from "./warm-type-backed-config-unit-test-fixture-host.json" with { type: "json" };
import original from "./warm-type-backed-config-result-fixture-host.json" with { type: "json" };

type Digest = (side: "before" | "after", file: string) => string | null;
type Scope = "parent-pair" | "inherited";
type Body = [file: string, originalBefore: null, predecessor: string, successor: string];
export const configUnitTestFixtureManifest = raw as Omit<
  typeof raw,
  "productionBodies" | "harnessBodies"
> & { productionBodies: Body[]; harnessBodies: Body[] };
for (const row of [
  ...configUnitTestFixtureManifest.productionBodies,
  ...configUnitTestFixtureManifest.harnessBodies,
])
  Object.freeze(row);
Object.freeze(configUnitTestFixtureManifest.productionBodies);
Object.freeze(configUnitTestFixtureManifest.harnessBodies);
Object.freeze(configUnitTestFixtureManifest);
export const configUnitTestFixtureManifestSHA256 = createHash("sha256")
  .update(JSON.stringify(configUnitTestFixtureManifest))
  .digest("hex");
assert.equal(
  configUnitTestFixtureManifestSHA256,
  "0f2e71d4e056171c520ee9bebe3c43e373795043d4673d14d3f4526c85bbe200",
);
assert.equal(configUnitTestFixtureManifest.version, 1);
assert.equal(
  configUnitTestFixtureManifest.originalResultManifestSHA256,
  createHash("sha256").update(JSON.stringify(original)).digest("hex"),
);
assert.equal(configUnitTestFixtureManifest.productionBodies.length, 1);
assert.equal(configUnitTestFixtureManifest.harnessBodies.length, 1);
const rows = [
  ...configUnitTestFixtureManifest.productionBodies,
  ...configUnitTestFixtureManifest.harnessBodies,
];
for (const [index, [file, absent, predecessor, successor]] of rows.entries()) {
  const previous = [...original.productionBodies, ...original.harnessBodies][index];
  assert.deepEqual([file, absent, predecessor], [previous[0], previous[1], previous[3]]);
  assert.match(successor, /^[a-f0-9]{64}$/u);
  assert.notEqual(predecessor, successor);
}

/** Close the two complete unit-entry bodies before invoking the frozen Result authority. */
export function qualifyConfigUnitTestFixtureHost<T extends { files: readonly string[] }>(
  production: string[],
  alreadyQualified: ReadonlySet<string>,
  digest: Digest,
  qualifyOriginal: (files: string[], owned: ReadonlySet<string>, actual: Digest) => T | null,
  scope: Scope,
) {
  if (scope !== "parent-pair" && scope !== "inherited") return null;
  const containsUnitEntryBody = rows.some(
    ([file, , , after]) => digest("before", file) === after || digest("after", file) === after,
  );
  // Preserve the complete original historical authorities without granting this
  // successor context. Either current body forbids their historical fast path.
  if (!containsUnitEntryBody) return qualifyOriginal(production, alreadyQualified, digest);
  for (const [file, before, , after] of rows)
    if (
      digest("before", file) !== (scope === "inherited" ? after : before) ||
      digest("after", file) !== after
    )
      return null;
  const pairs = new Map(rows.map(([file, , predecessor]) => [file, predecessor]));
  const witness = qualifyOriginal(production, alreadyQualified, (side, file) =>
    pairs.has(file) && (side === "after" || scope === "inherited")
      ? pairs.get(file)!
      : digest(side, file),
  );
  if (!witness) return null;
  return {
    ...witness,
    configUnitTestFixtureContext: {
      authority: "complete-navigation-unit-test-entry-successor",
      manifestSHA256: configUnitTestFixtureManifestSHA256,
      predecessorSource: configUnitTestFixtureManifest.predecessorSource,
      fixtureSource: configUnitTestFixtureManifest.fixtureSource,
      completeProductionBodyPairs: configUnitTestFixtureManifest.productionBodies,
      completeHarnessBodyPairs: configUnitTestFixtureManifest.harnessBodies,
      scope,
    },
  };
}
