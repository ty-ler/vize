import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { selectToolingShard } from "../../../tools/support/compat/github/tooling-test-shards.ts";

const authorities = new Map([
  [
    "tests/tooling/warm-type-backed-frontier-authority.test.ts",
    ["warm-type-backed-frontier-manifest.json", ["originalSource", "reviewedSource"]],
  ],
  ["tests/tooling/n8n-authored-editor-layout.test.mjs", [null, []]],
  [
    "tests/tooling/warm-type-backed-graph-authority.test.ts",
    ["warm-type-backed-graph-manifest.json", ["reviewedSource"]],
  ],
  [
    "tests/tooling/warm-type-backed-diagnostic-authority.test.ts",
    ["warm-type-backed-graph-manifest.json", ["reviewedSource"]],
  ],
  [
    "tests/tooling/warm-type-backed-inline-bucket-authority.test.ts",
    ["warm-type-backed-inline-bucket-manifest.json", ["originalSource", "reviewedSource"]],
  ],
  [
    "tests/tooling/lsp-allocation-source.test.ts",
    ["allocation-diagnostic/source-manifest.json", ["originalSource", "reviewedSource"]],
  ],
]);
const diagnosticParent = "aaf051206778b1f189dcc51386e992eb342ee8b0";

export function references(plan, shard, cwd) {
  assert.equal(plan.version, 1);
  assert.ok(["pr", "merge"].includes(plan.tier));
  assert.ok(Array.isArray(plan.tests) && plan.tests.every((test) => typeof test === "string"));
  assert.equal(new Set(plan.tests).size, plan.tests.length);
  const selected = selectToolingShard(plan, shard);
  const refs = new Set();
  for (const test of selected) {
    const authority = authorities.get(test);
    if (!authority) continue;
    if (test === "tests/tooling/n8n-authored-editor-layout.test.mjs") {
      refs.add("b63d18511ce087e5ef9f6b1da17031f258ef7276");
      continue;
    }
    const [file, keys] = authority;
    const manifest = JSON.parse(
      fs.readFileSync(path.join(cwd, "tests/performance/support", file), "utf8"),
    );
    for (const key of keys) {
      assert.match(manifest[key], /^(?!0{40}$)[a-f0-9]{40}$/u);
      refs.add(manifest[key]);
    }
    if (test === "tests/tooling/warm-type-backed-diagnostic-authority.test.ts")
      refs.add(diagnosticParent);
    if (test === "tests/tooling/warm-type-backed-inline-bucket-authority.test.ts") {
      const allocation = path.join(
        cwd,
        "tests/performance/support/allocation-diagnostic/source-manifest.json",
      );
      if (fs.existsSync(allocation))
        for (const key of ["originalSource", "reviewedSource"]) {
          const ref = JSON.parse(fs.readFileSync(allocation, "utf8"))[key];
          assert.match(ref, /^(?!0{40}$)[a-f0-9]{40}$/u);
          refs.add(ref);
        }
      const frontierPath = path.join(
        cwd,
        "tests/performance/support/warm-type-backed-frontier-manifest.json",
      );
      if (fs.existsSync(frontierPath)) {
        const frontier = JSON.parse(
          fs.readFileSync(
            path.join(cwd, "tests/performance/support/warm-type-backed-frontier-manifest.json"),
            "utf8",
          ),
        );
        for (const key of ["originalSource", "reviewedSource"]) {
          assert.match(frontier[key], /^(?!0{40}$)[a-f0-9]{40}$/u);
          refs.add(frontier[key]);
        }
      }
    }
  }
  return [...refs].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
}

export function prepare(plan, shard, cwd = process.cwd(), run = spawnSync) {
  const required = references(plan, shard, cwd);
  const invoke = (args) => run("git", args, { cwd, encoding: "utf8" });
  const present = (sha) => {
    const result = invoke(["cat-file", "-e", `${sha}^{commit}`]);
    if (result.error || result.signal)
      throw result.error ?? new Error(`git terminated: ${result.signal}`);
    return result.status === 0;
  };
  const missing = required.filter((sha) => !present(sha));
  if (missing.length) {
    const fetched = invoke(["fetch", "--no-tags", "--depth=1", "origin", ...missing]);
    assert.equal(fetched.status, 0, fetched.stderr ?? "bounded source fetch failed");
    assert.equal(fetched.signal, null);
    assert.equal(fetched.error, undefined);
  }
  for (const sha of required) assert.ok(present(sha), `missing complete authority commit: ${sha}`);
  return { required, fetched: missing, shard };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [plan, shard] = process.argv.slice(2);
  assert.ok(plan && shard && process.argv.length === 4);
  process.stdout.write(
    `${JSON.stringify(prepare(JSON.parse(fs.readFileSync(plan, "utf8")), shard))}\n`,
  );
}
