import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  authenticateCanonProductSource,
  canonProductSourceRevisions,
  canonProductSourcePaths,
  retainedCanonProductSource,
} from "./canon-product-source-context.mjs";

export const canonProductRetainedLaws = Object.freeze([
  "tests/tooling/javascript-sfc-source-context.test.mjs",
  "tests/tooling/javascript-sfc-options-source.test.mjs",
  "tests/tooling/javascript-sfc-star-source.test.mjs",
  "tests/tooling/javascript-sfc-retained-source-views.test.ts",
  "tests/tooling/empty-vue-star-javascript-source.test.mjs",
  "tests/tooling/warm-type-backed-empty-vue-star-custody.test.ts",
  "tests/tooling/warm-type-backed-lexical-dollar-host.test.ts",
  "tests/tooling/native-lexical-dollar-receipt.test.mjs",
]);
const fixtures = new Map();
process.once("exit", () => {
  for (const fixture of fixtures.values())
    fs.rmSync(fixture.root, { recursive: true, force: true });
});
const git = (root, args) =>
  execFileSync(
    "git",
    ["--no-replace-objects", "-c", "gc.auto=0", "-c", "maintenance.auto=false", ...args],
    {
      cwd: root,
      env: { ...process.env, GIT_NO_LAZY_FETCH: "1", GIT_ALLOW_PROTOCOL: "" },
      maxBuffer: 512 * 1024 * 1024,
    },
  );
/** Full current source precedes the complete unchanged original source fixture and Star qualifier. */
export async function canonProductOriginalFixture(root) {
  root = fs.realpathSync(root);
  const receipt = authenticateCanonProductSource(root),
    key = root + "\0" + receipt.head;
  if (fixtures.has(key)) return { ...fixtures.get(key), receipt };
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "vize-canon-product-original-"));
  try {
    const common = fs.realpathSync(
      path.resolve(root, git(root, ["rev-parse", "--git-common-dir"]).toString().trim()),
    );
    const pool = fs.realpathSync(path.join(common, "objects"));
    assert(!/[\r\n]/u.test(pool));
    fs.mkdirSync(path.join(directory, ".git/objects/info"), { recursive: true });
    fs.mkdirSync(path.join(directory, ".git/refs"));
    fs.writeFileSync(
      path.join(directory, ".git/config"),
      '[core]\nrepositoryformatversion = 0\nbare = false\n[gc]\nauto = 0\n[maintenance]\nauto = false\n[remote "origin"]\nurl = https://github.com/ubugeeei-prod/vize.git\n',
    );
    fs.writeFileSync(path.join(directory, ".git/objects/info/alternates"), pool + "\n");
    fs.writeFileSync(
      path.join(directory, ".git/HEAD"),
      canonProductSourceRevisions.original + "\n",
    );
    git(directory, ["checkout", canonProductSourceRevisions.original, "--", "."]);
    for (const file of canonProductSourcePaths) {
      const cell = retainedCanonProductSource(receipt, "original", file),
        target = path.join(directory, file);
      if (!cell) {
        assert(!fs.existsSync(target));
        continue;
      }
      const stat = fs.lstatSync(target);
      assert(stat.isFile() && !stat.isSymbolicLink());
      assert.equal(stat.mode & 0o777, Number.parseInt(cell.mode.slice(3), 8));
      assert.deepEqual(
        fs.readFileSync(target),
        cell.body,
        "whole original source fixture: " + file,
      );
    }
    const dependencies = path.join(path.dirname(common), "node_modules");
    if (fs.existsSync(dependencies)) {
      const target = fs.realpathSync(dependencies);
      assert(fs.statSync(target).isDirectory());
      fs.symlinkSync(target, path.join(directory, "node_modules"), "dir");
    }
    const { authenticateEmptyVueStarJoinedSource } = await import(
      pathToFileURL(
        path.join(directory, "tools/support/compat/github/empty-vue-star-javascript-source.mjs"),
      ).href
    );
    const star = authenticateEmptyVueStarJoinedSource(directory);
    assert.equal(star.completeCurrentBodies, 322);
    const fixture = Object.freeze({ root: directory, head: canonProductSourceRevisions.original });
    fixtures.set(key, fixture);
    return { ...fixture, receipt };
  } catch (error) {
    fs.rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}
export async function importCanonProductRetainedModule(root, file) {
  assert(canonProductRetainedLaws.includes(file), "closed whole original module selection");
  const fixture = await canonProductOriginalFixture(root);
  const original = retainedCanonProductSource(fixture.receipt, "original", file);
  assert(original);
  const target = path.join(fixture.root, file);
  assert.deepEqual(fs.readFileSync(target), original.body);
  return import(pathToFileURL(target).href);
}

export async function importCanonProductMisskeyModule(root) {
  const receipt = authenticateCanonProductSource(root);
  const { canonProductSdkPaths } = await import("./canon-product-main-composition.mjs");
  const { listStarCounterpartFiles, provisionStarSourceCounterpart } =
    await import("./source-counterpart-snapshot.mjs");
  const source = "2da71113a3f8ab528b1a9cda20fc6a4c2bd273f6";
  const names = listStarCounterpartFiles(root, source, canonProductSdkPaths);
  const fixture = provisionStarSourceCounterpart(root, source, names);
  try {
    assert.equal(receipt.head, git(root, ["rev-parse", "HEAD"]).toString().trim());
    process.once("exit", () => fixture.cleanup());
    const original = await import(
      pathToFileURL(path.join(fixture.root, "tests/tooling/misskey-registry-source.test.mjs")).href
    );
    const { after } = await import("node:test");
    after(() => fixture.cleanup());
    return original;
  } catch (error) {
    fixture.cleanup();
    throw error;
  }
}
