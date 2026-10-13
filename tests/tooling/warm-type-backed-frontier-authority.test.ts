import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  qualifyFrontierHost,
  qualifyFrontierSource,
} from "../performance/support/warm-type-backed-frontier-host.ts";

const manifest = JSON.parse(
  fs.readFileSync(
    new URL("../performance/support/warm-type-backed-frontier-manifest.json", import.meta.url),
    "utf8",
  ),
) as {
  originalSource: string;
  reviewedSource: string;
  files: string[];
  preservedBodies: string[];
  harnessBodies: string[];
  ciBodies: string[];
};
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
for (const row of [
  ...manifest.files,
  ...manifest.preservedBodies,
  ...manifest.harnessBodies,
  ...manifest.ciBodies,
]) {
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

await test("the seven-path frontier successor retains all 208 native predecessors and 45 original workload bodies", () => {
  const receipt = qualifyFrontierHost(production, digest);
  assert.ok(receipt);
  assert.equal(receipt.originalSource, manifest.originalSource);
  assert.equal(receipt.reviewedSource, manifest.reviewedSource);
  assert.equal(receipt.completeBodyPairs, 210);
  assert.equal(receipt.preservedBodyPairs, 45);
  assert.equal(receipt.files.length, 7);
  assert.equal(receipt.completeCiPairs, 21);
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
  assert.deepEqual(actualProduction.toSorted(), receipt.files);
  assert.deepEqual(qualifyFrontierSource(process.cwd(), current), receipt);
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
  for (const row of [
    ...manifest.files,
    ...manifest.preservedBodies,
    ...manifest.harnessBodies,
    ...manifest.ciBodies,
  ]) {
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

await test("raw frontier authority refuses substituted complete bodies and nonregular source modes", (t) => {
  const root = process.cwd();
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "vize-frontier-raw-source-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const run = (...args: string[]) =>
    execFileSync("git", args, {
      cwd: directory,
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "Source control",
        GIT_AUTHOR_EMAIL: "source@example.invalid",
        GIT_COMMITTER_NAME: "Source control",
        GIT_COMMITTER_EMAIL: "source@example.invalid",
      },
    });
  run("init", "--quiet");
  const common = execFileSync("git", ["rev-parse", "--git-common-dir"], {
    cwd: root,
    encoding: "utf8",
  }).trim();
  fs.writeFileSync(
    path.join(directory, ".git/objects/info/alternates"),
    `${path.resolve(root, common, "objects")}\n`,
  );
  const file = "crates/vize_canon/src/batch/virtual_project/dependency_scan/parsed_sources.rs";
  const original = execFileSync(
    "git",
    ["--no-replace-objects", "show", `${manifest.reviewedSource}:${file}`],
    { cwd: root },
  );
  const originalBlob = run("hash-object", "-w", "--stdin");
  // A literal empty blob is not the retained source; the same path cannot lend it.
  run("read-tree", manifest.reviewedSource);
  run("update-index", "--add", "--cacheinfo", `100644,${originalBlob.toString().trim()},${file}`);
  const tree = run("write-tree").toString().trim();
  const forged = run(
    "commit-tree",
    tree,
    "-p",
    manifest.reviewedSource,
    "-m",
    "unreviewed complete source",
  )
    .toString()
    .trim();
  run("replace", forged, manifest.reviewedSource);
  assert.deepEqual(run("show", `${forged}:${file}`), original);
  assert.equal(qualifyFrontierSource(directory, forged), null);
  for (const mode of ["100755", "120000"]) {
    run("read-tree", manifest.reviewedSource);
    const blob = execFileSync(
      "git",
      ["--no-replace-objects", "rev-parse", `${manifest.reviewedSource}:${file}`],
      { cwd: root, encoding: "utf8" },
    ).trim();
    run("update-index", "--add", "--cacheinfo", `${mode},${blob},${file}`);
    const changedTree = run("write-tree").toString().trim();
    const changed = run(
      "commit-tree",
      changedTree,
      "-p",
      manifest.reviewedSource,
      "-m",
      "unreviewed source mode",
    )
      .toString()
      .trim();
    assert.throws(
      () => qualifyFrontierSource(directory, changed),
      /complete regular source required/u,
    );
  }
});
