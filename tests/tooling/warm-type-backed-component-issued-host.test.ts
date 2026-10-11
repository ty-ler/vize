import assert from "node:assert/strict";
import { test } from "node:test";
import {
  componentIssuedProduction,
  qualifyComponentIssuedHost,
} from "../performance/support/warm-type-backed-component-issued-host.ts";
import {
  issuedCompletionManifest as issued,
  qualifyIssuedCompletionHost,
} from "../performance/support/warm-type-backed-issued-completion-host.ts";
import { qualifyComponentOwnerMigrationHost } from "../performance/support/warm-type-backed-component-owner-migration-host.ts";
import {
  componentIssuedSourcePair,
  qualifyCurrentComponentIssuedSource,
} from "./support/component-issued-source.ts";
import { componentOwnerSourcePair } from "./support/component-owner-migration-source.ts";

for (const composed of [false, true]) {
  const scope = composed ? "complete119" : "parent-relative28";
  const pair = componentIssuedSourcePair(composed);
  const qualify = (digest = pair.digest, production = pair.production) =>
    qualifyComponentIssuedHost(production, new Set(), digest);

  await test(`${scope} binds every original authority and the actual complete issued-item producer`, () => {
    assert.equal(qualifyComponentOwnerMigrationHost(pair.production, new Set(), pair.digest), null);
    assert.equal(qualifyIssuedCompletionHost(pair.production, new Set(), pair.digest), null);
    const result = qualify();
    assert.ok(result);
    assert.equal(result.files.length, composed ? 119 : 28);
    assert.equal(result.completeComponentBodies, 28);
    assert.equal(result.inheritedProductionBodies, 90);
    assert.equal(result.inheritedCustodyBodies, 51);
    assert.equal(result.inheritedHarnessExtensions, 3);
    assert.equal(result.originalComponentBodies, 4);
    assert.equal(result.harnessSuccessors.length, 3);
    assert.equal(result.issuedCompletionContext.completeBodyPairs, 7);
    assert.equal(result.issuedCompletionContext.scope, composed ? "parent-pair" : "inherited");
    assert.equal(result.originalPackets, 79);
    assert.equal(result.supplementalResolves, 8);
    assert.equal(result.supplementalRefusals, 8);
    assert.equal(result.originalComparedFields, 20);
    const current = qualify(pair.actual) ?? qualifyCurrentComponentIssuedSource(composed);
    assert.ok(current);
    if ("configReviewContext" in current) {
      assert.equal(current.configReviewContext.scope, composed ? "parent-pair" : "inherited");
      assert.equal(current.files.length, composed ? 135 : 28);
      assert.equal(current.originalQualification.files.length, composed ? 119 : 28);
      assert.equal(current.configReviewContext.completeProductionBodyPairs.length, 27);
      assert.equal(current.configReviewContext.completeHarnessBodyPairs.length, 4);
    }
    if (composed) assert.deepEqual(pair.production, componentIssuedProduction);
  });

  await test(`${scope} requires every complete production/custody/corpus/loader/issued body`, () => {
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
            `${side}:${file}:${replacement}`,
          );
        }
  });

  await test(`${scope} refuses every missing, duplicate and foreign owner despite another claimed authority`, () => {
    for (const file of pair.production) {
      assert.equal(
        qualify(
          pair.digest,
          pair.production.filter((path) => path !== file),
        ),
        null,
        file,
      );
      assert.equal(qualify(pair.digest, [...pair.production, file]), null, file);
    }
    assert.equal(qualify(pair.digest, []), null);
    const extra = "crates/vize_canon/unissued-foreign.rs";
    assert.equal(
      qualifyComponentIssuedHost([...pair.production, extra], new Set([extra]), pair.digest),
      null,
    );
    const previous = componentOwnerSourcePair(composed);
    assert.equal(qualify(previous.digest, pair.production), null);
    if (composed) assert.equal(qualify(pair.digest, previous.production), null);
  });

  await test(`${scope} refuses each predecessor and mixed or missing native issued context`, () => {
    const other = componentIssuedSourcePair(!composed);
    for (const [file, , predecessor] of issued.producerBodies) {
      assert.equal(
        qualify((side, path) =>
          side === "after" && path === file ? predecessor : pair.digest(side, path),
        ),
        null,
        file,
      );
      if (other.digest("before", file) !== pair.digest("before", file))
        assert.equal(
          qualify((side, path) =>
            side === "before" && path === file ? other.digest(side, path) : pair.digest(side, path),
          ),
          null,
          file,
        );
    }
  });
}
