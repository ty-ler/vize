import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { test } from "node:test";
import {
  issuedCompletionManifest as issued,
  issuedCompletionProduction as production,
  qualifyIssuedCompletionContext,
  qualifyIssuedCompletionHost,
} from "../performance/support/warm-type-backed-issued-completion-host.ts";
import { projectConfigManifest as original } from "../performance/support/warm-type-backed-project-config-manifest.ts";
import nullCompletion from "../performance/support/warm-type-backed-project-config-null-completion-manifest.json" with { type: "json" };
import loader from "../performance/support/warm-type-backed-project-config-loader-manifest.json" with { type: "json" };
import { qualifyProjectConfigLoaderHost } from "../performance/support/warm-type-backed-project-config-loader-host.ts";
import { allowed } from "../performance/support/warm-type-backed-production-paths.ts";

type Pair = [string, string | null, string | null];
const originalBodies = [
  ...original.files,
  ...original.preservedBodies,
  ...original.harnessExtensions,
];
const pairs: Pair[] = originalBodies.map(([file, before, after]) => [file, before, after]);
for (const [file, before, , after] of issued.producerBodies) {
  const index = pairs.findIndex(([name]) => name === file);
  if (index >= 0) pairs[index] = [file, before, after];
  else pairs.push([file, before, after]);
}
const [nullFile, , nullAfter] = nullCompletion.harnessSuccessor;
pairs.find(([file]) => file === nullFile)![2] = nullAfter;
const current = new Map(
  [...pairs, ...(loader.composedContext as Pair[])].map(([file, before, after]) => [
    file,
    { before, after },
  ]),
);
const digest = (side: "before" | "after", file: string) => current.get(file)?.[side] ?? null;
const root = new URL("../../", import.meta.url);

await test("the distinct whole96 authority retains all90/51/3 and the complete issued producer", () => {
  assert.equal(qualifyProjectConfigLoaderHost(production, new Set(), digest), null);
  const result = qualifyIssuedCompletionHost(production, allowed, digest);
  assert.ok(result);
  assert.equal(result.completeBodyPairs, 96);
  assert.equal(result.preservedBodyPairs, 51);
  assert.equal(result.harnessExtensions.length, 3);
  assert.equal(result.issuedCompletionContext.completeBodyPairs, 7);
  assert.equal(result.loaderContext.authority, "complete-composed-vite-loader");
});

await test("every current whole source body matches the distinct whole96 authority", () => {
  const actual = (side: "before" | "after", file: string) => {
    if (side === "before") return digest(side, file);
    try {
      return createHash("sha256")
        .update(fs.readFileSync(new URL(file, root)))
        .digest("hex");
    } catch {
      return null;
    }
  };
  assert.ok(qualifyIssuedCompletionHost(production, allowed, actual));
});

await test("every original production/custody/extension and all seven producer pairs are mandatory", () => {
  for (const [file] of pairs)
    for (const side of ["before", "after"] as const)
      for (const replacement of [null, "f".repeat(64)]) {
        if (digest(side, file) === replacement) continue;
        assert.equal(
          qualifyIssuedCompletionHost(production, new Set(), (candidate, name) =>
            candidate === side && name === file ? replacement : digest(candidate, name),
          ),
          null,
          `${side}:${file}:${replacement}`,
        );
      }
});

await test("missing, extra, duplicate, foreign-owned and fully-owned footprints cannot qualify", () => {
  for (const file of production) {
    assert.equal(
      qualifyIssuedCompletionHost(
        production.filter((name) => name !== file),
        new Set(),
        digest,
      ),
      null,
      file,
    );
    assert.equal(qualifyIssuedCompletionHost([...production, file], new Set(), digest), null, file);
  }
  assert.equal(
    qualifyIssuedCompletionHost(
      [...production, "crates/vize_canon/unissued.rs"],
      new Set(),
      digest,
    ),
    null,
  );
  assert.equal(
    qualifyIssuedCompletionHost(
      [...production, "crates/vize_canon/unissued.rs"],
      new Set(["crates/vize_canon/unissued.rs"]),
      digest,
    ),
    null,
  );
  assert.equal(qualifyIssuedCompletionHost(production, new Set(production), digest), null);
  assert.equal(
    qualifyIssuedCompletionHost(
      ["crates/vize_canon/unissued.rs"],
      new Set(["crates/vize_canon/unissued.rs"]),
      digest,
    ),
    null,
  );
});

await test("legacy predecessor bodies and mixed or missing inherited loaders cannot qualify the successor", () => {
  for (const [file, , predecessor] of issued.producerBodies)
    assert.equal(
      qualifyIssuedCompletionHost(production, new Set(), (side, name) =>
        side === "after" && name === file ? predecessor : digest(side, name),
      ),
      null,
      file,
    );
  for (const [file] of loader.composedContext as Pair[])
    for (const side of ["before", "after"] as const)
      for (const replacement of [null, "f".repeat(64)])
        assert.equal(
          qualifyIssuedCompletionHost(production, new Set(), (candidate, name) =>
            candidate === side && name === file ? replacement : digest(candidate, name),
          ),
          null,
          `${side}:${file}:${replacement}`,
        );
  const legacy = new Map(
    (loader.legacyContext as Pair[]).map(([file, before, after]) => [file, { before, after }]),
  );
  const old = (side: "before" | "after", file: string) =>
    legacy.has(file) ? legacy.get(file)![side] : digest(side, file);
  assert.ok(qualifyIssuedCompletionHost(production, new Set(), old));
  for (const reversed of [false, true])
    assert.equal(
      qualifyIssuedCompletionHost(production, new Set(), (side, file) =>
        (side === "before") !== reversed ? old(side, file) : digest(side, file),
      ),
      null,
    );
});

await test("an unchanged inherited issuer context binds all seven complete actual bodies on BOTH sides", () => {
  const inherited = (side: "before" | "after", file: string) => digest("after", file);
  assert.ok(qualifyIssuedCompletionContext(inherited, "inherited"));
  assert.equal(qualifyIssuedCompletionContext(digest, "inherited"), null);
  assert.equal(qualifyIssuedCompletionContext(inherited, "parent-pair"), null);
  assert.equal(qualifyIssuedCompletionContext(inherited, "foreign" as "inherited"), null);
  for (const [file] of issued.producerBodies)
    for (const side of ["before", "after"] as const)
      for (const replacement of [null, "f".repeat(64)])
        assert.equal(
          qualifyIssuedCompletionContext(
            (candidate, name) =>
              candidate === side && name === file ? replacement : inherited(candidate, name),
            "inherited",
          ),
          null,
          `${side}:${file}:${replacement}`,
        );
});
