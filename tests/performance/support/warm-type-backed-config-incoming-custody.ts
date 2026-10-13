import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import raw from "./warm-type-backed-config-incoming-custody.json" with { type: "json" };

type Digest = (side: "before" | "after", file: string) => string | null;
type Scope = "parent-pair" | "inherited";
for (const row of raw.completeCustodyBodies) Object.freeze(row);
Object.freeze(raw.completeCustodyBodies);
Object.freeze(raw.productionFiles);
Object.freeze(raw);
export const configIncomingCustody = raw;
export const configIncomingCustodySHA256 = createHash("sha256")
  .update(JSON.stringify(raw))
  .digest("hex");
assert.equal(
  configIncomingCustodySHA256,
  "b351992c17ea9297396f4d7609a1c14a00d90eda123484d94c6c3e8e343babeb",
);
assert.equal(raw.version, 1);
assert.equal(raw.completeCustodyBodies.length, 4);
const rows = new Map(
  raw.completeCustodyBodies.map(([file, before, predecessor, incoming]) => [
    file,
    { before, predecessor: predecessor!, incoming: incoming! },
  ]),
);
assert.equal(rows.size, 4);
for (const { predecessor, incoming } of rows.values()) {
  assert.match(predecessor, /^[a-f0-9]{64}$/u);
  assert.match(incoming, /^[a-f0-9]{64}$/u);
  assert.notEqual(predecessor, incoming);
}

/** Authenticate complete incoming custody before invoking every frozen source law. */
export function qualifyConfigIncomingCustodyHost<T extends { files: readonly string[] }>(
  production: string[],
  owned: ReadonlySet<string>,
  digest: Digest,
  qualifyOriginal: (files: string[], owned: ReadonlySet<string>, actual: Digest) => T | null,
  scope: Scope,
) {
  if (scope !== "parent-pair" && scope !== "inherited") return null;
  const incomingPresent = [...rows].some(
    ([file, { incoming }]) =>
      digest("before", file) === incoming || digest("after", file) === incoming,
  );
  if (!incomingPresent) return qualifyOriginal(production, owned, digest);
  const originalBefore =
    scope === "parent-pair" &&
    [...rows].every(([file, row]) => digest("before", file) === row.before);
  const incomingBefore = [...rows].every(
    ([file, row]) =>
      digest("before", file) ===
      (scope === "parent-pair" && row.before === null ? null : row.incoming),
  );
  if (!originalBefore && !incomingBefore) return null;
  for (const [file, row] of rows) if (digest("after", file) !== row.incoming) return null;
  const witness = qualifyOriginal(production, owned, (side, file) =>
    rows.has(file)
      ? side === "before" && scope === "parent-pair"
        ? rows.get(file)!.before
        : rows.get(file)!.predecessor
      : digest(side, file),
  );
  if (!witness) return null;
  return {
    ...witness,
    configIncomingCustodyContext: {
      manifestSHA256: configIncomingCustodySHA256,
      predecessorSource: raw.predecessorSource,
      incomingSource: raw.incomingSource,
      completeCustodyBodies: raw.completeCustodyBodies,
      before: originalBefore ? "historical" : "incoming",
      scope,
    },
  };
}
