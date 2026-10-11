import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { test } from "node:test";
import {
  qualifyProjectConfigRuntimeRepairHost,
  runtimeRepairManifest as repair,
} from "../performance/support/warm-type-backed-project-config-runtime-repair.ts";
import { qualifyConfigRepairedReviewHost } from "../performance/support/warm-type-backed-config-repair-host.ts";
import { qualifyIssuedCompletionHost } from "../performance/support/warm-type-backed-issued-completion-host.ts";
import { reviewedConfigProduction as production } from "./support/config-reviewed-source.ts";

type Side = "before" | "after";
type Digest = (side: Side, file: string) => string | null;
const root = new URL("../../", import.meta.url);
const source = "877bc0eba89879ca08ef13fb192c4334c1a5ff32";
const baseline = "a23eca4ad51adaf897922c46cc7c7e57cf062269";
const cache = new Map<string, string | null>();
const literal: Digest = (side, file) => {
  const key = `${side}:${file}`;
  if (!cache.has(key)) {
    const result = spawnSync("git", ["show", `${side === "before" ? baseline : source}:${file}`], {
      cwd: root,
    });
    assert.ok(result.status === 0 || result.status === 128);
    cache.set(
      key,
      result.status === 0 ? createHash("sha256").update(result.stdout).digest("hex") : null,
    );
  }
  return cache.get(key)!;
};
const bodies = new Map(repair.inheritedBodies.map(([file, , after]) => [file, after]));
const fixed: Digest = (side, file) => bodies.get(file) ?? literal(side, file);
const original = (production: string[], owned: ReadonlySet<string>, digest: Digest) =>
  qualifyConfigRepairedReviewHost(production, owned, digest, qualifyIssuedCompletionHost);
const qualify = (digest: Digest = fixed, files = production) =>
  qualifyProjectConfigRuntimeRepairHost(files, new Set(), digest, original);

test("the exact preceding Windows commit authenticates both complete inherited loader bodies", () => {
  for (const revision of [repair.originalSource, repair.repairedSource, baseline, source]) {
    if (spawnSync("git", ["cat-file", "-e", `${revision}^{commit}`], { cwd: root }).status !== 0) {
      const fetched = spawnSync("git", ["fetch", "--no-tags", "--depth=1", "origin", revision], {
        cwd: root,
      });
      assert.equal(fetched.status, 0, fetched.stderr.toString());
    }
  }
  for (const [file, before, after] of repair.inheritedBodies)
    for (const [revision, expected] of [
      [repair.originalSource, before],
      [repair.repairedSource, after],
    ]) {
      const result = spawnSync("git", ["show", `${revision}:${file}`], { cwd: root });
      assert.equal(result.status, 0, result.stderr.toString());
      assert.equal(createHash("sha256").update(result.stdout).digest("hex"), expected);
    }
});

test("fixed inherited runtime preserves the complete original112/96/51/3 source witness", () => {
  const result = qualify();
  assert.ok(result && "projectConfigRuntimeRepairContext" in result);
  assert.equal(result.files.length, 112);
  assert.equal(result.completeBodyPairs, 96);
  assert.equal(result.preservedBodyPairs, 51);
  assert.equal(result.harnessExtensions.length, 3);
  assert.equal(result.configRepairContext.completeProductionBodyPairs.length, 7);
  assert.deepEqual(
    result.projectConfigRuntimeRepairContext.completeInheritedBodies,
    repair.inheritedBodies,
  );
});

test("historical complete loader/source qualification retains its original receipt", () => {
  const result = qualify(literal);
  assert.ok(result && !("projectConfigRuntimeRepairContext" in result));
});

test("either missing or changed inherited loader body on either side refuses", () => {
  for (const [file] of repair.inheritedBodies)
    for (const side of ["before", "after"] as const)
      for (const corrupt of [null, "0".repeat(64)])
        assert.equal(
          qualify((candidate, name) =>
            candidate === side && name === file ? corrupt : fixed(candidate, name),
          ),
          null,
        );
});

test("the Windows source change itself cannot authorize a config child or any foreign source", () => {
  const [runtime, before] = repair.inheritedBodies[1];
  assert.equal(
    qualify((side, file) => (side === "before" && file === runtime ? before : fixed(side, file))),
    null,
  );
  for (const files of [
    production.slice(1),
    [...production, production[0]],
    [...production, runtime],
    [...production, "crates/foreign.rs"],
  ])
    assert.equal(qualify(fixed, files), null);
  assert.equal(
    qualifyProjectConfigRuntimeRepairHost(production, new Set(), fixed, () => null),
    null,
  );
});
