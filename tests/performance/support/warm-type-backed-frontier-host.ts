import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";

const manifest = JSON.parse(
  fs.readFileSync(new URL("./warm-type-backed-frontier-manifest.json", import.meta.url), "utf8"),
) as {
  version: number;
  originalSource: string;
  reviewedSource: string;
  files: string[];
  preservedBodies: string[];
};
const predecessor = JSON.parse(
  fs.readFileSync(
    new URL("./warm-type-backed-inline-bucket-manifest.json", import.meta.url),
    "utf8",
  ),
) as { files: string[]; preservedBodies: string[] };
const manifestSHA256 = createHash("sha256").update(JSON.stringify(manifest)).digest("hex");
assert.equal(manifestSHA256, "0844ba65e65048385bc779772f12d06a8b3e5012c396bd041545cc05a8df288e");
assert.equal(manifest.originalSource, "e7ec9790a0ec5586588f97d21b8e5913ad01861c");
assert.equal(manifest.reviewedSource, "4c1f514a24bd47fe30124b5692866150032850fd");
assert.equal(manifest.version, 1);
assert.equal(manifest.files.length, 198);
assert.deepEqual(manifest.preservedBodies, predecessor.preservedBodies);
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
    files: changed,
    acceptanceCredit: "none",
  };
}
