import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { qualifyGraphHost } from "../performance/support/warm-type-backed-graph-host.ts";
import { qualifyHostMoves } from "../performance/support/warm-type-backed-host-qualifications.ts";
import { gitBodyDigest } from "../performance/support/warm-type-backed-path-host.ts";

const manifest = JSON.parse(
  fs.readFileSync(
    new URL("../performance/support/warm-type-backed-graph-manifest.json", import.meta.url),
    "utf8",
  ),
) as { files: string[]; preservedBodies: string[] };
const pairs = manifest.files.map((row) => row.split("\t"));
const preserved = manifest.preservedBodies.map((row) => row.split("\t"));
const files = pairs.map(([file]) => file);
const original = (side: "before" | "after", file: string) => {
  const pair = pairs.find(([candidate]) => candidate === file);
  if (pair) return pair[side === "before" ? 1 : 2] === "-" ? null : pair[side === "before" ? 1 : 2];
  return preserved.find(([candidate]) => candidate === file)?.[1] ?? null;
};

await test("the complete graph qualification retains all actual after blobs and original inputs", () => {
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
  const actual = (side: "before" | "after", file: string) => {
    if (side === "before") return original(side, file);
    const full = path.join(root, file);
    if (!fs.existsSync(full)) return null;
    assert.ok(fs.lstatSync(full).isFile());
    return createHash("sha256").update(fs.readFileSync(full)).digest("hex");
  };
  const receipt = qualifyGraphHost(files, actual);
  assert.ok(receipt);
  assert.equal(receipt.completeBodyPairs, 190);
  assert.equal(receipt.preservedBodyPairs, 45);
  assert.deepEqual(receipt.files, files);
  assert.deepEqual(qualifyHostMoves(files, new Set(), true, actual), {
    graphHost: receipt,
    pathHostMove: null,
    timingHostMove: null,
    defaultMigrationHost: null,
  });
});

await test("every missing, duplicate and unlisted producer entry refuses qualification", () => {
  for (const file of files)
    assert.equal(
      qualifyGraphHost(
        files.filter((candidate) => candidate !== file),
        original,
      ),
      null,
    );
  assert.equal(qualifyGraphHost([...files, files[0]], original), null);
  assert.equal(qualifyGraphHost([...files, "crates/vize_canon/src/unreviewed.rs"], original), null);
  assert.equal(qualifyGraphHost([], original), null);
});

await test("changing any complete producer or preserved workload body refuses on either side", () => {
  for (const side of ["before", "after"] as const) {
    for (const file of [...files, ...preserved.map(([file]) => file)]) {
      const changed = (observedSide: "before" | "after", observedFile: string) =>
        observedSide === side && observedFile === file
          ? "0".repeat(64)
          : original(observedSide, observedFile);
      assert.equal(qualifyGraphHost(files, changed), null, `${side}:${file}`);
    }
  }
});

await test("same file bytes under an executable mode or symlink remain unqualified", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vize-graph-git-entry-"));
  try {
    const git = (...args: string[]) =>
      execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
    git("init", "--quiet");
    fs.writeFileSync(path.join(root, "entry.ts"), "export const value = 1;\n");
    const record = () => {
      git("add", "--", "entry.ts");
      git(
        "-c",
        "user.name=Local fixture",
        "-c",
        "user.email=fixture@example.invalid",
        "commit",
        "--quiet",
        "-m",
        "fixture",
      );
      return git("rev-parse", "HEAD");
    };
    const ordinary = record();
    const digest = createHash("sha256")
      .update(fs.readFileSync(path.join(root, "entry.ts")))
      .digest("hex");
    assert.equal(gitBodyDigest(root, ordinary, "entry.ts"), digest);
    assert.equal(gitBodyDigest(root, ordinary, "absent.ts"), null);
    git("update-index", "--chmod=+x", "entry.ts");
    git(
      "-c",
      "user.name=Local fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "commit",
      "--quiet",
      "-m",
      "mode",
    );
    const executable = git("rev-parse", "HEAD");
    assert.throws(() => gitBodyDigest(root, executable, "entry.ts"), /regular source blob/u);
    fs.unlinkSync(path.join(root, "entry.ts"));
    fs.symlinkSync("absent.ts", path.join(root, "entry.ts"));
    const symlink = record();
    assert.throws(() => gitBodyDigest(root, symlink, "entry.ts"), /regular source blob/u);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
