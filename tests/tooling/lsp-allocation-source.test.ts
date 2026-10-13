import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { qualifyFrontierHost } from "../performance/support/warm-type-backed-frontier-host.ts";
import { gitBodyDigest } from "../performance/support/warm-type-backed-path-host.ts";
import { sha256 } from "../differential/sha256.ts";
import { rawGit } from "../performance/support/allocation-diagnostic/build.ts";
import { prepareAllocationObjects } from "../performance/support/allocation-diagnostic/prepare.ts";
import {
  manifest,
  rows,
  rawBody,
  rawProduction,
  qualifyAllocationHost,
  qualifyAllocationSource,
} from "../performance/support/allocation-diagnostic/source.ts";

const root = process.cwd();
const bodies = new Map<string, string | null>();
for (const [file] of rows)
  for (const [side, revision] of [
    ["before", manifest.originalSource],
    ["after", manifest.reviewedSource],
  ] as const) {
    const bytes = rawBody(root, revision, file);
    bodies.set(`${side}:${file}`, bytes === null ? null : sha256(bytes));
  }
const digest = (side: "before" | "after", file: string) => bodies.get(`${side}:${file}`) ?? null;
const production = rawProduction(root, manifest.reviewedSource);

test("the exact optional source successor requires all208 native, original45 and finite whole harness pairs", () => {
  const receipt = qualifyAllocationHost(production, digest);
  assert(receipt);
  assert.equal(receipt.nativeBodies, 208);
  assert.equal(receipt.originalMandatoryBodies, 45);
  assert.equal(receipt.nativeDelta.length, 9);
  assert.equal(receipt.acceptanceCredit, "none");
  const actual = rawGit(root, "rev-parse", "HEAD").toString().trim();
  const original = qualifyAllocationSource(root, actual);
  if (original) assert.deepEqual(original, receipt);
  else {
    const base = "3dd6ae0707dc42302638257b86967d6a6ffe902f";
    const production = rawGit(
      root,
      "diff",
      "--name-only",
      base,
      actual,
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
    )
      .toString()
      .trim()
      .split("\n");
    const frontier = qualifyFrontierHost(production, (side, file) =>
      gitBodyDigest(root, side === "before" ? base : actual, file),
    );
    assert(frontier, "the separate complete exact-parent frontier source must qualify");
    assert.equal(frontier.completeBodyPairs, 210);
    assert.equal(frontier.preservedBodyPairs, 45);
    assert.equal(frontier.preservedHarnessPairs, 31);
    assert.equal(frontier.acceptanceCredit, "none");
  }
});

test("missing, extra or duplicate native producers and every old/new complete body remain refusals", () => {
  for (const changed of [
    [],
    production.slice(1),
    [...production, production[0]],
    [...production, "crates/vize_canon/src/unreviewed.rs"],
  ])
    assert.equal(qualifyAllocationHost(changed, digest), null);
  for (const [file] of rows)
    for (const side of ["before", "after"] as const) {
      assert.equal(
        qualifyAllocationHost(production, (which, name) =>
          which === side && name === file ? "0".repeat(64) : digest(which, name),
        ),
        null,
        `${side} whole ${file}`,
      );
      if (digest(side, file) !== null)
        assert.equal(
          qualifyAllocationHost(production, (which, name) =>
            which === side && name === file ? null : digest(which, name),
          ),
          null,
          `${side} missing ${file}`,
        );
    }
});

test("a genuine replacement object cannot lend reviewed source or hide an extra allocator producer", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "vize-allocation-replacement-law-"));
  try {
    rawGit(directory, "init", "--quiet");
    const common = path.resolve(
      root,
      rawGit(root, "rev-parse", "--git-common-dir").toString().trim(),
    );
    fs.writeFileSync(
      path.join(directory, ".git/objects/info/alternates"),
      `${path.join(common, "objects")}\n`,
    );
    assert.deepEqual(prepareAllocationObjects(directory), []);
    const accepted = rawGit(root, "rev-parse", "HEAD").toString().trim();
    assert(qualifyAllocationSource(root, accepted));
    rawGit(directory, "read-tree", accepted);
    const file = "crates/vize/src/main.rs";
    const original = rawBody(root, manifest.reviewedSource, file)!;
    const altered = Buffer.concat([
      original,
      Buffer.from("\n// unreviewed complete allocator producer\n"),
    ]);
    const blob = execFileSync("git", ["--no-replace-objects", "hash-object", "-w", "--stdin"], {
      cwd: directory,
      input: altered,
    })
      .toString()
      .trim();
    rawGit(directory, "update-index", "--add", "--cacheinfo", `100644,${blob},${file}`);
    const tree = rawGit(directory, "write-tree").toString().trim();
    const forged = execFileSync(
      "git",
      ["--no-replace-objects", "commit-tree", tree, "-p", accepted],
      {
        cwd: directory,
        input: "owned replacement borrowing control\n",
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: "Source Control",
          GIT_AUTHOR_EMAIL: "source-control@example.invalid",
          GIT_COMMITTER_NAME: "Source Control",
          GIT_COMMITTER_EMAIL: "source-control@example.invalid",
        },
      },
    )
      .toString()
      .trim();
    rawGit(directory, "replace", forged, accepted);
    assert.deepEqual(
      execFileSync("git", ["show", `${forged}:${file}`], { cwd: directory }),
      original,
      "the genuine replacement demonstrably lends the good whole body",
    );
    assert.deepEqual(rawBody(directory, forged, file), altered);
    assert(rawProduction(directory, forged).includes(file));
    assert.equal(qualifyAllocationSource(directory, forged), null);
    assert.equal(rawProduction(directory, manifest.reviewedSource).includes(file), false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("the finite source successor refuses executable and symlink modes even with whole matching blobs", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "vize-allocation-mode-law-"));
  try {
    rawGit(directory, "init", "--quiet");
    const common = path.resolve(
      root,
      rawGit(root, "rev-parse", "--git-common-dir").toString().trim(),
    );
    fs.writeFileSync(
      path.join(directory, ".git/objects/info/alternates"),
      `${path.join(common, "objects")}\n`,
    );
    const file = "crates/vize_canon/src/corsa_bridge/preparation_trace.rs";
    const blob = rawGit(root, "rev-parse", `${manifest.reviewedSource}:${file}`).toString().trim();
    for (const mode of ["100755", "120000"]) {
      rawGit(directory, "read-tree", manifest.reviewedSource);
      rawGit(directory, "update-index", "--add", "--cacheinfo", `${mode},${blob},${file}`);
      const tree = rawGit(directory, "write-tree").toString().trim();
      assert.throws(() => rawBody(directory, tree, file), /100644 blob/);
    }
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
