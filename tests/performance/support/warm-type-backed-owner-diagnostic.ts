import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { qualifyProjectConfigHost } from "./warm-type-backed-project-config-host.ts";
import { runOwnerResolveFixture } from "./warm-type-backed-owner-resolve.ts";
import {
  driverRoot,
  git,
  inputAuthority,
  sha256,
  sourceIdentity,
} from "./warm-type-backed-source.ts";

// These literal source objects are diagnostic custody, never a released cut or a primary pass.
const baseline = "7386b2a79604ae5b74cb541be911eb19735e68b2";
const head = "485f20ff1eee408d3c12d5a29cf091be30375873";
const actualParent = "a73e1c02d67a4f52f638be1bd287d5acb80f7467";
const actualMain = "3b6dcd36ceb78313b15f9c17e2b6830bd753bd85";
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
  for (const source of [baseline, head, actualParent, actualMain]) {
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
  const manifest = JSON.parse(
    fs.readFileSync(
      new URL("./warm-type-backed-project-config-manifest.json", import.meta.url),
      "utf8",
    ),
  );
  assert.equal(
    sha256(JSON.stringify(manifest)),
    "433e284764244dd3e171ff3513552054dbbd28b7b9603866c25871fc1dd904fc",
  );
  for (const [file, original, reviewed] of [
    ...manifest.files,
    ...manifest.preservedBodies,
    ...manifest.harnessExtensions,
  ]) {
    assert.equal(digest(baseline, file), original, `complete original body ${file}`);
    assert.equal(digest(head, file), reviewed, `complete actual body ${file}`);
  }
  const configFiles = manifest.files.map(([file]: [string]) => file);
  const authority = qualifyProjectConfigHost(configFiles, new Set(), (side, file) =>
    digest(side === "before" ? baseline : head, file),
  );
  assert.ok(
    authority,
    "every original 90/51/current3 body must qualify before either diagnostic build",
  );
  for (const [file, beforeDigest] of [
    ...manifest.files,
    ...manifest.preservedBodies,
    ...manifest.harnessExtensions,
  ])
    assert.equal(
      digest(actualParent, file),
      beforeDigest,
      "fresh real parent retains the entire original authority",
    );
  assert.equal(git(driverRoot, ["merge-base", actualParent, head]), actualParent);
  assert.equal(git(driverRoot, ["merge-base", actualMain, head]), actualMain);
  const production = git(driverRoot, [
    "diff",
    "--name-only",
    baseline,
    head,
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
    .split("\n")
    .filter(Boolean);
  const inheritedMain = production
    .filter((file) => !configFiles.includes(file))
    .map((file) => {
      assert.equal(digest(head, file), digest(actualParent, file));
      assert.equal(
        digest(head, file),
        digest(actualMain, file),
        "every additional body must be exact actual merged-main source",
      );
      return {
        file,
        beforeSHA256: digest(baseline, file),
        actualMainSHA256: digest(actualMain, file),
        afterSHA256: digest(head, file),
      };
    });
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
  const helpers = [
    "tests/performance/support/warm-type-backed-owner-diagnostic.ts",
    "tests/performance/support/warm-type-backed-owner-tracer.ts",
    "tests/performance/support/warm-type-backed-owner-live-process.ts",
    "tests/performance/support/warm-type-backed-owner-lifecycle.ts",
    "tests/performance/support/warm-type-backed-owner-trace-custody.ts",
    "tests/performance/support/warm-type-backed-owner-write-epochs.ts",
    "tests/performance/support/warm-type-backed-owner-retirement.ts",
    "tests/performance/support/warm-type-backed-owner-protocol-stream.ts",
    "tests/performance/support/warm-type-backed-owner-socket-traffic.ts",
    "tests/performance/support/warm-type-backed-owner-syscalls.ts",
    "tests/performance/support/warm-type-backed-owner-kernel-string.ts",
    "tests/performance/support/warm-type-backed-owner-resolve.ts",
    "tests/tooling/warm-type-backed-owner-syscalls.test.ts",
    "tests/tooling/warm-type-backed-owner-kernel-string.test.ts",
    "tests/tooling/warm-type-backed-owner-lifecycle.test.ts",
    "tests/tooling/warm-type-backed-owner-write-epochs.test.ts",
    "tests/tooling/support/warm-type-backed-owner-lifecycle-fixture.ts",
    "tests/tooling/support/warm-type-backed-owner-kernel-fixture.ts",
  ].map((file) => {
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
        inheritedActualMain: { source: actualMain, bodies: inheritedMain },
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
