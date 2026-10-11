import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import test from "node:test";
import { qualifyDiagnosticHost } from "../performance/support/warm-type-backed-diagnostic-host.ts";

const manifest = JSON.parse(
  fs.readFileSync(
    new URL("../performance/support/warm-type-backed-graph-manifest.json", import.meta.url),
    "utf8",
  ),
) as { files: string[]; preservedBodies: string[] };
const original = "aaf051206778b1f189dcc51386e992eb342ee8b0";
const reviewed = "6b665a1e93d59f35ced1be13c30168d86c919aeb";
const production = execFileSync(
  "git",
  [
    "diff",
    "--name-only",
    original,
    reviewed,
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
for (const file of [...manifest.files, ...manifest.preservedBodies].map(
  (row) => row.split("\t")[0],
)) {
  for (const [side, source] of [
    ["before", original],
    ["after", reviewed],
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

test("the two-path diagnostic Stack delta retains all 195 actual producer and 45 original bodies", () => {
  const receipt = qualifyDiagnosticHost(production, digest);
  assert.ok(receipt);
  assert.equal(receipt.originalSource, original);
  assert.equal(receipt.reviewedSource, reviewed);
  assert.equal(receipt.completeBodyPairs, 195);
  assert.equal(receipt.preservedBodyPairs, 45);
  assert.equal(receipt.files.length, 2);
});

test("missing, duplicate or extra producers and every complete body mutation refuse", () => {
  for (const changed of [
    [],
    production.slice(1),
    [...production, production[0]],
    [...production, "crates/vize_canon/src/omitted.rs"],
  ])
    assert.equal(qualifyDiagnosticHost(changed, digest), null);
  for (const row of [...manifest.files, ...manifest.preservedBodies]) {
    const file = row.split("\t")[0];
    for (const side of ["before", "after"] as const)
      assert.equal(
        qualifyDiagnosticHost(production, (which, path) =>
          which === side && path === file ? "0".repeat(64) : digest(which, path),
        ),
        null,
      );
  }
});
