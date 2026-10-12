import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { prepare, references } from "./git-authority.mjs";

const graph = "6b665a1e93d59f35ced1be13c30168d86c919aeb";
const parent = "aaf051206778b1f189dcc51386e992eb342ee8b0";
const diagnostic = "tests/tooling/warm-type-backed-diagnostic-authority.test.ts";
const inline = "tests/tooling/warm-type-backed-inline-bucket-authority.test.ts";
const plan = { version: 1, tier: "pr", tests: ["tests/tooling/unrelated.test.ts", diagnostic] };
function workspace(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vize-finite-source-authority-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "tests/performance/support"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "tests/performance/support/warm-type-backed-graph-manifest.json"),
    JSON.stringify({ reviewedSource: graph }),
  );
  return root;
}

void test("only the selected actual shard's finite authority commits are requested", (t) => {
  const root = workspace(t);
  assert.deepEqual(references(plan, "1/2", root), []);
  assert.deepEqual(references(plan, "2/2", root), [graph, parent].sort());
  assert.throws(() => references(plan, "1/4", root));
  assert.throws(() => references({ ...plan, tests: [diagnostic, diagnostic] }, "1/2", root));
  assert.throws(() => references({ ...plan, version: 2 }, "1/2", root));
  assert.throws(() => references({ ...plan, tests: [inline] }, "1/1", root));
  fs.writeFileSync(
    path.join(root, "tests/performance/support/warm-type-backed-graph-manifest.json"),
    JSON.stringify({ reviewedSource: "main" }),
  );
  assert.throws(() => references(plan, "2/2", root));
});

void test("present complete commits cause no fetch, while only missing full SHAs fetch at depth one", (t) => {
  const root = workspace(t);
  const present = new Set([graph]);
  const calls = [];
  const run = (command, args, options) => {
    assert.equal(command, "git");
    assert.equal(options.cwd, root);
    calls.push(args);
    if (args[0] === "fetch") {
      assert.deepEqual(args, ["fetch", "--no-tags", "--depth=1", "origin", parent]);
      present.add(parent);
      return { status: 0, signal: null };
    }
    assert.deepEqual(args.slice(0, 2), ["cat-file", "-e"]);
    return { status: present.has(args[2].slice(0, 40)) ? 0 : 128, signal: null };
  };
  assert.deepEqual(prepare(plan, "2/2", root, run), {
    required: [graph, parent].sort(),
    fetched: [parent],
    shard: "2/2",
  });
  assert.equal(calls.filter(([name]) => name === "fetch").length, 1);
  calls.length = 0;
  assert.deepEqual(prepare(plan, "2/2", root, run).fetched, []);
  assert.equal(calls.filter(([name]) => name === "fetch").length, 0);
  calls.length = 0;
  assert.deepEqual(prepare(plan, "1/2", root, run).required, []);
  assert.equal(calls.length, 0);
});

void test("failed fetch, missing post-fetch commit and original process error remain failures", (t) => {
  const root = workspace(t);
  const failure = new Error("whole owned Git process failure");
  for (const fetchStatus of [17, 0]) {
    assert.throws(() =>
      prepare(plan, "2/2", root, (_command, args) => ({
        status: args[0] === "fetch" ? fetchStatus : 128,
        signal: null,
        stderr: "whole source fetch refusal",
      })),
    );
  }
  assert.throws(
    () => prepare(plan, "2/2", root, () => ({ error: failure, status: null, signal: null })),
    (actual) => actual === failure,
  );
});

void test("only selected inline or allocation source laws request their two explicit diagnostic objects", (t) => {
  const root = workspace(t);
  const before = "e7ec9790a0ec5586588f97d21b8e5913ad01861c";
  const after = "9e5d01d3c1ec7f05bf5631c1b7bde0f24f780f62";
  const file = path.join(
    root,
    "tests/performance/support/allocation-diagnostic/source-manifest.json",
  );
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ originalSource: before, reviewedSource: after }));
  fs.writeFileSync(
    path.join(root, "tests/performance/support/warm-type-backed-inline-bucket-manifest.json"),
    JSON.stringify({ originalSource: graph, reviewedSource: parent }),
  );
  const allocation = "tests/tooling/lsp-allocation-source.test.ts";
  const selected = {
    version: 1,
    tier: "pr",
    tests: ["tests/tooling/unrelated.test.ts", allocation],
  };
  assert.deepEqual(references(selected, "1/2", root), []);
  assert.deepEqual(references(selected, "2/2", root), [before, after].sort());
  assert.deepEqual(
    references({ ...selected, tests: [inline] }, "1/1", root),
    [before, after, graph, parent].sort(),
  );
  const calls = [];
  const present = new Set([before]);
  const run = (_command, args) => {
    calls.push(args);
    if (args[0] === "fetch") {
      assert.deepEqual(args, ["fetch", "--no-tags", "--depth=1", "origin", after]);
      present.add(after);
    }
    return {
      status: args[0] === "fetch" || present.has(args[2].slice(0, 40)) ? 0 : 128,
      signal: null,
    };
  };
  assert.deepEqual(prepare(selected, "2/2", root, run).fetched, [after]);
  assert.equal(calls.filter(([name]) => name === "fetch").length, 1);
  assert.deepEqual(prepare(selected, "2/2", root, run).fetched, []);
  fs.writeFileSync(file, JSON.stringify({ originalSource: before, reviewedSource: "main" }));
  assert.throws(() => references(selected, "2/2", root));
  assert.throws(() => references({ ...selected, tests: [inline] }, "1/1", root));
  fs.rmSync(file);
  assert.throws(() => references(selected, "2/2", root));
  assert.deepEqual(
    references({ ...selected, tests: [inline] }, "1/1", root),
    [graph, parent].sort(),
  );
});
