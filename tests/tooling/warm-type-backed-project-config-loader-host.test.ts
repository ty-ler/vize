import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { test } from "node:test";
import { qualifyProjectConfigLoaderHost } from "../performance/support/warm-type-backed-project-config-loader-host.ts";
import { projectConfigManifest as original } from "../performance/support/warm-type-backed-project-config-manifest.ts";
import { allowed } from "../performance/support/warm-type-backed-production-paths.ts";
import {
  issuedCompletionManifest as issued,
  issuedCompletionProduction,
  qualifyIssuedCompletionHost,
} from "../performance/support/warm-type-backed-issued-completion-host.ts";

type Pair = [string, string | null, string | null];
const loader = JSON.parse(
  fs.readFileSync(
    new URL(
      "../performance/support/warm-type-backed-project-config-loader-manifest.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as { composedSource: string; legacyContext: Pair[]; composedContext: Pair[] };
const production = original.files.map(([file]) => file);
const originalBodies = [
  ...original.files,
  ...original.preservedBodies,
  ...original.harnessExtensions,
];
const digest = (context: Pair[]) => {
  const bodies = new Map(
    [...originalBodies, ...context].map(([file, before, after]) => [file, { before, after }]),
  );
  return (side: "before" | "after", file: string) => bodies.get(file)?.[side] ?? null;
};
const root = new URL("../../", import.meta.url);
const actualDigest = (side: "before" | "after", file: string) => {
  if (side === "before") {
    const body = issued.producerBodies.find(([name]) => name === file);
    return body ? body[1] : digest(loader.composedContext)(side, file);
  }
  try {
    return createHash("sha256")
      .update(fs.readFileSync(new URL(file, root)))
      .digest("hex");
  } catch {
    return null;
  }
};

await test("original whole90/51/3 authority retains its exact legacy loader context", () => {
  const result = qualifyProjectConfigLoaderHost(
    production,
    new Set(),
    digest(loader.legacyContext),
  );
  assert.ok(result);
  assert.equal(result.completeBodyPairs, 90);
  assert.equal(result.preservedBodyPairs, 51);
  assert.equal(result.loaderContext.authority, "original-reviewed-loader");
});

await test("every current config, corpus and loader body matches its complete pinned authority", () => {
  const result =
    qualifyProjectConfigLoaderHost(production, allowed, actualDigest) ??
    qualifyIssuedCompletionHost(issuedCompletionProduction, allowed, actualDigest);
  assert.ok(result);
  assert.equal(result.loaderContext.authority, "complete-composed-vite-loader");
  assert.equal(result.loaderContext.completeBodyPairs.length, 2);
  assert.equal(result.harnessExtensions.length, 3);
});

await test("the loader context cannot excuse any original configuration, corpus or extension body drift", () => {
  const complete = digest(loader.composedContext);
  for (const [file] of originalBodies)
    for (const side of ["before", "after"] as const)
      assert.equal(
        qualifyProjectConfigLoaderHost(production, new Set(), (candidate, name) =>
          candidate === side && name === file ? "f".repeat(64) : complete(candidate, name),
        ),
        null,
        `${side}:${file}`,
      );
});

await test("whole inherited loader bodies cannot be absent, mutated or substituted on either side", () => {
  for (const context of [loader.legacyContext, loader.composedContext]) {
    const complete = digest(context);
    for (const [file, before, after] of context)
      for (const side of ["before", "after"] as const)
        for (const replacement of (side === "before" ? before : after) === null
          ? ["f".repeat(64)]
          : [null, "f".repeat(64)])
          assert.equal(
            qualifyProjectConfigLoaderHost(production, new Set(), (candidate, name) =>
              candidate === side && name === file ? replacement : complete(candidate, name),
            ),
            null,
            `${side}:${file}:${replacement}`,
          );
  }
});

await test("a mixed old/new loader context cannot inherit either exact authority", () => {
  const old = digest(loader.legacyContext),
    current = digest(loader.composedContext);
  for (const reversed of [false, true])
    assert.equal(
      qualifyProjectConfigLoaderHost(production, new Set(), (side, file) =>
        (side === "before") !== reversed ? old(side, file) : current(side, file),
      ),
      null,
    );
});

await test("the inherited context cannot admit extra, omitted or duplicate production changes", () => {
  const current = digest(loader.composedContext);
  assert.equal(
    qualifyProjectConfigLoaderHost(
      [...production, loader.composedContext[0][0]],
      new Set(),
      current,
    ),
    null,
  );
  assert.equal(qualifyProjectConfigLoaderHost(production.slice(1), new Set(), current), null);
  assert.equal(
    qualifyProjectConfigLoaderHost([...production, production[0]], new Set(), current),
    null,
  );
});
