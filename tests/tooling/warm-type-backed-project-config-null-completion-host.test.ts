import { qualifyCurrentConfigReviewHost } from "./support/config-reviewed-source.ts";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { test } from "node:test";
import { projectConfigManifest as original } from "../performance/support/warm-type-backed-project-config-manifest.ts";
import successor from "../performance/support/warm-type-backed-project-config-null-completion-manifest.json" with { type: "json" };
import { qualifyProjectConfigHost } from "../performance/support/warm-type-backed-project-config-host.ts";
import { qualifyProjectConfigNullCompletionHost } from "../performance/support/warm-type-backed-project-config-null-completion-host.ts";
import { qualifyProjectConfigLoaderHost } from "../performance/support/warm-type-backed-project-config-loader-host.ts";
import {
  issuedCompletionManifest as issued,
  issuedCompletionProduction,
  qualifyIssuedCompletionHost,
} from "../performance/support/warm-type-backed-issued-completion-host.ts";
import loader from "../performance/support/warm-type-backed-project-config-loader-manifest.json" with { type: "json" };

const production = original.files.map(([file]) => file);
const bodies = [...original.files, ...original.preservedBodies, ...original.harnessExtensions];
const [changedFile, predecessor, current] = successor.harnessSuccessor;
const old = new Map(bodies.map(([file, before, after]) => [file, { before, after }]));
const legacy = (side: "before" | "after", file: string) => old.get(file)?.[side] ?? null;
const digest = (side: "before" | "after", file: string) =>
  side === "after" && file === changedFile ? current : legacy(side, file);

await test("the finite null completion successor preserves the strict original whole90/51/3 authority", () => {
  assert.equal(legacy("after", changedFile), predecessor);
  assert.ok(qualifyProjectConfigHost(production, new Set(), legacy));
  assert.equal(qualifyProjectConfigHost(production, new Set(), digest), null);
  assert.equal(qualifyProjectConfigNullCompletionHost(production, new Set(), legacy), null);
  const result = qualifyProjectConfigNullCompletionHost(production, new Set(), digest);
  assert.ok(result);
  assert.equal(result.completeBodyPairs, 90);
  assert.equal(result.preservedBodyPairs, 51);
  assert.equal(result.harnessExtensions.length, 3);
  assert.deepEqual(result.harnessSuccessor, [changedFile, predecessor, current]);
});

await test("the current whole bodies qualify only with the explicit successor and complete loader context", () => {
  const actual = (side: "before" | "after", file: string) => {
    if (side === "before") {
      const body = issued.producerBodies.find(([name]) => name === file);
      const context = loader.composedContext.find(([name]) => name === file);
      return body ? body[1] : context ? context[1] : legacy(side, file);
    }
    try {
      return createHash("sha256")
        .update(fs.readFileSync(new URL(`../../${file}`, import.meta.url)))
        .digest("hex");
    } catch {
      return null;
    }
  };
  const result =
    qualifyProjectConfigNullCompletionHost(production, new Set(), actual) ??
    qualifyIssuedCompletionHost(issuedCompletionProduction, new Set(), actual) ??
    qualifyCurrentConfigReviewHost(new Set(), actual);
  assert.ok(result);
  if ("harnessSuccessor" in result) assert.equal(result.harnessSuccessor[2], current);
  else assert.equal(actual("after", changedFile), current);
  assert.equal(
    qualifyProjectConfigLoaderHost(production, new Set(), digest),
    null,
    "source closure cannot waive the independent loader bodies",
  );
});

await test("every original and current production/custody/extension body including the exact successor is mandatory", () => {
  for (const [file] of bodies)
    for (const side of ["before", "after"] as const)
      for (const replacement of [null, "f".repeat(64)]) {
        if (replacement === digest(side, file)) continue;
        assert.equal(
          qualifyProjectConfigNullCompletionHost(production, new Set(), (candidate, name) =>
            candidate === side && name === file ? replacement : digest(candidate, name),
          ),
          null,
          `${side}:${file}:${replacement}`,
        );
      }
});

await test("successor source cannot qualify unknown, omitted, duplicate or entirely already-owned production", () => {
  assert.equal(
    qualifyProjectConfigNullCompletionHost(
      [...production, "crates/vize/src/unknown.rs"],
      new Set(),
      digest,
    ),
    null,
  );
  for (const file of production) {
    assert.equal(
      qualifyProjectConfigNullCompletionHost(
        production.filter((path) => path !== file),
        new Set(),
        digest,
      ),
      null,
    );
    assert.equal(
      qualifyProjectConfigNullCompletionHost([...production, file], new Set(), digest),
      null,
    );
  }
  assert.equal(
    qualifyProjectConfigNullCompletionHost(production, new Set(production), digest),
    null,
  );
});
