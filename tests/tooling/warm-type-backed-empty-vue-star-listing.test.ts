import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import {
  emptyVueStarBodyPairs,
  emptyVueStarFiles,
  emptyVueStarMetadataPairs,
  qualifyEmptyVueStarHost,
} from "../performance/support/warm-type-backed-empty-vue-star-host.ts";
import {
  emptyVueStarListingPath,
  emptyVueStarListingBeforeSHA256,
  emptyVueStarListingAfterSHA256,
  retainedEmptyVueStarListingExecution,
  qualifyEmptyVueStarListingHost,
} from "../performance/support/warm-type-backed-empty-vue-star-listing.ts";
import { qualifyHostMoves } from "../performance/support/warm-type-backed-host-qualifications.ts";
import { ensureHostedLiteralSource } from "../performance/support/warm-type-backed-git-reader-literal-source.ts";

const root = path.resolve(import.meta.dirname, "../..");
const sha = (body: Buffer) => createHash("sha256").update(body).digest("hex");
const current = fs.readFileSync(path.join(root, emptyVueStarListingPath));
const allPairs = [...emptyVueStarBodyPairs, ...emptyVueStarMetadataPairs];
const original = new Map(allPairs.map(([file, before, after]) => [file, { before, after }]));
const digest = (side: "before" | "after", file: string) =>
  side === "after" && file === emptyVueStarListingPath
    ? sha(current)
    : (original.get(file)?.[side] ?? null);
const production = [...emptyVueStarFiles];

void test("the two listing clauses recover the complete genuine raw predecessor without sharing bytes", () => {
  ensureHostedLiteralSource(root, "ea1fc59ee6ef61a3509b1ef42a6fa7aacd9f8586");
  const before = execFileSync(
    "git",
    [
      "--no-replace-objects",
      "show",
      "ea1fc59ee6ef61a3509b1ef42a6fa7aacd9f8586:" + emptyVueStarListingPath,
    ],
    { cwd: root, env: { ...process.env, GIT_NO_LAZY_FETCH: "1" } },
  );
  const restored = retainedEmptyVueStarListingExecution(current);
  assert.deepEqual(restored, before);
  assert.equal(sha(restored), emptyVueStarListingBeforeSHA256);
  assert.equal(sha(current), emptyVueStarListingAfterSHA256);
  restored.fill(0);
  assert.deepEqual(retainedEmptyVueStarListingExecution(current), before);
  assert.equal(sha(current), emptyVueStarListingAfterSHA256);
});

void test("old, absent, partial, foreign and one-clause hybrid execution bodies refuse", () => {
  const text = current.toString();
  for (const candidate of [
    Buffer.alloc(0),
    current.subarray(0, current.length - 1),
    Buffer.from(text + "\n"),
    Buffer.concat([Buffer.from([current[0] ^ 1]), current.subarray(1)]),
    Buffer.from(text.replace('&["--listFilesOnly", "--pretty", "false"]', '&["--listFilesOnly"]')),
    Buffer.from(
      text.replace('json!(["--listFilesOnly", "--pretty", "false"])', 'json!(["--listFilesOnly"])'),
    ),
  ]) {
    if (candidate.equals(current)) continue;
    assert.throws(() => retainedEmptyVueStarListingExecution(candidate), /AssertionError/u);
  }
  assert.throws(
    () => retainedEmptyVueStarListingExecution(retainedEmptyVueStarListingExecution(current)),
    /AssertionError/u,
  );
});

void test("one current cell precedes the complete unchanged 290-cell and six-correction laws", () => {
  assert.equal(allPairs.length, 290);
  assert.equal(qualifyEmptyVueStarHost(production, new Set(), digest), null);
  const qualified = qualifyEmptyVueStarListingHost(
    production,
    new Set(),
    digest,
    qualifyEmptyVueStarHost,
  );
  assert(qualified);
  assert.equal(qualified.completeBodyPairs, 44);
  assert.equal(qualified.supplementalBodyPairs, 85);
  assert.equal(qualified.preservedBodyPairs, 152);
  assert.equal(qualified.runtimeCredit, false);
  assert.equal(qualified.performanceCredit, false);
  for (const [file] of allPairs)
    for (const side of ["before", "after"] as const)
      for (const value of [null, "f".repeat(64)]) {
        if (value === digest(side, file)) continue;
        assert.equal(
          qualifyEmptyVueStarListingHost(
            production,
            new Set(),
            (s, name) => (s === side && name === file ? value : digest(s, name)),
            qualifyEmptyVueStarHost,
          ),
          null,
          `${side}:${file}`,
        );
      }
  for (const files of [
    [],
    production.slice(1),
    [...production, "unknown.rs"],
    [...production, production[0]],
  ])
    assert.equal(
      qualifyEmptyVueStarListingHost(files, new Set(), digest, qualifyEmptyVueStarHost),
      null,
    );
});

void test("the actual warm caller binds the complete new helper and its genuine predecessor absence", () => {
  const helpers = [
    "tests/performance/support/warm-type-backed-empty-vue-star-host.ts",
    "tests/tooling/warm-type-backed-empty-vue-star-host.test.ts",
    "tests/performance/support/warm-type-backed-empty-vue-star-listing.ts",
  ];
  const read = (side: "before" | "after", file: string) =>
    helpers.includes(file)
      ? side === "before"
        ? null
        : sha(fs.readFileSync(path.join(root, file)))
      : digest(side, file);
  const qualified = qualifyHostMoves(production, new Set(), true, read);
  assert(qualified.emptyVueStarHost);
  for (const helper of helpers)
    for (const side of ["before", "after"] as const)
      for (const value of [null, "f".repeat(64)]) {
        if (value === read(side, helper)) continue;
        assert(
          !qualifyHostMoves(production, new Set(), true, (s, name) =>
            s === side && name === helper ? value : read(s, name),
          ).emptyVueStarHost,
        );
      }
});
