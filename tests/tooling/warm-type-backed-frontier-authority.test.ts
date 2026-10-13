import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import test from "node:test";
import { qualifyFrontierHost } from "../performance/support/warm-type-backed-frontier-host.ts";
import { gitBodyDigest } from "../performance/support/warm-type-backed-path-host.ts";

const manifest = JSON.parse(
  fs.readFileSync(
    new URL("../performance/support/warm-type-backed-frontier-manifest.json", import.meta.url),
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

await test("the seven-path frontier successor retains all 196 native predecessors and 45 original workload bodies", () => {
  const receipt = qualifyFrontierHost(production, digest);
  assert.ok(receipt);
  assert.equal(receipt.originalSource, manifest.originalSource);
  assert.equal(receipt.reviewedSource, manifest.reviewedSource);
  assert.equal(receipt.completeBodyPairs, 198);
  assert.equal(receipt.preservedBodyPairs, 45);
  assert.equal(receipt.files.length, 7);
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
  assert.deepEqual(
    qualifyFrontierHost(actualProduction, (side, file) =>
      gitBodyDigest(process.cwd(), side === "before" ? manifest.originalSource : current, file),
    ),
    receipt,
  );
});

await test("missing, extra and duplicate producers and every whole body mutation refuse frontier qualification", () => {
  for (const changed of [
    [],
    production.slice(1),
    [...production, production[0]],
    [...production, "crates/vize_canon/src/unknown.rs"],
  ]) {
    assert.equal(qualifyFrontierHost(changed, digest), null);
  }
  for (const row of [...manifest.files, ...manifest.preservedBodies]) {
    const [file] = row.split("\t");
    for (const side of ["before", "after"] as const) {
      assert.equal(
        qualifyFrontierHost(production, (which, path) =>
          which === side && path === file ? "0".repeat(64) : digest(which, path),
        ),
        null,
      );
    }
  }
});
