import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { test } from "node:test";
import { qualifyProjectConfigHost } from "../performance/support/warm-type-backed-project-config-host.ts";
import { qualifyProjectConfigNullCompletionHost } from "../performance/support/warm-type-backed-project-config-null-completion-host.ts";
import { projectConfigManifest as manifest } from "../performance/support/warm-type-backed-project-config-manifest.ts";
import { allowed } from "../performance/support/warm-type-backed-production-paths.ts";
import {
  issuedCompletionManifest as issued,
  issuedCompletionProduction,
  qualifyIssuedCompletionHost,
} from "../performance/support/warm-type-backed-issued-completion-host.ts";
import loader from "../performance/support/warm-type-backed-project-config-loader-manifest.json" with { type: "json" };

const entries = new Map(manifest.files.map(([file, before, after]) => [file, { before, after }]));
const preserved = new Map(
  manifest.preservedBodies.map(([file, before, after]) => [file, { before, after }]),
);
const extensions = new Map(
  manifest.harnessExtensions.map(([file, before, after]) => [file, { before, after }]),
);
const production = [...entries.keys()];
const digest = (side: "before" | "after", file: string) =>
  entries.get(file)?.[side] ?? preserved.get(file)?.[side] ?? extensions.get(file)?.[side] ?? null;

await test("the complete reviewed configuration slice qualifies for actual original400 measurement", () => {
  const result = qualifyProjectConfigHost(production, new Set(), digest);
  assert.ok(result);
  assert.equal(result.completeBodyPairs, 90);
  assert.equal(result.preservedBodyPairs, 51);
  assert.deepEqual(result.files, production);
});

await test("the actual composed production selector admits the complete configuration source pair", () => {
  assert.ok(qualifyProjectConfigHost(production, allowed, digest));
  assert.ok(allowed.has("crates/vize_canon/src/lsp_client.rs"));
  assert.equal(allowed.has("crates/vize/tests/project_config_cli.rs"), false);
});

await test("qualification binds every current source and whole unchanged corpus and recipe", async () => {
  const actual = (side: "before" | "after", file: string) => {
    if (side === "before") {
      const body = issued.producerBodies.find(([name]) => name === file);
      const context = loader.composedContext.find(([name]) => name === file);
      return body ? body[1] : context ? context[1] : digest(side, file);
    }
    return createHash("sha256")
      .update(fs.readFileSync(new URL("../../" + file, import.meta.url)))
      .digest("hex");
  };
  if (
    qualifyProjectConfigHost(production, new Set(), actual) ??
    qualifyProjectConfigNullCompletionHost(production, new Set(), actual) ??
    qualifyIssuedCompletionHost(issuedCompletionProduction, new Set(), actual)
  ) return;

  // The existing 90-body authority stays frozen; an explicitly bound child
  // must qualify its entire composed footprint and every inherited control.
  const { qualifyComponentContextHost } =
    await import("../performance/support/warm-type-backed-component-context-host.ts");
  const component = JSON.parse(
    fs.readFileSync(
      new URL(
        "../performance/support/warm-type-backed-component-context-manifest.json",
        import.meta.url,
      ),
      "utf8",
    ),
  ) as {
    componentBodies: Array<[string, string | null, string, string | null]>;
  };
  const originalBodies = new Map(
    component.componentBodies.map(([file, , , before]) => [file, before]),
  );
  const loaderFiles = new Set([
    "crates/vize_carton/src/config/loader/js.rs",
    "crates/vize_carton/src/config/loader/module-runtime.mjs",
  ]);
  const composed = [...new Set([...production, ...originalBodies.keys()])].toSorted();
  const result = qualifyComponentContextHost(composed, new Set(), (side, file) =>
    side === "before" && !loaderFiles.has(file)
      ? (digest(side, file) ?? originalBodies.get(file) ?? null)
      : actual("after", file),
  );
  if (result) {
    assert.equal(result.authority, "complete-project-config-and-component-context-slices");
    return;
  }
  const { qualifyCurrentComponentOwnerSource } =
    await import("./support/component-owner-migration-source.ts");
  const successor = qualifyCurrentComponentOwnerSource();
  assert.ok(successor);
  assert.equal(
    successor.authority,
    "complete-project-config-and-component-owner-migration-successor",
  );
});

await test("each original and current source body including absent new owners is mandatory", () => {
  for (const file of production)
    for (const side of ["before", "after"] as const)
      assert.equal(
        qualifyProjectConfigHost(production, new Set(), (candidate, name) =>
          candidate === side && name === file ? "f".repeat(64) : digest(candidate, name),
        ),
        null,
        `${side}:${file}`,
      );
});

await test("whole original400, config, native, build, ceiling and finite extension bodies cannot drift", () => {
  for (const file of [...preserved.keys(), ...extensions.keys()])
    for (const side of ["before", "after"] as const)
      assert.equal(
        qualifyProjectConfigHost(production, new Set(), (candidate, name) =>
          candidate === side && name === file ? "f".repeat(64) : digest(candidate, name),
        ),
        null,
        `${side}:${file}`,
      );
});

await test("unknown, omitted, duplicate and already-owned paths cannot receive partial qualification", () => {
  assert.equal(
    qualifyProjectConfigHost([...production, "crates/vize/src/unreviewed.rs"], new Set(), digest),
    null,
  );
  for (const file of production) {
    assert.equal(
      qualifyProjectConfigHost(
        production.filter((path) => path !== file),
        new Set(),
        digest,
      ),
      null,
      file,
    );
    assert.equal(qualifyProjectConfigHost([...production, file], new Set(), digest), null, file);
  }
  const owned = new Set(["crates/vize_canon/src/owned-existing-surface.rs"]);
  assert.ok(qualifyProjectConfigHost([...production, ...owned], owned, digest));
  assert.equal(qualifyProjectConfigHost([...owned], owned, digest), null);
});
