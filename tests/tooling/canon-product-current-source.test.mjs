import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
import {
  authenticateCanonProductSource,
  retainedCanonProductSource,
  canonProductSourcePaths,
} from "../../tools/support/compat/github/canon-product-source-context.mjs";
import {
  canonProductOriginalFixture,
  canonProductRetainedLaws,
} from "../../tools/support/compat/github/canon-product-retained-source-runner.mjs";

const root = path.resolve(import.meta.dirname, "../..");
void test("whole current release source binds every unchanged original JS and Star module", async () => {
  const fixture = await canonProductOriginalFixture(root);
  assert.equal(fixture.receipt.completeBodies, 426);
  assert.equal(canonProductRetainedLaws.length, 8);
  for (const file of canonProductRetainedLaws) {
    const cell = retainedCanonProductSource(fixture.receipt, "original", file);
    assert(cell);
    assert.deepEqual(fs.readFileSync(path.join(fixture.root, file)), cell.body);
  }
  assert.equal(fixture.receipt.runtimeCredit, false);
  assert.equal(fixture.receipt.performanceCredit, false);
});

void test("new source receipts refuse forgery unknown paths and mutable borrowed bodies", () => {
  const receipt = authenticateCanonProductSource(root);
  const file = "crates/vize_canon/src/batch/source_policy.rs";
  const first = retainedCanonProductSource(receipt, "original", file);
  first.body[0] ^= 1;
  assert.notDeepEqual(first.body, retainedCanonProductSource(receipt, "original", file).body);
  assert.throws(() => retainedCanonProductSource({ ...receipt }, "original", file));
  assert.throws(() => retainedCanonProductSource(receipt, "current", file));
  assert.throws(() => retainedCanonProductSource(receipt, "original", "unknown/source.rs"));
});
void test("private physical mutation missing mode and ancestor symlink refuse before a source view", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "vize-release-source-refusals-"));
  const git = (args, input) =>
    execFileSync("git", ["--no-replace-objects", ...args], {
      cwd: directory,
      input,
      maxBuffer: 16 * 1024 * 1024,
    });
  try {
    const common = execFileSync("git", ["rev-parse", "--git-common-dir"], { cwd: root })
      .toString()
      .trim();
    const pool = fs.realpathSync(path.resolve(root, common, "objects"));
    fs.mkdirSync(path.join(directory, ".git/objects/info"), { recursive: true });
    fs.mkdirSync(path.join(directory, ".git/refs"));
    fs.writeFileSync(
      path.join(directory, ".git/config"),
      "[core]\nrepositoryformatversion = 0\nbare = false\n",
    );
    const actualHead = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root }).toString().trim();
    fs.writeFileSync(path.join(directory, ".git/HEAD"), actualHead + "\n");
    fs.writeFileSync(path.join(directory, ".git/objects/info/alternates"), pool + "\n");
    for (const file of canonProductSourcePaths) {
      const target = path.join(directory, file);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(path.join(root, file), target);
      fs.chmodSync(target, fs.statSync(path.join(root, file)).mode & 0o777);
    }
    assert.equal(authenticateCanonProductSource(directory).completeBodies, 426);
    const name = "crates/vize_canon/src/batch/source_policy.rs",
      file = path.join(directory, name),
      body = fs.readFileSync(file);
    fs.writeFileSync(file, Buffer.concat([body, Buffer.from("\n")]));
    assert.throws(() => authenticateCanonProductSource(directory));
    fs.writeFileSync(file, body);
    fs.chmodSync(file, 0o755);
    assert.throws(() => authenticateCanonProductSource(directory));
    fs.chmodSync(file, 0o644);
    fs.unlinkSync(file);
    assert.throws(() => authenticateCanonProductSource(directory));
    fs.symlinkSync("missing.rs", file);
    assert.throws(() => authenticateCanonProductSource(directory));
    fs.unlinkSync(file);
    fs.writeFileSync(file, body);
    const ancestor = path.join(directory, "crates"),
      moved = path.join(directory, "crates-original");
    fs.renameSync(ancestor, moved);
    fs.symlinkSync(moved, ancestor);
    assert.throws(() => authenticateCanonProductSource(directory));
    fs.unlinkSync(ancestor);
    fs.renameSync(moved, ancestor);
    git(["read-tree", "HEAD"]);
    const foreign = "crates/vize_canon/src/release_foreign_source.rs";
    fs.writeFileSync(path.join(directory, foreign), "pub const FOREIGN: bool = true;\n");
    git(["add", "--", foreign]);
    const tree = git(["write-tree"]).toString().trim();
    const commit = git(
      [
        "-c",
        "user.name=Source custody",
        "-c",
        "user.email=source-custody@example.invalid",
        "commit-tree",
        tree,
        "-p",
        actualHead,
      ],
      "foreign source refusal\n",
    )
      .toString()
      .trim();
    fs.writeFileSync(path.join(directory, ".git/HEAD"), commit + "\n");
    assert.throws(() => authenticateCanonProductSource(directory), /foreign source outside/u);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
