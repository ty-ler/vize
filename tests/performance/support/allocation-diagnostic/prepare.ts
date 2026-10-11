import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FROZEN_SOURCE } from "./launch.ts";

/** Two named full objects only; a commit's presence does not qualify its whole source bodies. */
export function prepareAllocationObjects(root: string): string[] {
  const manifest = JSON.parse(
    fs.readFileSync(new URL("./source-manifest.json", import.meta.url), "utf8"),
  );
  assert.equal(manifest.originalSource, FROZEN_SOURCE);
  const refs = [FROZEN_SOURCE, manifest.reviewedSource];
  assert.equal(new Set(refs).size, 2);
  const fetched: string[] = [];
  for (const ref of refs) {
    assert.match(ref, /^[a-f0-9]{40}$/);
    const probe = () =>
      spawnSync("git", ["--no-replace-objects", "cat-file", "-e", `${ref}^{commit}`], {
        cwd: root,
      });
    if (probe().status !== 0) {
      const result = spawnSync(
        "git",
        ["--no-replace-objects", "fetch", "--no-tags", "--depth=1", "origin", ref],
        { cwd: root, encoding: "utf8" },
      );
      assert.equal(result.error, undefined);
      assert.equal(result.signal, null);
      assert.equal(result.status, 0, result.stderr);
      fetched.push(ref);
    }
    assert.equal(probe().status, 0, `named original source object remains unavailable: ${ref}`);
  }
  return fetched;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert.equal(process.argv.length, 2);
  console.log(
    JSON.stringify({
      fetched: prepareAllocationObjects(process.cwd()),
      sourceQualification: "still-required",
    }),
  );
}
