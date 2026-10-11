import assert from "node:assert/strict";
import { test } from "node:test";
import {
  configReviewManifest as review,
  qualifyConfigReviewHost,
} from "../performance/support/warm-type-backed-config-review-host.ts";
import { qualifyComponentIssuedHost } from "../performance/support/warm-type-backed-component-issued-host.ts";
import { componentIssuedSourcePair } from "./support/component-issued-source.ts";

type Digest = (side: "before" | "after", file: string) => string | null;
const reviewed = new Map(
  [...review.productionBodies, ...review.harnessBodies].map((row) => [row[0], row]),
);

for (const composed of [false, true]) {
  const pair = componentIssuedSourcePair(composed);
  const production = composed
    ? [...new Set([...pair.production, ...review.reviewedProductionFiles])].toSorted()
    : pair.production;
  const scope = composed ? "parent-pair" : "inherited";
  const digest: Digest = (side, file) =>
    side === "before" && reviewed.has(file)
      ? reviewed.get(file)![composed ? 1 : 3]
      : pair.actual(side, file);
  const qualify = (current = digest, files = production, allowed = new Set<string>()) =>
    qualifyConfigReviewHost(files, allowed, current, qualifyComponentIssuedHost, scope);

  await test(`${scope} reviewed component qualification retains the complete original witness and actual source footprint`, () => {
    assert.equal(qualifyComponentIssuedHost(production, new Set(), digest), null);
    const result = qualify();
    assert.ok(result);
    assert.deepEqual(result.files, production);
    assert.deepEqual(result.originalQualification.files, pair.production);
    assert.equal(result.files.length, composed ? 135 : 28);
    assert.equal(result.originalQualification.files.length, composed ? 119 : 28);
    assert.equal(result.inheritedProductionBodies, 90);
    assert.equal(result.inheritedCustodyBodies, 51);
    assert.equal(result.inheritedHarnessExtensions, 3);
    assert.equal(result.completeComponentBodies, 28);
    assert.equal(result.issuedCompletionContext.completeBodyPairs, 7);
    assert.equal(result.originalPackets, 79);
    assert.equal(result.supplementalResolves, 8);
    assert.equal(result.supplementalRefusals, 8);
    assert.equal(result.originalComparedFields, 20);
  });

  await test(`${scope} reviewed component qualification refuses context drift, child drift and forged extra ownership`, () => {
    for (const file of new Set([...reviewed.keys(), ...pair.bodies.keys()]))
      for (const side of ["before", "after"] as const) {
        const replacement = digest(side, file) === null ? "f".repeat(64) : null;
        // Original after-only metadata has no declared before-side obligation.
        if (side === "before" && pair.afterOnly.has(file)) continue;
        assert.equal(
          qualify((candidate, path) =>
            candidate === side && path === file ? replacement : digest(candidate, path),
          ),
          null,
          `${side}:${file}`,
        );
      }
    for (const file of production) {
      assert.equal(
        qualify(
          digest,
          production.filter((path) => path !== file),
        ),
        null,
        file,
      );
      assert.equal(qualify(digest, [...production, file]), null, file);
    }
    const foreign = "crates/vize_canon/unreviewed-component-owner.rs";
    assert.equal(qualify(digest, [...production, foreign], new Set([foreign])), null);
    if (!composed)
      for (const file of review.reviewedProductionFiles)
        assert.equal(qualify(digest, [...production, file], new Set([file])), null, file);
  });
}
