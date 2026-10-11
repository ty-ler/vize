import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { test } from "node:test";
import { qualifyProjectConfigHost } from "../performance/support/warm-type-backed-project-config-host.ts";

const manifest = JSON.parse(
  fs.readFileSync(
    new URL(
      "../performance/support/warm-type-backed-project-config-manifest.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as {
  originalSource: string;
  reviewedSource: string;
  files: Array<[string, string | null, string]>;
  preservedBodies: Array<[string, string]>;
};
const entries = new Map(manifest.files.map(([file, before, after]) => [file, { before, after }]));
const preserved = new Map(manifest.preservedBodies);
const production = [...entries.keys()];
const digest = (side: "before" | "after", file: string) =>
  entries.get(file)?.[side] ?? preserved.get(file) ?? null;

test("the complete reviewed configuration slice qualifies for actual original400 measurement", () => {
  const result = qualifyProjectConfigHost(production, new Set(), digest);
  assert.ok(result);
  assert.equal(result.completeBodyPairs, 90);
  assert.equal(result.preservedBodyPairs, 51);
  assert.deepEqual(result.files, production);
});

test("qualification binds every current source and whole unchanged corpus and recipe", () => {
  const actual = (side: "before" | "after", file: string) =>
    side === "before"
      ? digest(side, file)
      : createHash("sha256")
          .update(fs.readFileSync(new URL("../../" + file, import.meta.url)))
          .digest("hex");
  assert.ok(qualifyProjectConfigHost(production, new Set(), actual));
});

test("each original and current source body including absent new owners is mandatory", () => {
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

test("whole original400, config, native, build and ceiling bodies cannot change on either side", () => {
  for (const file of preserved.keys())
    for (const side of ["before", "after"] as const)
      assert.equal(
        qualifyProjectConfigHost(production, new Set(), (candidate, name) =>
          candidate === side && name === file ? "f".repeat(64) : digest(candidate, name),
        ),
        null,
        `${side}:${file}`,
      );
});

test("unknown, omitted, duplicate and already-owned paths cannot receive partial qualification", () => {
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
