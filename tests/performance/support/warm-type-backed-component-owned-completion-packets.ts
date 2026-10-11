import assert from "node:assert/strict";
import {
  completePackets,
  differingFields,
  object,
  observedRoots,
  originalPackets,
  readFixture,
  successorPackets,
  type ObservedPair,
} from "./warm-type-backed-owned-completion-fixture.ts";
import { compareOwnedCompletionPackets } from "./warm-type-backed-owned-completion-successor.ts";
import { validateOwnedResolves } from "./warm-type-backed-owned-completion-resolve.ts";
import type { runOwnerResolveFixture } from "./warm-type-backed-owner-resolve.ts";
import { validateComponentNativeOwnership } from "./warm-type-backed-component-owned-completion-native.ts";
import {
  componentOwnedManifest,
  componentOwnedManifestSHA256,
  type ComponentOwnedScope,
} from "./warm-type-backed-component-owned-completion-host.ts";

type Pair = ObservedPair & { sourceBinding: { componentContextHost?: unknown } };
type Receipt = Awaited<ReturnType<typeof runOwnerResolveFixture>>;

/** Compare complete actual arrays under the independently source-qualified component scope. */
export function compareComponentOwnedPackets(
  before: unknown,
  after: unknown,
  pair: Pair,
  resolved: Receipt[],
) {
  const host = object(pair.sourceBinding.componentContextHost);
  const context = object(host.componentOwnedCompletionContext);
  assert.equal(context.manifestSHA256, componentOwnedManifestSHA256);
  assert.equal(context.nativeManifestSHA256, componentOwnedManifest.nativeManifestSHA256);
  assert.equal(context.fixtureManifestSHA256, componentOwnedManifest.fixtureManifestSHA256);
  const scope = context.scope as ComponentOwnedScope;
  assert.ok(scope === "parent-pair" || scope === "inherited");
  const native = object(host.ownedCompletionContext);
  assert.equal(native.manifestSHA256, componentOwnedManifest.nativeManifestSHA256);
  assert.equal(native.fixtureManifestSHA256, componentOwnedManifest.fixtureManifestSHA256);
  assert.equal(native.scope, scope);
  assert.equal(resolved.length, 2);
  if (scope === "parent-pair") {
    // Only the qualified context is supplied to the native validator; all observed rows stay intact.
    compareOwnedCompletionPackets(
      before,
      after,
      { ...pair, sourceBinding: { ...pair.sourceBinding, projectConfigHost: host } },
      resolved,
    );
  } else {
    const expected = originalPackets.map(
      (packet) => successorPackets.find((entry) => entry.requestId === packet.requestId) ?? packet,
    );
    assert.deepEqual(before, completePackets(pair.before));
    assert.deepEqual(after, completePackets(pair.after));
    assert.deepEqual(
      before,
      expected,
      "every inherited before response is the complete native successor",
    );
    assert.deepEqual(
      after,
      expected,
      "every inherited after response is the same complete native successor",
    );
    assert.deepEqual(differingFields(before, after), []);
    for (const [side, revision] of [
      [pair.before, pair.sourceBinding.baseline],
      [pair.after, pair.sourceBinding.head],
    ] as const) {
      assert.match(revision, /^[a-f0-9]{40}$/u);
      assert.equal(side.source.revision, revision);
    }
    assert.deepEqual(pair.before.inputs.source, pair.after.inputs.source);
    const ownership = readFixture<{ sessionRoots: ObservedPair["before"]["sessionRoots"] }>(
      "after-ownership.json",
    );
    const archive = readFixture<
      Array<{ side: string; stage: string; params: unknown; response: unknown }>
    >("raw-responses.json").filter((row) => row.side === "after");
    for (const side of [pair.before, pair.after]) {
      const roots = observedRoots(side),
        originalRoots = observedRoots({ ...side, sessionRoots: ownership.sessionRoots });
      for (const witness of archive) {
        const row = side.rows.find(
          (entry) => entry.stage === witness.stage && entry.method === "textDocument/completion",
        );
        assert.ok(row);
        assert.deepEqual(row.params, witness.params);
        assert.equal(object(row.response).id, row.requestId);
        assert.deepEqual(roots.visit(row.response), row.comparableResponse);
        assert.deepEqual(roots.visit(row.response), originalRoots.visit(witness.response));
      }
      validateOwnedResolves(resolved[side === pair.before ? 0 : 1], side.inputs.source, "after");
    }
  }
  validateComponentNativeOwnership(pair, scope);
}
