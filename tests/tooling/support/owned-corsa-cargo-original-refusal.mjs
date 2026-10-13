import assert from "node:assert/strict";
import test from "node:test";

export async function runOwnedCargoOriginalRefusal({ actualView, copied, old, manifest }) {
await test("actual owned Cargo tuple separately refuses the original helper before historical caller qualification", () => {
  const expectedLock = actualView.historicalCopied.find(({ file }) => file === "Cargo.lock").sha256;
  const actualLock = copied.find(({ file }) => file === "Cargo.lock").sha256;
  let refusal;
  try {
    assert.equal(actualLock, expectedLock, "Cargo.lock");
  } catch (error) {
    refusal = error;
  }
  assert.throws(() => old.validateLexicalSourceBodies(manifest, copied), {
    name: refusal.name,
    code: refusal.code,
    message: refusal.message,
    actual: refusal.actual,
    expected: refusal.expected,
    operator: refusal.operator,
    generatedMessage: refusal.generatedMessage,
  });
});

}
