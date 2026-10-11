import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import {
  completePackets,
  digest,
  object,
} from "../performance/support/warm-type-backed-owned-completion-fixture.ts";
import { compareComponentOwnedPackets } from "../performance/support/warm-type-backed-component-owned-completion-packets.ts";
import {
  componentOwnedManifest,
  componentHistoricalDigest,
  qualifyComponentOwnedCompletionHost,
  type ComponentOwnedScope,
} from "../performance/support/warm-type-backed-component-owned-completion-host.ts";
import { ownedCompletionManifest } from "../performance/support/warm-type-backed-owned-completion-host.ts";
import { componentControl } from "./support/component-owned-completion-control.ts";

function compare(value: ReturnType<typeof componentControl>) {
  compareComponentOwnedPackets(
    completePackets(value.pair.before),
    completePackets(value.pair.after),
    value.pair,
    value.resolved,
  );
}
for (const scope of ["parent-pair", "inherited"] as const) {
  await test(`${scope} retains full79 on both actual sides and the original77; no packets are rewritten`, () => {
    const value = componentControl(scope),
      before = structuredClone(value);
    compare(value);
    assert.deepEqual(value, before);
    if (scope === "parent-pair")
      assert.notDeepEqual(completePackets(value.pair.before), completePackets(value.pair.after));
    else assert.deepEqual(completePackets(value.pair.before), completePackets(value.pair.after));
    for (const side of ["before", "after"] as const)
      for (const index of Array.from({ length: 79 }, (_, index) => index)) {
        const changed = componentControl(scope);
        object(changed.pair[side].rows[index].comparableResponse).surplus = true;
        assert.throws(() => compare(changed), `${side}/${index}`);
      }
    compare(componentControl(scope));
  });
  await test(`${scope} requires BOTH full16 receipts, full raw responses/bodies and live owner epochs`, () => {
    for (const side of [0, 1])
      for (let index = 0; index < 16; index++) {
        const missing = componentControl(scope);
        missing.resolved[side].additional.splice(index, 1);
        assert.throws(() => compare(missing));
        const foreign = componentControl(scope);
        object(foreign.resolved[side].additional[index].result).surplus = true;
        assert.throws(() => compare(foreign));
      }
    for (const side of ["before", "after"] as const)
      for (const mutate of [
        (v: ReturnType<typeof componentControl>) => {
          v.pair[side].rows.find((row) => row.requestId === 72)!.ownerMigration = null;
        },
        (v: ReturnType<typeof componentControl>) => {
          object(v.pair[side].rows.find((row) => row.requestId === 72)!.response).id = -1;
        },
        (v: ReturnType<typeof componentControl>) => {
          const owner = object(
            v.pair[side].rows.find((row) => row.requestId === 72)!.ownerMigration,
          );
          object((owner.files as unknown[])[0]).code += "\n";
        },
      ]) {
        const changed = componentControl(scope);
        mutate(changed);
        assert.throws(() => compare(changed));
      }
    compare(componentControl(scope));
  });
  await test(`${scope} refuses mixed scope, missing authority, forged source identity and wrong before refusal proof`, () => {
    for (const mutate of [
      (v: ReturnType<typeof componentControl>) => {
        object(
          object(object(v.pair.sourceBinding).componentContextHost).componentOwnedCompletionContext,
        ).scope = scope === "parent-pair" ? "inherited" : "parent-pair";
      },
      (v: ReturnType<typeof componentControl>) => {
        object(v.pair.sourceBinding).componentContextHost = {};
      },
      (v: ReturnType<typeof componentControl>) => {
        object(
          object(object(v.pair.sourceBinding).componentContextHost).componentOwnedCompletionContext,
        ).manifestSHA256 = "f".repeat(64);
      },
      (v: ReturnType<typeof componentControl>) => {
        v.pair.before.source.revision = "f".repeat(40);
      },
      (v: ReturnType<typeof componentControl>) => {
        v.resolved[0].refusalFailures = scope === "parent-pair" ? [] : ["foreign"];
      },
    ]) {
      const changed = componentControl(scope);
      mutate(changed);
      assert.throws(() => compare(changed));
    }
    compare(componentControl(scope));
  });
}

const rows = new Map(
  [...componentOwnedManifest.helperBodies, ...componentOwnedManifest.integrationBodies].map(
    (row) => [row[0], row],
  ),
);
const nativeBodies = new Map(ownedCompletionManifest.helperBodies.map((row) => [row[0], row]));
const nativeExtensions = new Map(ownedCompletionManifest.extensions.map((row) => [row[0], row]));
const extensions = new Map(componentOwnedManifest.extensions.map((row) => [row[0], row]));
const tests = new Map(componentOwnedManifest.testBodies.map((row) => [row[0], row]));
function source(scope: ComponentOwnedScope) {
  return (side: "before" | "after", file: string) => {
    const row = rows.get(file);
    if (row) return row[side === "after" ? 4 : scope === "inherited" ? 2 : 1];
    const added = extensions.get(file);
    if (added) return added[side === "after" ? 2 : 1];
    const test = tests.get(file);
    if (test) return test[side === "after" ? 3 : scope === "inherited" ? 2 : 1];
    const native = nativeExtensions.get(file);
    return native ? native[side === "after" || scope === "inherited" ? 2 : 1] : null;
  };
}
for (const scope of ["parent-pair", "inherited"] as const) {
  await test(`${scope} closes every source stage before exposing the exact historical component boundary`, () => {
    const current = source(scope);
    const qualify = (read = current) =>
      qualifyComponentOwnedCompletionHost(
        [],
        new Set(),
        read,
        (files, _owned, authenticated) => {
          for (const [file, , predecessor] of nativeBodies.values())
            assert.equal(authenticated("after", file), predecessor);
          for (const [file, , nativeParent] of componentOwnedManifest.integrationBodies)
            assert.equal(authenticated("after", file), nativeParent);
          const final = componentHistoricalDigest(authenticated);
          for (const [file, , , historical] of rows.values())
            assert.equal(final("after", file), historical);
          return { files };
        },
        scope,
      );
    assert.ok(qualify());
    for (const [file] of [...rows, ...nativeExtensions, ...extensions, ...tests])
      for (const side of ["before", "after"] as const)
        for (const replacement of [null, "f".repeat(64)]) {
          if (current(side, file) === replacement) continue;
          assert.equal(
            qualify((candidate, name) =>
              candidate === side && name === file ? replacement : current(candidate, name),
            ),
            null,
            `${side}:${file}`,
          );
        }
    for (const [file] of rows) {
      const other = source(scope === "parent-pair" ? "inherited" : "parent-pair");
      assert.equal(
        qualify((side, name) =>
          side === "before" && name === file ? other(side, name) : current(side, name),
        ),
        null,
      );
    }
    assert.ok(qualify());
    for (const [file, , , , after] of rows.values())
      assert.equal(digest(fs.readFileSync(new URL(`../../${file}`, import.meta.url))), after);
    for (const [file, , after] of extensions.values())
      assert.equal(digest(fs.readFileSync(new URL(`../../${file}`, import.meta.url))), after);
    for (const [file, , , after] of tests.values())
      assert.equal(digest(fs.readFileSync(new URL(`../../${file}`, import.meta.url))), after);
  });
}
