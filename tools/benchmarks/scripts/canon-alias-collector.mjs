/** Independently pinned resolver diagnostics and CLI membership contracts. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export const successorUrl = new URL(
  "../../../tests/_fixtures/differential/typecheck/selected-alias-collector-3984/collector-membership-successor.json",
  import.meta.url,
);
export const successorBytes = readFileSync(successorUrl);
export const successorSha256 = createHash("sha256").update(successorBytes).digest("hex");
export const successor = JSON.parse(successorBytes);
assert.deepEqual(Object.keys(successor.resolverSources), ["historical", "selected"]);
assert.deepEqual(Object.keys(successor.collectorSources), ["historical", "selected"]);
const originalBytes = readFileSync(
  new URL(
    "../../../tests/_fixtures/differential/typecheck/path-alias-precedence-3984/cases.json",
    import.meta.url,
  ),
);
assert.equal(
  createHash("sha256").update(originalBytes).digest("hex"),
  successor.originalCasesSha256,
);
const originalCases = JSON.parse(originalBytes).cases;
assert.deepEqual(
  successor.cases.map(({ id }) => id),
  originalCases.map(({ id }) => id),
);
assert.equal(
  createHash("sha256")
    .update(readFileSync(new URL("historical-eight-case.tar.gz", successorUrl)))
    .digest("hex"),
  successor.originalArchiveSha256,
);
const changed = new Set(["selected-exact-missing", "selected-longer-wildcard-missing"]);
for (const [index, item] of originalCases.entries()) {
  assert.deepEqual(
    successor.cases[index].files,
    changed.has(item.id) ? ["App.tsx"] : item.cliFiles,
  );
}

function mode(sources, sha256, label) {
  const matches = Object.entries(sources).filter(([, source]) => source === sha256);
  assert.equal(matches.length, 1, `Unknown ${label} source; no implicit qualification`);
  return matches[0][0];
}

export function sourceContract(resolverSha256, collectorSha256, side) {
  assert(["base", "head"].includes(side), "Unknown source side");
  const resolverMode = mode(successor.resolverSources, resolverSha256, "Canon resolver");
  const collectorMode = mode(successor.collectorSources, collectorSha256, "CLI collector");
  if (side === "head") {
    assert.equal(resolverMode, "selected", "Head must satisfy selected resolver semantics");
    assert.equal(collectorMode, "selected", "Head must satisfy selected CLI membership");
  }
  return { side, resolverSha256, collectorSha256, resolverMode, collectorMode };
}

export function expectedFiles(item, contract) {
  assert.deepEqual(
    contract,
    sourceContract(contract.resolverSha256, contract.collectorSha256, contract.side),
    "Membership must consume a complete source-bound contract",
  );
  const matched = originalCases.find(({ id }) => id === item.id);
  assert.deepEqual(item, matched, "The entire original case must remain unchanged");
  assert(["historical", "selected"].includes(contract.collectorMode));
  return contract.collectorMode === "historical"
    ? matched.cliFiles
    : successor.cases.find(({ id }) => id === item.id).files;
}

// Pending only in the original full eight-case producer; the ledger above stays exact.
export const reviewedResolver = Object.freeze({
  resolverSha256: "c6fd563657ff482e17deeb6a32a5c23f58d2c46216e875db9e95e02d7354d857",
  candidatesSha256: "74e808bfccea1d5427baf35acef0b2946e565af483ede8ffc0a255a461950013",
});

export function pendingSourceContract(resolverSha256, candidatesSha256, collectorSha256, side) {
  if (resolverSha256 !== reviewedResolver.resolverSha256)
    return sourceContract(resolverSha256, collectorSha256, side);
  assert.equal(candidatesSha256, reviewedResolver.candidatesSha256, "Unknown Canon resolver pair");
  const reference = sourceContract(successor.resolverSources.selected, collectorSha256, side);
  return { ...reference, resolverSha256 };
}

export function qualificationReference(contract) {
  const reference = sourceContract(
    contract.resolverSha256 === reviewedResolver.resolverSha256
      ? successor.resolverSources.selected
      : contract.resolverSha256,
    contract.collectorSha256,
    contract.side,
  );
  assert.deepEqual(contract, { ...reference, resolverSha256: contract.resolverSha256 });
  return reference;
}
