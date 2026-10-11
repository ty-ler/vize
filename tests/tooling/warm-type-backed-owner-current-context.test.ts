import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { componentContextManifest as original } from "../performance/support/warm-type-backed-component-context-manifest.ts";
import { issuedCompletionManifest as issued } from "../performance/support/warm-type-backed-issued-completion-host.ts";
import { ownerCurrentContext as context } from "../performance/support/warm-type-backed-owner-current-context.ts";
import { qualifyCurrentOwnerSourceContext as qualify } from "../performance/support/warm-type-backed-owner-current-context-host.ts";

const trees = new Map<string, Map<string, { mode: string; oid: string }>>();
const bytes = new Map<string, string>();
const files = [
  ...new Set(
    [
      ...original.inheritedProductionBodies,
      ...original.componentBodies,
      ...original.inheritedCustodyBodies,
      ...original.inheritedHarnessExtensions,
      ...original.originalComponentBodies,
      ...issued.producerBodies,
      ...context.inheritedBodies,
      ...context.loaderMigration,
    ]
      .map(([file]) => {
        assert.ok(typeof file === "string", "a closed Git query needs actual source paths");
        return file;
      })
      .concat(
        "tests/performance/support/warm-type-backed-project-config-null-completion-manifest.json",
        "tests/performance/support/warm-type-backed-issued-completion-manifest.json",
      ),
  ),
].toSorted();
function entry(source: string, file: string) {
  if (!trees.has(source)) {
    const tree = execFileSync("git", ["ls-tree", "-r", "-z", source, "--", ...files], {
      encoding: "utf8",
    });
    trees.set(
      source,
      new Map(
        tree
          .split("\0")
          .filter(Boolean)
          .map((row) => {
            const match = row.match(/^(\d+) (?:blob|commit) ([a-f0-9]{40})\t(.+)$/u);
            assert.ok(match);
            return [match[3], { mode: match[1], oid: match[2] }];
          }),
      ),
    );
  }
  return trees.get(source)!.get(file);
}
function digest(source: string, file: string) {
  const item = entry(source, file);
  if (!item) return null;
  assert.match(item.mode, /^100(?:644|755)$/u, "unknown Git entry cannot grant blob authority");
  if (!bytes.has(item.oid))
    bytes.set(
      item.oid,
      createHash("sha256")
        .update(execFileSync("git", ["cat-file", "blob", item.oid]))
        .digest("hex"),
    );
  return bytes.get(item.oid)!;
}
const mode = (source: string, file: string) => entry(source, file)?.mode ?? null;
const production = execFileSync(
  "git",
  [
    "diff",
    "--name-only",
    context.sources.baseline,
    context.sources.head,
    "--",
    ...context.productionPaths,
  ],
  { encoding: "utf8" },
)
  .trim()
  .split("\n");

void test("literal original baseline/current shipping source binds all285 paths and closed119 plus loader2", () => {
  for (const [key, source] of Object.entries(context.sources))
    assert.equal(
      execFileSync("git", ["rev-parse", `${source}^{tree}`], { encoding: "utf8" }).trim(),
      context.trees[key as keyof typeof context.trees],
    );
  const result = qualify(production, digest, mode);
  assert.ok(result);
  assert.equal(result.files.length, 285);
  assert.equal(result.publicAuthority.files.length, 119);
  assert.equal(result.publicAuthority.harnessSuccessors.length, 3);
  assert.equal(result.runtimeOwnerAuthority, false);
  assert.equal(result.inheritedBodies.length, 164);
  assert.equal(result.loaderMigration.length, 2);
});

void test("every whole issued producer pair including absent-new files rejects mixed or missing raw authority", () => {
  for (const [file] of issued.producerBodies)
    for (const source of [
      context.sources.baseline,
      context.sources.head,
      context.sources.publicBaseline,
    ]) {
      const drift = (s: string, f: string) =>
        s === source && f === file ? "foreign" : digest(s, f);
      assert.equal(qualify(production, drift, mode), null, `${source}:${file}`);
    }
  const file = issued.producerBodies[0]![0];
  const driftMode = (s: string, f: string) =>
    s === context.sources.head && f === file ? "100755" : mode(s, f);
  assert.equal(qualify(production, digest, driftMode), null);
});

void test("missing/extra/duplicate actual source paths cannot be waived", () => {
  for (const paths of [
    production.slice(1),
    [...production, "crates/foreign.rs"],
    [...production, production[0]!],
  ])
    assert.equal(qualify(paths, digest, mode), null);
});

void test("each complete inherited body and its actual public source/mode authority is mandatory", () => {
  for (const [file] of context.inheritedBodies)
    for (const source of [
      context.sources.baseline,
      context.sources.head,
      context.sources.actualParent,
      context.sources.publicBaseline,
    ]) {
      const drift = (s: string, f: string) =>
        s === source && f === file ? "foreign" : digest(s, f);
      assert.equal(qualify(production, drift, mode), null, `${source}:${file}`);
    }
  const file = context.inheritedBodies[0]![0]!;
  const drift = (s: string, f: string) =>
    s === context.sources.head && f === file ? "100755" : mode(s, f);
  assert.equal(qualify(production, digest, drift), null);
});

void test("exact two-body legacy-to-composed loader transition rejects missing/mixed/drift", () => {
  for (const [file] of context.loaderMigration)
    for (const source of [
      context.sources.baseline,
      context.sources.head,
      context.sources.actualParent,
      context.sources.publicBaseline,
    ]) {
      const drift = (s: string, f: string) =>
        s === source && f === file ? "foreign" : digest(s, f);
      assert.equal(qualify(production, drift, mode), null);
    }
});

void test("whole original51/three successors/corpus authority refuses omitted or old harness bodies", () => {
  for (const file of [
    "tests/performance/support/warm-type-backed-requests.ts",
    "tests/performance/support/warm-type-backed-owner-migration.ts",
    "tests/performance/support/warm-type-backed-owner-resolve.ts",
  ]) {
    const missing = (s: string, f: string) =>
      s === context.sources.head && f === file ? null : digest(s, f);
    assert.equal(qualify(production, missing, mode), null);
    const old = (s: string, f: string) =>
      s === context.sources.head && f === file ? digest(context.sources.baseline, f) : digest(s, f);
    assert.equal(qualify(production, old, mode), null);
  }
});

void test("changed source/header/part/incoming/loader manifest value cannot grant context", () => {
  const cases = [
    (v: typeof context) => {
      v.sources.head = "0".repeat(40);
    },
    (v: typeof context) => {
      v.inheritedBodies.pop();
    },
    (v: typeof context) => {
      v.inheritedBodies.push(v.inheritedBodies[0]!);
    },
    (v: typeof context) => {
      v.loaderMigration[0]![1] = "foreign";
    },
    (v: typeof context) => {
      v.inheritedBodyParts[0]!.file = "unknown.json";
    },
  ];
  for (const change of cases) {
    const altered = structuredClone(context);
    change(altered);
    assert.equal(qualify(production, digest, mode, altered), null);
  }
});
