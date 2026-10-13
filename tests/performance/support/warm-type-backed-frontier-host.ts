import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { execFileSync } from "node:child_process";

const manifest = JSON.parse(
  fs.readFileSync(new URL("./warm-type-backed-frontier-manifest.json", import.meta.url), "utf8"),
) as {
  version: number;
  originalSource: string;
  reviewedSource: string;
  files: string[];
  preservedBodies: string[];
  harnessBodies: string[];
  ciBodies: string[];
};
const predecessor = JSON.parse(
  fs.readFileSync(new URL("./allocation-diagnostic/source-manifest.json", import.meta.url), "utf8"),
) as { files: string[]; preservedBodies: string[] };
const manifestSHA256 = createHash("sha256").update(JSON.stringify(manifest)).digest("hex");
assert.equal(manifestSHA256, "2161b814f41ba7e721f3af6680c5771017b8d45af53b901dd1d39498312ad3b2");
assert.equal(manifest.originalSource, "3dd6ae0707dc42302638257b86967d6a6ffe902f");
assert.equal(manifest.reviewedSource, "7a4a0b907ada40cd997e6b25865d5ea7c07ee791");
assert.equal(manifest.version, 1);
assert.equal(manifest.files.length, 210);
assert.equal(manifest.harnessBodies.length, 31);
assert.equal(manifest.ciBodies.length, 21);
assert.deepEqual(
  manifest.preservedBodies,
  predecessor.preservedBodies.map((row) => [row.split("\t")[0], row.split("\t")[2]].join("\t")),
);
const pairs = manifest.files.map((row) => row.split("\t"));
const files = pairs.map(([file]) => file);
assert.deepEqual(files, files.toSorted());
assert.equal(new Set(files).size, files.length);
for (const [file, before, after] of pairs) {
  assert.ok(file && !file.startsWith("/") && !file.split("/").includes(".."));
  assert.match(before, /^(?:[a-f0-9]{64}|-)$/u);
  assert.match(after, /^[a-f0-9]{64}$/u);
}
const additions = files.filter(
  (file) => !predecessor.files.some((row) => row.startsWith(`${file}\t`)),
);
assert.deepEqual(additions, [
  "crates/vize_canon/src/corsa_bridge/vue_dependencies_alias/context/routes/frontier.rs",
  "crates/vize_canon/src/corsa_bridge/vue_dependencies_alias/context/routes/frontier/tests.rs",
]);
const changed = pairs.filter(([, before, after]) => before !== after).map(([file]) => file);

/** Exact source counterpart: no performance or original n8n acceptance credit. */
export function qualifyFrontierHost(
  production: string[],
  digest: (side: "before" | "after", file: string) => string | null,
) {
  if (
    new Set(production).size !== production.length ||
    JSON.stringify(production.toSorted()) !== JSON.stringify(changed)
  )
    return null;
  for (const [file, before, after] of pairs)
    if (
      digest("before", file) !== (before === "-" ? null : before) ||
      digest("after", file) !== after
    )
      return null;
  for (const row of manifest.ciBodies) {
    const [file, before, after] = row.split("\t");
    if (
      digest("before", file) !== (before === "-" ? null : before) ||
      digest("after", file) !== after
    )
      return null;
  }
  for (const row of manifest.harnessBodies) {
    const [file, before, after] = row.split("\t");
    if (digest("before", file) !== before || digest("after", file) !== after) return null;
  }
  for (const row of manifest.preservedBodies) {
    const [file, body] = row.split("\t");
    if (digest("before", file) !== body || digest("after", file) !== body) return null;
  }
  return {
    authority: "complete-exact-frontier-parser-reuse",
    originalSource: manifest.originalSource,
    reviewedSource: manifest.reviewedSource,
    manifestSHA256,
    completeBodyPairs: files.length,
    preservedBodyPairs: manifest.preservedBodies.length,
    preservedHarnessPairs: manifest.harnessBodies.length,
    completeCiPairs: manifest.ciBodies.length,
    files: changed,
    acceptanceCredit: "none",
  };
}

/** Actual source verification cannot borrow Git replacement bodies or modes. */
export function qualifyFrontierSource(root: string, revision: string) {
  assert.match(revision, /^[a-f0-9]{40}$/u);
  const raw = (...args: string[]) =>
    execFileSync("git", ["--no-replace-objects", ...args], { cwd: root });
  const production = raw(
    "diff",
    "--name-only",
    manifest.originalSource,
    revision,
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
  )
    .toString()
    .trim()
    .split("\n")
    .filter(Boolean);
  return qualifyFrontierHost(production, (side, file) => {
    const source = side === "before" ? manifest.originalSource : revision;
    const entry = raw("ls-tree", "-z", source, "--", file);
    if (!entry.length) return null;
    const records = entry.toString().split("\0");
    assert.equal(records.length, 2);
    assert.equal(records[1], "");
    const match = /^100644 blob ([a-f0-9]{40})\t(.+)$/u.exec(records[0]);
    assert.ok(match, `complete regular source required: ${file}`);
    assert.equal(match[2], file);
    return createHash("sha256")
      .update(raw("cat-file", "blob", match[1]))
      .digest("hex");
  });
}
