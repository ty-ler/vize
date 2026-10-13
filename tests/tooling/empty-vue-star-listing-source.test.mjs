import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  authenticateStarListingSource,
  qualifyStarListingBD,
} from "../../tools/support/compat/github/empty-vue-star-listing-source.mjs";

const root = fs.realpathSync(new URL("../../", import.meta.url));
const manifestPath = "tools/support/compat/github/empty-vue-star-listing-source.json";
const manifest = JSON.parse(fs.readFileSync(path.join(root, manifestPath)));
const rows = manifest.parts.flatMap(([file]) => JSON.parse(fs.readFileSync(path.join(root, file))));
const executing = [manifestPath, ...manifest.parts.map(([file]) => file), ...manifest.executing];
const files = [...rows.map(([file]) => file), ...executing];
const execution = "crates/vize_canon/tests/empty_vue_star_exports/execution.rs";
const sha = (body) => createHash("sha256").update(body).digest("hex");
const pairs = new Map(rows.map(([file, , , before, , , after]) => [file, { before, after }]));
for (const file of executing)
  pairs.set(file, { before: null, after: sha(fs.readFileSync(path.join(root, file))) });
const digest = (side, file) => pairs.get(file)?.[side] ?? null;
const git = (owner, args, input) =>
  execFileSync("git", ["--no-replace-objects", ...args], {
    cwd: owner,
    input,
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, GIT_NO_LAZY_FETCH: "1", GIT_ALLOW_PROTOCOL: "" },
  });
function fixture(run) {
  const owner = fs.mkdtempSync(path.join(os.tmpdir(), "vize-star-listing-refusals-"));
  try {
    git(owner, ["init", "--quiet"]);
    const common = git(root, ["rev-parse", "--git-common-dir"]).toString().trim();
    fs.writeFileSync(
      path.join(owner, ".git/objects/info/alternates"),
      fs.realpathSync(path.resolve(root, common, "objects")) + "\n",
    );
    const head = git(root, ["rev-parse", "HEAD"]).toString().trim();
    git(owner, ["read-tree", head]);
    git(owner, ["update-ref", "refs/heads/current", head]);
    git(owner, ["symbolic-ref", "HEAD", "refs/heads/current"]);
    for (const file of files) {
      const target = path.join(owner, file);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(path.join(root, file), target);
      fs.chmodSync(target, 0o644);
    }
    run(owner, head);
  } finally {
    fs.rmSync(owner, { recursive: true, force: true });
  }
}

await test("the actual BD union admits only one production path after complete current raw source custody", () => {
  const packet = authenticateStarListingSource(root);
  assert.equal(packet.originalStarBodies, 322);
  assert.equal(packet.originalJSBodies, 93);
  assert.equal(packet.runtimeCredit, false);
  assert.equal(packet.original400Credit, false);
  const production = git(root, [
    "diff",
    "--name-only",
    manifest.base,
    "HEAD",
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
  ])
    .toString()
    .trim()
    .split("\n");
  assert.deepEqual(production, [execution]);
  assert.deepEqual(qualifyStarListingBD(production, new Set(), digest)?.files, production);
});

await test("every complete BD counterpart and executing body on both sides refuses drift and absence", () => {
  for (const file of files)
    for (const side of ["before", "after"])
      for (const value of [null, "f".repeat(64)]) {
        if (value === digest(side, file)) continue;
        assert.equal(
          qualifyStarListingBD([execution], new Set(), (s, name) =>
            s === side && name === file ? value : digest(s, name),
          ),
          null,
          side + ":" + file,
        );
      }
  for (const footprint of [
    [],
    [execution, execution],
    [execution, "unknown.rs"],
    [execution, "crates/vize_canon/src/lib.rs"],
  ])
    for (const qualified of [
      new Set(),
      new Set(footprint),
      new Set(["crates/vize_canon/src/lib.rs"]),
    ])
      assert.equal(qualifyStarListingBD(footprint, qualified, digest), null);
  assert.equal(qualifyStarListingBD([execution], new Set([execution]), digest), null);
});

await test("foreign raw bodies, changed entrypoints, hybrid source, modes and replacement refs refuse before replay", () => {
  fixture((owner, head) => {
    assert(authenticateStarListingSource(owner));
    for (const file of [
      execution,
      "tests/performance/support/warm-type-backed-host-qualifications.ts",
      manifest.tests[0][0],
      manifest.executing[0],
      manifestPath,
    ]) {
      const target = path.join(owner, file),
        original = fs.readFileSync(target);
      fs.writeFileSync(target, Buffer.concat([original, Buffer.from("foreign source\n")]));
      assert.throws(() => authenticateStarListingSource(owner));
      fs.writeFileSync(target, original);
      fs.chmodSync(target, 0o755);
      assert.throws(() => authenticateStarListingSource(owner));
      fs.chmodSync(target, 0o644);
      const old = git(root, ["show", manifest.base + ":" + execution]);
      fs.writeFileSync(target, old);
      assert.throws(() => authenticateStarListingSource(owner));
      fs.writeFileSync(target, original);
    }
    const target = path.join(owner, execution),
      original = fs.readFileSync(target);
    git(owner, ["read-tree", head]);
    const changed = git(
      owner,
      ["hash-object", "-w", "--stdin"],
      Buffer.concat([original, Buffer.from("foreign committed source\n")]),
    )
      .toString()
      .trim();
    git(owner, ["update-index", "--cacheinfo", "100644," + changed + "," + execution]);
    const tree = git(owner, ["write-tree"]).toString().trim();
    const foreign = git(
      owner,
      [
        "-c",
        "user.name=Source refusal",
        "-c",
        "user.email=source@invalid.example",
        "commit-tree",
        tree,
        "-p",
        head,
      ],
      "foreign current source\n",
    )
      .toString()
      .trim();
    git(owner, ["update-ref", "refs/heads/current", foreign]);
    fs.writeFileSync(target, Buffer.concat([original, Buffer.from("foreign committed source\n")]));
    assert.throws(() => authenticateStarListingSource(owner));
    git(owner, ["update-ref", "refs/heads/current", head]);
    fs.writeFileSync(target, original);
    git(owner, ["update-ref", "refs/replace/" + head, foreign]);
    assert.throws(() => authenticateStarListingSource(owner));
    git(owner, ["update-ref", "-d", "refs/replace/" + head]);
    assert(authenticateStarListingSource(owner));
  });
});
