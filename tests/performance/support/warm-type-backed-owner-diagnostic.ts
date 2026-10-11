import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { qualifyCurrentOwnerSourceContext } from "./warm-type-backed-owner-current-context-host.ts";
import { ownerCurrentContext } from "./warm-type-backed-owner-current-context.ts";
import { ownerDriverBodies } from "./warm-type-backed-owner-driver-bodies.ts";
import { runOwnerResolveFixture } from "./warm-type-backed-owner-resolve.ts";
import {
  driverRoot,
  git,
  inputAuthority,
  sha256,
  sourceIdentity,
} from "./warm-type-backed-source.ts";

// These literal source objects are diagnostic custody, never a released cut or a primary pass.
const { baseline, head, actualParent, actualMain, publicBaseline, compositionBase } =
  ownerCurrentContext.sources;
assert.equal(process.platform, "linux");
assert.ok(process.env.RUNNER_TEMP && process.env.GITHUB_WORKSPACE);
assert.equal(fs.realpathSync(process.env.GITHUB_WORKSPACE), driverRoot);
const output = path.join(process.env.RUNNER_TEMP, "warm-pair");
const before = path.join(process.env.RUNNER_TEMP, "warm-before");
const afterRoot = path.join(process.env.RUNNER_TEMP, "warm-owner-after");

function digest(source: string, file: string) {
  const result = spawnSync("git", ["show", `${source}:${file}`], { cwd: driverRoot });
  return result.status === 0 ? sha256(result.stdout) : null;
}

if (process.argv[2] === "prepare") {
  const driver = sourceIdentity(driverRoot);
  assert.equal(driver.dirty, "");
  assert.equal(driver.revision, process.env.GITHUB_SHA);
  assert.equal(driver.revision, process.env.GITHUB_WORKFLOW_SHA);
  // A full live-ref checkout need not retain force-pushed historical source objects.
  for (const source of [
    baseline,
    head,
    actualParent,
    actualMain,
    publicBaseline,
    compositionBase,
  ]) {
    const present = spawnSync("git", ["cat-file", "-e", `${source}^{commit}`], {
      cwd: driverRoot,
    });
    if (present.status !== 0) {
      const fetched = spawnSync("git", ["fetch", "--no-tags", "origin", source], {
        cwd: driverRoot,
        encoding: "utf8",
      });
      assert.equal(fetched.status, 0, `literal source ${source}: ${fetched.stderr}`);
    }
    assert.equal(git(driverRoot, ["rev-parse", `${source}^{commit}`]), source);
  }
  for (const [key, source] of Object.entries(ownerCurrentContext.sources))
    assert.equal(
      git(driverRoot, ["rev-parse", `${source}^{tree}`]),
      ownerCurrentContext.trees[key as keyof typeof ownerCurrentContext.trees],
    );
  assert.equal(git(driverRoot, ["merge-base", actualParent, head]), actualParent);
  assert.equal(git(driverRoot, ["merge-base", actualMain, head]), actualMain);
  assert.equal(git(driverRoot, ["merge-base", compositionBase, head]), compositionBase);
  const production = git(driverRoot, [
    "diff",
    "--name-only",
    baseline,
    head,
    "--",
    ...ownerCurrentContext.productionPaths,
  ])
    .split("\n")
    .filter(Boolean);
  const mode = (source: string, file: string) => {
    const row = git(driverRoot, ["ls-tree", source, "--", file]);
    if (!row) return null;
    const match = row.match(/^(100644|100755) blob [a-f0-9]{40}\t(.+)$/u);
    assert.ok(match && match[2] === file, "whole single blob Git entry is required");
    return match[1];
  };
  const authority = qualifyCurrentOwnerSourceContext(production, digest, mode);
  assert.ok(
    authority,
    "all original119/90/51/3/4, issued7, explicit loader2 and complete inherited bodies must qualify",
  );
  assert.ok(!fs.existsSync(output) && !fs.existsSync(before) && !fs.existsSync(afterRoot));
  fs.mkdirSync(output);
  for (const [directory, source] of [
    [before, baseline],
    [afterRoot, head],
  ]) {
    const result = spawnSync("git", ["worktree", "add", "--detach", directory, source], {
      cwd: driverRoot,
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
  }
  const helpers = ownerDriverBodies.map((file) => {
    const sourceSHA256 = digest(driver.revision, file);
    assert.equal(sha256(fs.readFileSync(path.join(driverRoot, file))), sourceSHA256);
    return { file, sourceSHA256 };
  });
  fs.writeFileSync(
    path.join(output, "workflow-source.json"),
    `${JSON.stringify(
      {
        authority: "private-original-native-api-owner-diagnostic",
        scope:
          "supplemental original79-plus16 replay only; primary original20-field comparison stays red",
        head,
        base: actualParent,
        baseline,
        afterRoot,
        production,
        driverSource: driver,
        originalConfigAuthority: authority,
        inheritedActualSource: {
          main: actualMain,
          lowerStack: publicBaseline,
          parent: actualParent,
          bodies: authority.inheritedBodies,
          loaderMigration: authority.loaderMigration,
        },
        originalInputAuthority: inputAuthority(),
        helpers,
      },
      null,
      2,
    )}\n`,
  );
} else if (process.argv[2] === "measure") {
  const binding = JSON.parse(fs.readFileSync(path.join(output, "workflow-source.json"), "utf8"));
  assert.deepEqual(sourceIdentity(driverRoot), binding.driverSource);
  const results = [];
  for (const [side, root] of [
    ["before", before],
    ["after", afterRoot],
  ]) {
    assert.equal(git(root, ["rev-parse", "HEAD"]), side === "before" ? baseline : head);
    const custody = JSON.parse(
      fs.readFileSync(path.join(output, `${side}-cargo-custody.json`), "utf8"),
    );
    assert.equal(custody.source.revision, side === "before" ? baseline : head);
    const binary = path.join(root, "target/ci/vize");
    assert.equal(sha256(fs.readFileSync(binary)), custody.binarySha256);
    results.push(
      await runOwnerResolveFixture(
        root,
        path.join(output, "workspace"),
        path.join(output, `owner-${side}`),
        true,
      ),
    );
  }
  fs.writeFileSync(
    path.join(output, "owner-diagnostic-pair.json"),
    `${JSON.stringify(results, null, 2)}\n`,
  );
  assert.deepEqual(
    results[1].refusalFailures,
    [],
    "all current stale/foreign/retired whole-item controls remain required",
  );
} else throw new Error("usage: warm-type-backed-owner-diagnostic.ts prepare|measure");
