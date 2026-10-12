import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import test from "node:test";
import { qualifyAllocationSource } from "../performance/support/allocation-diagnostic/source.ts";
import { qualifyInlineBucketHost } from "../performance/support/warm-type-backed-inline-bucket-host.ts";
import { gitBodyDigest } from "../performance/support/warm-type-backed-path-host.ts";

const manifest = JSON.parse(
  fs.readFileSync(
    new URL("../performance/support/warm-type-backed-inline-bucket-manifest.json", import.meta.url),
    "utf8",
  ),
) as { originalSource: string; reviewedSource: string; files: string[]; preservedBodies: string[] };
const production = execFileSync(
  "git",
  [
    "diff",
    "--name-only",
    manifest.originalSource,
    manifest.reviewedSource,
    "--",
    "crates",
    "davinci",
    "vendor",
    "npm",
    "Cargo.toml",
    "Cargo.lock",
    ".cargo",
    ".config",
    "rust-toolchain.toml",
  ],
  { encoding: "utf8" },
)
  .trim()
  .split("\n");
const bodies = new Map<string, string | null>();
for (const row of [...manifest.files, ...manifest.preservedBodies]) {
  const [file] = row.split("\t");
  for (const [side, source] of [
    ["before", manifest.originalSource],
    ["after", manifest.reviewedSource],
  ] as const) {
    const entry = execFileSync("git", ["ls-tree", source, "--", file], { encoding: "utf8" }).trim();
    if (!entry) bodies.set(`${side}:${file}`, null);
    else {
      assert.match(entry, /^100644 blob /u);
      bodies.set(
        `${side}:${file}`,
        createHash("sha256")
          .update(execFileSync("git", ["show", `${source}:${file}`]))
          .digest("hex"),
      );
    }
  }
}
const digest = (side: "before" | "after", file: string) => bodies.get(`${side}:${file}`) ?? null;

await test("the four-path inline storage successor preserves every original 195 producer and 45 workload bodies", () => {
  const receipt = qualifyInlineBucketHost(production, digest);
  assert.ok(receipt);
  assert.equal(receipt.originalSource, manifest.originalSource);
  assert.equal(receipt.reviewedSource, manifest.reviewedSource);
  assert.equal(receipt.completeBodyPairs, 196);
  assert.equal(receipt.preservedBodyPairs, 45);
  assert.equal(receipt.files.length, 4);
  const current = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const actualProduction = execFileSync(
    "git",
    [
      "diff",
      "--name-only",
      manifest.originalSource,
      current,
      "--",
      "crates",
      "davinci",
      "vendor",
      "npm",
      "Cargo.toml",
      "Cargo.lock",
      ".cargo",
      ".config",
      "rust-toolchain.toml",
    ],
    { encoding: "utf8" },
  )
    .trim()
    .split("\n");
  const actualInline = qualifyInlineBucketHost(actualProduction, (side, file) =>
    gitBodyDigest(process.cwd(), side === "before" ? manifest.originalSource : current, file),
  );
  if (actualInline) assert.deepEqual(actualInline, receipt);
  else {
    const diagnostic = qualifyAllocationSource(process.cwd(), current);
    assert.ok(diagnostic, "the separate complete optional diagnostic source must qualify");
    assert.equal(diagnostic.authority, "complete-reviewed-optional-allocation-diagnosis");
    assert.equal(diagnostic.nativeBodies, 208);
    assert.equal(diagnostic.originalMandatoryBodies, 45);
    assert.equal(diagnostic.acceptanceCredit, "none");
  }
});

await test("missing, extra and duplicate producers and every whole body mutation refuse inline qualification", () => {
  for (const changed of [
    [],
    production.slice(1),
    [...production, production[0]],
    [...production, "crates/vize_canon/src/unknown.rs"],
  ]) {
    assert.equal(qualifyInlineBucketHost(changed, digest), null);
  }
  for (const row of [...manifest.files, ...manifest.preservedBodies]) {
    const [file] = row.split("\t");
    for (const side of ["before", "after"] as const) {
      assert.equal(
        qualifyInlineBucketHost(production, (which, path) =>
          which === side && path === file ? "0".repeat(64) : digest(which, path),
        ),
        null,
      );
    }
  }
});
