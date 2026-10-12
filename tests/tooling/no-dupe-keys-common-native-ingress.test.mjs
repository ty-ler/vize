import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";
import {
  authenticateNoDupeCommonJoinCommitted,
  authenticateNoDupeCommonJoinParentFrame,
} from "./support/no-dupe-keys-common-main-source-custody.mjs";
import { currentJoinDeepPropsNativeSource } from "./support/no-mutating-component-join-native.mjs";

const root = path.resolve(import.meta.dirname, "../..");

void test("native source ingress retains full parent lineage and requires the actual child build revision", async () => {
  const current = authenticateNoDupeCommonJoinCommitted(root);
  const historical = authenticateNoDupeCommonJoinParentFrame(root);
  const original = await import(
    pathToFileURL(
      path.join(historical.root, "tests/tooling/support/no-mutating-component-join-native.mjs"),
    ).href
  );
  const before = await original.currentJoinDeepPropsNativeSource(historical.root);
  const after = await currentJoinDeepPropsNativeSource(root);
  assert.deepEqual(after.deepPropsFamily, before.deepPropsFamily);
  assert.deepEqual(after.receipt.historicalSourceReceipt, before.receipt);
  assert.equal(after.receipt.sourceRevision, current.currentHead);
  assert.equal(after.receipt.historicalParentSource, historical.source);
  assert.equal(after.receipt.completeCurrentClosedBodies, current.currentBodies.size);
  assert.equal(after.receipt.runtimeCredit, false);
  assert.equal(after.receipt.performanceCredit, false);
  assert.equal(after.receipt.acceptanceCredit, "none");
  after.assertBuildSource(current.currentHead);
  for (const wrong of [
    historical.source,
    "775ec35cc4b4c32f52f6b758f021e16d5af6a5b8",
    "0".repeat(40),
    "partial-source",
    null,
    undefined,
  ]) {
    assert.throws(() => after.assertBuildSource(wrong));
  }
});
