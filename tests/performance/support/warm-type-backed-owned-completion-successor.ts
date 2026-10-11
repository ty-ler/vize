import assert from "node:assert/strict";
import type { runOwnerResolveFixture } from "./warm-type-backed-owner-resolve.ts";
import {
  completePackets,
  differingFields,
  originalPackets,
  successorPackets,
  object,
  observedRoots,
  readFixture,
  type ObservedPair,
} from "./warm-type-backed-owned-completion-fixture.ts";
import { validateNativeOwnership } from "./warm-type-backed-owned-completion-native.ts";
import { validateOwnedResolves } from "./warm-type-backed-owned-completion-resolve.ts";
import {
  ownedCompletionManifest,
  ownedCompletionManifestSHA256,
} from "./warm-type-backed-owned-completion-host.ts";

type ResolveReceipt = Awaited<ReturnType<typeof runOwnerResolveFixture>>;

/** Admit two complete authored owner packets, while comparing every original field. */
export function compareOwnedCompletionPackets(
  before: unknown,
  after: unknown,
  pair: ObservedPair,
  resolved: ResolveReceipt[],
) {
  assert.deepEqual(before, completePackets(pair.before));
  assert.deepEqual(after, completePackets(pair.after));
  assert.deepEqual(before, originalPackets, "the entire original79 remains archival authority");
  const expected = originalPackets.map(
    (packet) => successorPackets.find((entry) => entry.requestId === packet.requestId) ?? packet,
  );
  assert.deepEqual(
    after,
    expected,
    "only the two literal complete source-backed successor packets may differ",
  );
  const expectedDifferences = [72, 80].flatMap((id) => {
    const index = originalPackets.findIndex((row) => row.requestId === id);
    return [0, 1, 2, 3].flatMap((item) => {
      const prefix = `/${index}/response/result/${item}/data/vizeCompletion`;
      return [
        `${prefix}/item/data/fileName`,
        ...(id === 72 ? [`${prefix}/item/data/position`] : []),
        `${prefix}/requestUri`,
      ];
    });
  });
  assert.deepEqual(differingFields(before, after).toSorted(), expectedDifferences.toSorted());
  assert.equal(expectedDifferences.length, 20);
  for (const [side, expected] of [
    [pair.before, pair.sourceBinding.baseline],
    [pair.after, pair.sourceBinding.head],
  ] as const) {
    assert.match(expected, /^[a-f0-9]{40}$/u);
    assert.equal(side.source.revision, expected);
  }
  const context = object(object(pair.sourceBinding.projectConfigHost).ownedCompletionContext);
  assert.equal(context.manifestSHA256, ownedCompletionManifestSHA256);
  assert.equal(context.fixtureManifestSHA256, ownedCompletionManifest.fixtureManifestSHA256);
  assert.deepEqual(pair.before.inputs.source, pair.after.inputs.source);
  const raw =
    readFixture<
      Array<{ side: "before" | "after"; stage: string; params: unknown; response: unknown }>
    >("raw-responses.json");
  for (const witness of raw) {
    const side = pair[witness.side];
    const roots = observedRoots(side);
    const row = side.rows.find(
      (entry) => entry.stage === witness.stage && entry.method === "textDocument/completion",
    );
    assert.ok(row);
    assert.deepEqual(row.params, witness.params);
    const savedRoots = readFixture<{ sessionRoots: ObservedPair["before"]["sessionRoots"] }>(
      `${witness.side}-ownership.json`,
    );
    const historicalRoots = observedRoots({ ...side, sessionRoots: savedRoots.sessionRoots });
    assert.deepEqual(roots.visit(row.response), historicalRoots.visit(witness.response));
    assert.deepEqual(roots.visit(row.response), row.comparableResponse);
    assert.equal(object(row.response).id, row.requestId);
  }
  validateNativeOwnership(pair);
  assert.equal(resolved.length, 2);
  validateOwnedResolves(resolved[0], pair.before.inputs.source, "before");
  validateOwnedResolves(resolved[1], pair.after.inputs.source, "after");
}
