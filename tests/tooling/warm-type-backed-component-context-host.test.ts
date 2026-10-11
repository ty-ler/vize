import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { test } from "node:test";
import { componentContextManifest as manifest } from "../performance/support/warm-type-backed-component-context-manifest.ts";
import { qualifyComponentContextHost } from "../performance/support/warm-type-backed-component-context-host.ts";
import { allowed } from "../performance/support/warm-type-backed-production-paths.ts";
import loader from "../performance/support/warm-type-backed-project-config-loader-manifest.json" with { type: "json" };

type Pair = [string, string | null, string | null];

function sourcePair(composed: boolean) {
  const production = new Map<string, Pair>();
  if (composed)
    for (const [file, before, , after] of manifest.inheritedProductionBodies)
      production.set(file, [file, before, after]);
  for (const [file, inherited, after, original] of manifest.componentBodies)
    production.set(file, [file, composed ? original : inherited, after]);
  const bodies = new Map(production);
  for (const [file, original, inherited, after] of manifest.inheritedProductionBodies)
    bodies.set(file, [file, composed ? original : inherited, after]);
  for (const [file, original, inherited] of manifest.inheritedCustodyBodies)
    bodies.set(file, [file, composed ? original : inherited, inherited]);
  for (const [file, absent, inherited] of manifest.inheritedHarnessExtensions)
    bodies.set(file, [file, composed ? absent : inherited, inherited]);
  for (const [file, before, after] of loader.composedContext) {
    assert.ok(typeof file === "string");
    bodies.set(file, [file, before, after]);
  }
  const originals = new Map(manifest.originalComponentBodies);
  const digest = (side: "before" | "after", file: string) =>
    bodies.get(file)?.[side === "before" ? 1 : 2] ??
    (side === "after" ? originals.get(file) : null) ??
    null;
  return { production: [...production.keys()].toSorted(), bodies, originals, digest };
}

for (const composed of [false, true]) {
  const scope = composed ? "complete original composition" : "exact parent-relative child";
  const { production, bodies, originals, digest } = sourcePair(composed);

  await test(`${scope} admits all complete source and retained authority bodies`, () => {
    const result = qualifyComponentContextHost(production, allowed, digest);
    assert.ok(result);
    assert.equal(result.completeComponentBodies, 28);
    assert.equal(result.inheritedProductionBodies, 90);
    assert.equal(result.inheritedCustodyBodies, 51);
    assert.equal(result.originalComponentBodies, 4);
    assert.equal(result.loaderContext.authority, "complete-composed-vite-loader");
    assert.deepEqual(result.files, production);
    assert.equal(
      result.authority,
      composed
        ? "complete-project-config-and-component-context-slices"
        : "complete-parent-relative-component-context-slice",
    );
  });

  await test(`${scope} rejects each missing, duplicate or unknown production entry`, () => {
    for (const file of production) {
      assert.equal(
        qualifyComponentContextHost(
          production.filter((candidate) => candidate !== file),
          new Set(),
          digest,
        ),
        null,
        file,
      );
      assert.equal(
        qualifyComponentContextHost([...production, file], new Set(), digest),
        null,
        file,
      );
    }
    assert.equal(
      qualifyComponentContextHost(
        [...production, "crates/vize/src/unreviewed.rs"],
        allowed,
        digest,
      ),
      null,
    );
    assert.equal(qualifyComponentContextHost([], allowed, digest), null);
  });

  await test(`${scope} rejects drift of each complete inherited, owned and custody body`, () => {
    for (const file of bodies.keys())
      for (const side of ["before", "after"] as const)
        assert.equal(
          qualifyComponentContextHost(production, allowed, (candidate, path) =>
            candidate === side && path === file ? "f".repeat(64) : digest(candidate, path),
          ),
          null,
          `${side}:${file}`,
        );
    for (const file of originals.keys())
      assert.equal(
        qualifyComponentContextHost(production, allowed, (side, path) =>
          side === "after" && path === file ? "f".repeat(64) : digest(side, path),
        ),
        null,
        file,
      );
  });

  await test(`${scope} binds actual current source and complete original component corpus`, async () => {
    const actual = (side: "before" | "after", file: string) =>
      side === "before"
        ? digest(side, file)
        : createHash("sha256")
            .update(fs.readFileSync(new URL("../../" + file, import.meta.url)))
            .digest("hex");
    if (qualifyComponentContextHost(production, allowed, actual)) return;
    const { qualifyCurrentComponentOwnerSource } =
      await import("./support/component-owner-migration-source.ts");
    assert.ok(qualifyCurrentComponentOwnerSource(composed));
  });
}

await test("only the two complete sealed inherited loader contexts receive child qualification", () => {
  const { production, digest } = sourcePair(true);
  for (const context of [loader.legacyContext, loader.composedContext]) {
    const pairs = new Map(context.map(([file, before, after]) => [file, { before, after }]));
    assert.ok(
      qualifyComponentContextHost(production, allowed, (side, file) =>
        pairs.has(file) ? pairs.get(file)![side] : digest(side, file),
      ),
    );
  }
});

await test("missing, mixed and changed loader ownership never bypasses the complete successor", () => {
  const { production, digest } = sourcePair(true);
  for (const [file] of loader.composedContext)
    for (const side of ["before", "after"] as const)
      for (const changed of [null, "f".repeat(64)])
        assert.equal(
          qualifyComponentContextHost(production, allowed, (candidate, name) =>
            candidate === side && name === file ? changed : digest(candidate, name),
          ),
          null,
        );
  const legacy = new Map(
    loader.legacyContext.map(([file, before, after]) => [file, { before, after }]),
  );
  assert.equal(
    qualifyComponentContextHost(production, allowed, (side, file) =>
      side === "before" && legacy.has(file) ? legacy.get(file)!.before : digest(side, file),
    ),
    null,
  );
  assert.equal(
    qualifyComponentContextHost(
      [...production, "crates/vize_carton/src/config/unreviewed.rs"],
      allowed,
      digest,
    ),
    null,
  );
});
