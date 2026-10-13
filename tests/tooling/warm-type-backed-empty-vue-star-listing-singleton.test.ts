import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  emptyVueStarBodyPairs,
  emptyVueStarMetadataPairs,
} from "../performance/support/warm-type-backed-empty-vue-star-host.ts";
import { qualifyEmptyVueStarListingHost } from "../performance/support/warm-type-backed-empty-vue-star-listing.ts";
import { qualifyEmptyVueStarHost } from "../performance/support/warm-type-backed-empty-vue-star-host.ts";
import { qualifyEmptyVueStarListingSingleton } from "../performance/support/warm-type-backed-empty-vue-star-listing-singleton.ts";
import { qualifyHostMoves } from "../performance/support/warm-type-backed-host-qualifications.ts";
import { ensureHostedLiteralSource } from "../performance/support/warm-type-backed-git-reader-literal-source.ts";

const root = path.resolve(import.meta.dirname, "../..");
const baseInput = "b45d789b317933d48dadbba4841c8e353231547b";
const before = "ea1fc59ee6ef61a3509b1ef42a6fa7aacd9f8586";
const failedAfter = "e02a861cc1c6ad12724036c70bfdd5d48173b189";
const integratedBase = "e78d2cb93e278032cd262201b0a444273618ee25";
const execution = "crates/vize_canon/tests/empty_vue_star_exports/execution.rs";
const listing = "tests/performance/support/warm-type-backed-empty-vue-star-listing.ts";
const singleton = "tests/performance/support/warm-type-backed-empty-vue-star-listing-singleton.ts";
const oldHelpers = [
  "tests/performance/support/warm-type-backed-empty-vue-star-host.ts",
  "tests/tooling/warm-type-backed-empty-vue-star-host.test.ts",
];
const pairs = [...emptyVueStarBodyPairs, ...emptyVueStarMetadataPairs];
const files = [...pairs.map(([file]) => file), ...oldHelpers, listing, singleton];
assert.equal(new Set(files).size, files.length);
const git = (args: string[], input?: Buffer) =>
  execFileSync("git", ["--no-replace-objects", ...args], {
    cwd: root,
    input,
    env: { ...process.env, GIT_NO_LAZY_FETCH: "1" },
    maxBuffer: 64 * 1024 * 1024,
  });
const sha = (body: Buffer) => createHash("sha256").update(body).digest("hex");
for (const source of [baseInput, before, failedAfter, integratedBase])
  ensureHostedLiteralSource(root, source);
assert.equal(git(["merge-base", baseInput, failedAfter]).toString().trim(), before);
const production = git([
  "diff",
  "--name-only",
  before,
  failedAfter,
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
  .toString()
  .trim()
  .split("\n");
function readBaseline(revision: string) {
  const entries = git(["ls-tree", "-z", revision, "--", ...files])
    .toString()
    .split("\0")
    .filter(Boolean);
  const rows = entries.map((entry) => {
    const match = /^100644 blob ([a-f0-9]{40})\t(.+)$/u.exec(entry);
    assert(match, "complete actual regular baseline source");
    return { blob: match[1], file: match[2] };
  });
  const raw = git(
    ["cat-file", "--batch"],
    Buffer.from(rows.map(({ blob }) => blob + "\n").join("")),
  );
  const baseline = new Map<string, string>();
  let offset = 0;
  for (const row of rows) {
    const end = raw.indexOf(10, offset);
    const header = /^([a-f0-9]{40}) blob ([0-9]+)$/u.exec(raw.subarray(offset, end).toString());
    assert(header);
    assert.equal(header[1], row.blob);
    const length = Number(header[2]);
    const body = raw.subarray(end + 1, end + 1 + length);
    assert.equal(
      createHash("sha1").update(`blob ${body.length}\0`).update(body).digest("hex"),
      row.blob,
    );
    baseline.set(row.file, sha(body));
    offset = end + length + 2;
  }
  assert.equal(offset, raw.length);
  return baseline;
}
const baseline = readBaseline(before);
const candidate = new Map(
  files.map((file) => {
    const target = path.join(root, file);
    const stat = fs.lstatSync(target);
    assert(stat.isFile() && (stat.mode & 0o777) === 0o644, "actual regular candidate body");
    return [file, sha(fs.readFileSync(target))] as const;
  }),
);
const digest = (side: "before" | "after", file: string) =>
  (side === "before" ? baseline : candidate).get(file) ?? null;

await test("the real refused pair has one delta after its existing migration, not 44 new files", () => {
  assert.deepEqual(production, [execution]);
  assert.equal(pairs.length, 290);
  for (const [file, , current] of pairs) assert.equal(digest("before", file), current);
  for (const file of oldHelpers) assert.equal(digest("before", file), digest("after", file));
  assert.equal(digest("before", listing), null);
  assert.equal(digest("before", singleton), null);
  assert.equal(
    qualifyEmptyVueStarListingHost(production, new Set(), digest, qualifyEmptyVueStarHost),
    null,
  );
  const actual = qualifyHostMoves(production, new Set(), true, digest);
  assert.equal(actual.emptyVueStarHost, undefined);
  assert(actual.emptyVueStarListingSingleton);
  assert.deepEqual(actual.emptyVueStarListingSingleton.files, [execution]);
  assert.equal(actual.emptyVueStarListingSingleton.retainedCurrentBodyPairs, 289);
  assert.equal(actual.emptyVueStarListingSingleton.runtimeCredit, false);
  assert.equal(actual.emptyVueStarListingSingleton.performanceCredit, false);
});

await test("the integrated main predecessor retains the whole current cohort and original failed law", () => {
  const currentBefore = readBaseline(integratedBase);
  const currentDigest = (side: "before" | "after", file: string) =>
    (side === "before" ? currentBefore : candidate).get(file) ?? null;
  for (const [file, , current] of pairs) assert.equal(currentBefore.get(file), current);
  for (const file of oldHelpers) assert.equal(currentBefore.get(file), candidate.get(file));
  assert.equal(currentBefore.get(listing), undefined);
  assert.equal(currentBefore.get(singleton), undefined);
  const qualified = qualifyHostMoves(production, new Set(), true, currentDigest);
  assert.equal(qualified.emptyVueStarHost, undefined);
  assert(qualified.emptyVueStarListingSingleton);
  assert.deepEqual(qualified.emptyVueStarListingSingleton.files, [execution]);
  assert.equal(qualified.emptyVueStarListingSingleton.retainedCurrentBodyPairs, 289);
  for (const file of files)
    for (const side of ["before", "after"] as const)
      for (const changed of [null, "f".repeat(64)]) {
        if (changed === currentDigest(side, file)) continue;
        assert.equal(
          qualifyHostMoves(production, new Set(), true, (s, name) =>
            s === side && name === file ? changed : currentDigest(s, name),
          ).emptyVueStarListingSingleton,
          undefined,
          `${side}:${file}`,
        );
      }
});

await test("every actual closed body on either side rejects absence and foreign source", () => {
  assert(qualifyEmptyVueStarListingSingleton(production, new Set(), digest));
  for (const file of files)
    for (const side of ["before", "after"] as const)
      for (const changed of [null, "f".repeat(64)]) {
        if (changed === digest(side, file)) continue;
        assert.equal(
          qualifyHostMoves(production, new Set(), true, (s, name) =>
            s === side && name === file ? changed : digest(s, name),
          ).emptyVueStarListingSingleton,
          undefined,
          `${side}:${file}`,
        );
      }
});

await test("extra, duplicate, hybrid, already-qualified and neighbor deltas cannot borrow this singleton", () => {
  for (const footprint of [
    [],
    [execution, execution],
    [execution, "unknown.rs"],
    [execution, "crates/vize_canon/src/lib.rs"],
    ["crates/vize_canon/src/lib.rs"],
  ])
    for (const qualified of [new Set<string>(), new Set(footprint)])
      assert.equal(qualifyEmptyVueStarListingSingleton(footprint, qualified, digest), null);
  assert.equal(
    qualifyEmptyVueStarListingSingleton(
      [execution, "crates/vize_canon/src/lib.rs"],
      new Set(["crates/vize_canon/src/lib.rs"]),
      digest,
    ),
    null,
  );
  assert.equal(qualifyEmptyVueStarListingSingleton(production, new Set(production), digest), null);
  for (const side of ["before", "after"] as const)
    assert.equal(
      qualifyEmptyVueStarListingSingleton(production, new Set(), (s, file) =>
        s === side && file === execution
          ? digest(s === "before" ? "after" : "before", file)
          : digest(s, file),
      ),
      null,
    );
  assert.equal(
    qualifyHostMoves(production, new Set(), false, digest).emptyVueStarListingSingleton,
    undefined,
  );
  for (const side of ["before", "after"] as const)
    assert.equal(
      qualifyHostMoves(production, new Set(), true, (s, file) =>
        s === side && file === singleton ? "f".repeat(64) : digest(s, file),
      ).emptyVueStarListingSingleton,
      undefined,
    );
});
