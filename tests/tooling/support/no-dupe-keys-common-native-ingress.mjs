import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  authenticateNoDupeCommonJoinCommitted,
  authenticateNoDupeCommonJoinParentFrame,
} from "./no-dupe-keys-common-main-source-custody.mjs";

const parentSource = "3783850eeb9d12f52c76108853f514a3999dfb76";

/** Authenticate the complete actual child before using the parent as source lineage. */
export async function currentNoDupeDeepPropsNativeIngress(root) {
  const current = authenticateNoDupeCommonJoinCommitted(root);
  assert.equal(current.sourceOnly, true);
  assert(current.currentBodies instanceof Map);
  const historical = authenticateNoDupeCommonJoinParentFrame(root);
  assert.equal(historical.sourceOnly, true);
  assert.equal(historical.source, parentSource);
  const parent = await import(
    pathToFileURL(
      path.join(historical.root, "tests/tooling/support/no-mutating-component-join-native.mjs"),
    ).href
  );
  const inherited = await parent.currentJoinDeepPropsNativeSource(historical.root);
  assert.equal(inherited.receipt.sourceRevision, parentSource);
  assert.equal(inherited.deepPropsFamily.sourceOnly, true);
  assert.equal(inherited.deepPropsFamily.compiled, false);
  assert.equal(inherited.deepPropsFamily.native, false);
  assert.equal(inherited.deepPropsFamily.performance, false);
  const requalified = authenticateNoDupeCommonJoinCommitted(root);
  assert.equal(requalified.currentHead, current.currentHead);
  return {
    deepPropsFamily: inherited.deepPropsFamily,
    receipt: {
      authority: "complete-current-no-dupe-keys-common-source-join",
      sourceRevision: current.currentHead,
      completeCurrentClosedBodies: current.currentBodies.size,
      historicalParentSource: parentSource,
      historicalSourceReceipt: inherited.receipt,
      runtimeCredit: false,
      performanceCredit: false,
      acceptanceCredit: "none",
    },
    assertBuildSource(expectedRevision) {
      const fresh = authenticateNoDupeCommonJoinCommitted(root);
      assert.equal(fresh.currentHead, current.currentHead);
      assert.equal(
        expectedRevision,
        current.currentHead,
        "actual native build must use the complete current child source",
      );
    },
  };
}
