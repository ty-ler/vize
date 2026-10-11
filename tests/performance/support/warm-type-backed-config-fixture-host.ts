import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import raw from "./warm-type-backed-config-fixture-host.json" with { type: "json" };
import original from "./warm-type-backed-config-repair-host.json" with { type: "json" };
import { qualifyConfigResultFixtureHost } from "./warm-type-backed-config-result-fixture-host.ts";

type Digest = (side: "before" | "after", file: string) => string | null;
type Scope = "parent-pair" | "inherited";
type Row = [file: string, originalBefore: null, predecessor: string, repaired: string];
export const configFixtureManifest = raw as Omit<typeof raw, "productionBodies"> & {
  productionBodies: Row[];
};
for (const row of configFixtureManifest.productionBodies) Object.freeze(row);
Object.freeze(configFixtureManifest.productionBodies);
Object.freeze(configFixtureManifest);
export const configFixtureManifestSHA256 = createHash("sha256")
  .update(JSON.stringify(configFixtureManifest))
  .digest("hex");
assert.equal(
  configFixtureManifestSHA256,
  "62dfcd2b4845cefa2132e65dff26bc78a87e8b229cf8136dd7a756c1e84f46d5",
);
assert.equal(configFixtureManifest.version, 1);
assert.equal(
  configFixtureManifest.originalRepairManifestSHA256,
  createHash("sha256").update(JSON.stringify(original)).digest("hex"),
);
assert.equal(configFixtureManifest.productionBodies.length, 1);
const [file, before, predecessor, repaired] = configFixtureManifest.productionBodies[0];
assert.equal(file, "crates/vize_maestro/src/server/project_contexts/tests.rs");
const previous = original.productionBodies.find(([name]) => name === file);
assert.ok(previous);
assert.deepEqual([before, predecessor], [previous[1], previous[3]]);
assert.match(repaired, /^[a-f0-9]{64}$/u);
assert.notEqual(repaired, predecessor);

/** One complete test-only successor still requires every original source witness. */
export function qualifyConfigFixtureHost<T extends { files: readonly string[] }>(
  production: string[],
  alreadyQualified: ReadonlySet<string>,
  digest: Digest,
  qualifyOriginal: (
    production: string[],
    alreadyQualified: ReadonlySet<string>,
    digest: Digest,
  ) => T | null,
  scope: Scope,
) {
  return qualifyConfigResultFixtureHost(
    production,
    alreadyQualified,
    digest,
    (files, owned, actual) =>
      qualifyConfigFixtureContext(files, owned, actual, qualifyOriginal, scope),
    scope,
  );
}

function qualifyConfigFixtureContext<T extends { files: readonly string[] }>(
  production: string[],
  alreadyQualified: ReadonlySet<string>,
  digest: Digest,
  qualifyOriginal: (
    production: string[],
    alreadyQualified: ReadonlySet<string>,
    digest: Digest,
  ) => T | null,
  scope: Scope,
) {
  const historical = qualifyOriginal(production, alreadyQualified, digest);
  if (historical) return historical;
  if (
    digest("before", file) !== (scope === "inherited" ? repaired : before) ||
    digest("after", file) !== repaired
  )
    return null;
  const witness = qualifyOriginal(production, alreadyQualified, (side, name) =>
    name === file
      ? side === "before" && scope === "parent-pair"
        ? before
        : predecessor
      : digest(side, name),
  );
  if (!witness) return null;
  return {
    ...witness,
    configFixtureContext: {
      authority: "complete-strict-navigation-fixture-extraction",
      manifestSHA256: configFixtureManifestSHA256,
      predecessorSource: configFixtureManifest.predecessorSource,
      repairedSource: configFixtureManifest.repairedSource,
      completeProductionBodyPairs: configFixtureManifest.productionBodies,
      scope,
    },
  };
}
