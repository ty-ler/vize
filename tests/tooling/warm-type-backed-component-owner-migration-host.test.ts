import assert from "node:assert/strict";
import { test } from "node:test";
import { qualifyComponentContextHost } from "../performance/support/warm-type-backed-component-context-host.ts";
import { qualifyComponentOwnerMigrationHost } from "../performance/support/warm-type-backed-component-owner-migration-host.ts";
import { capturesOwners } from "../performance/support/warm-type-backed-owner-migration.ts";
import successor from "../performance/support/warm-type-backed-component-owner-migration-manifest.json" with { type: "json" };
import loader from "../performance/support/warm-type-backed-project-config-loader-manifest.json" with { type: "json" };
import { qualifyCurrentComponentIssuedSource } from "./support/component-issued-source.ts";
import { componentOwnerSourcePair } from "./support/component-owner-migration-source.ts";

for (const composed of [false, true]) {
  const scope = composed ? "complete113" : "parent-relative28";
  const pair = componentOwnerSourcePair(composed);
  const qualify = (digest = pair.digest, production = pair.production) =>
    qualifyComponentOwnerMigrationHost(production, new Set(), digest);

  await test(`${scope} admits only the distinct whole successor and retains every original authority`, () => {
    assert.equal(qualifyComponentContextHost(pair.production, new Set(), pair.digest), null);
    const result = qualify();
    assert.ok(result);
    assert.equal(result.completeComponentBodies, 28);
    assert.equal(result.inheritedProductionBodies, 90);
    assert.equal(result.inheritedCustodyBodies, 51);
    assert.equal(result.inheritedHarnessExtensions, 3);
    assert.equal(result.originalComponentBodies, 4);
    assert.equal(result.originalPackets, 79);
    assert.equal(result.supplementalResolves + result.supplementalRefusals, 16);
    assert.equal(result.originalComparedFields, 20);
    assert.ok(qualify(pair.actual) ?? qualifyCurrentComponentIssuedSource(composed));
  });

  await test(`${scope} refuses every omitted, duplicate or foreign production owner`, () => {
    for (const file of pair.production) {
      assert.equal(
        qualify(
          pair.digest,
          pair.production.filter((path) => path !== file),
        ),
        null,
      );
      assert.equal(qualify(pair.digest, [...pair.production, file]), null);
    }
    assert.equal(qualify(pair.digest, []), null);
    assert.equal(qualify(pair.digest, [...pair.production, "crates/vize/src/foreign.rs"]), null);
    const foreign = "crates/vize/src/foreign.rs";
    const claimed = new Set([foreign]);
    const extra = [...pair.production, foreign];
    assert.equal(qualifyComponentOwnerMigrationHost(extra, claimed, pair.digest), null);
    assert.equal(
      qualifyComponentContextHost(extra, claimed, pair.digest) ??
        qualifyComponentOwnerMigrationHost(extra, claimed, pair.digest),
      null,
      "the actual selector union cannot inherit an unrelated extra production owner",
    );
  });

  await test(`${scope} refuses null or drift of every complete source/custody/corpus/loader body`, () => {
    for (const file of pair.bodies.keys())
      for (const side of ["before", "after"] as const)
        for (const replacement of [null, "f".repeat(64)]) {
          if (side === "before" && pair.afterOnly.has(file)) continue;
          if (replacement === pair.digest(side, file)) continue;
          assert.equal(
            qualify((candidate, path) =>
              candidate === side && path === file ? replacement : pair.digest(candidate, path),
            ),
            null,
            `${side}:${file}`,
          );
        }
  });

  await test(`${scope} refuses a missing OR body, old null helper or mixed predecessor mode`, () => {
    for (const [file, before] of successor.harnessSuccessors)
      assert.equal(
        qualify((side, path) =>
          side === "after" && path === file ? before : pair.digest(side, path),
        ),
        null,
        file,
      );
    const other = componentOwnerSourcePair(!composed);
    for (const [file] of successor.harnessSuccessors)
      if (other.digest("before", file) !== pair.digest("before", file))
        assert.equal(
          qualify((side, path) =>
            side === "before" && path === file ? other.digest(side, path) : pair.digest(side, path),
          ),
          null,
          file,
        );
  });

  await test(`${scope} refuses mixed loader halves even with every successor body present`, () => {
    const legacy = new Map(loader.legacyContext.map(([file, before]) => [file, before]));
    assert.equal(
      qualify((side, file) =>
        side === "before" && legacy.has(file) ? legacy.get(file)! : pair.digest(side, file),
      ),
      null,
    );
  });
}

await test("the actual shared owner predicate admits component-only, project-only, both and neither", () => {
  assert.equal(capturesOwners({ componentContextHost: { qualified: true } }), true);
  assert.equal(capturesOwners({ projectConfigHost: { qualified: true } }), true);
  assert.equal(capturesOwners({ projectConfigHost: false, componentContextHost: {} }), true);
  assert.equal(capturesOwners({ projectConfigHost: {}, componentContextHost: {} }), true);
  assert.equal(capturesOwners({ projectConfigHost: null, componentContextHost: null }), false);
  assert.equal(capturesOwners({}), false);
});
