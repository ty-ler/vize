import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";

import { pathHostCallers } from "../../../tools/support/compat/levels/path-host-callers.ts";

type Side = "before" | "after";
type BodyDigest = (side: Side, file: string) => string | null;
type Manifest = {
  version: number;
  originalSource: string;
  transformedSource: string;
  originalPathSHA256: string;
  files: Array<[string, string | null, string | null]>;
};

const manifest = JSON.parse(
  fs.readFileSync(new URL("./warm-type-backed-path-host-manifest.json", import.meta.url), "utf8"),
) as Manifest;
const manifestSHA256 = createHash("sha256").update(JSON.stringify(manifest)).digest("hex");
assert.equal(manifestSHA256, "50274f0ff7b1def1ab1d25e401bb2ad1cd823e4a6adae3ed707fa4cf62144b8f");
assert.equal(manifest.version, 1);
for (const source of [manifest.originalSource, manifest.transformedSource])
  assert.match(source, /^[a-f0-9]{40}$/u);
const oldPath = "davinci/vize_l0/src/path.rs";
const newPath = "crates/vize_carton/src/path.rs";
const expectedFiles = [
  ...Object.keys(pathHostCallers),
  oldPath,
  newPath,
  "davinci/vize_l0/src/lib.rs",
  "crates/vize_carton/src/lib.rs",
].toSorted();
assert.equal(expectedFiles.length, 60);
assert.deepEqual(
  manifest.files.map(([file]) => file),
  expectedFiles,
);
assert.equal(manifest.files.find(([file]) => file === oldPath)![1], manifest.originalPathSHA256);
assert.equal(
  manifest.originalPathSHA256,
  "6baa58e143416eaed0d9b82984de455d76006dd5fd4dfa81b80190765307e7e3",
);

/** Admit only the whole reviewed move, never arbitrary edits at those file names. */
export function qualifyPathHostMove(
  production: string[],
  alreadyQualified: ReadonlySet<string>,
  digest: BodyDigest,
) {
  const files = new Set(expectedFiles);
  if (production.every((file) => alreadyQualified.has(file))) return null;
  if (production.some((file) => !alreadyQualified.has(file) && !files.has(file))) return null;
  // Rename detection may report the destination alone or both deleted/added paths.
  const footprint = production.filter((file) => files.has(file) && file !== oldPath).toSorted();
  if (
    JSON.stringify(footprint) !== JSON.stringify(expectedFiles.filter((file) => file !== oldPath))
  )
    return null;
  for (const [file, before, after] of manifest.files) {
    if (digest("before", file) !== before || digest("after", file) !== after) return null;
  }
  return {
    authority: "exact-reviewed-path-host-move",
    manifestSHA256,
    originalSource: manifest.originalSource,
    transformedSource: manifest.transformedSource,
    completeBodyPairs: manifest.files.length,
    files: expectedFiles,
  };
}

/** Hash complete regular Git blobs; preserve absence and reject mode/type changes. */
export function gitBodyDigest(root: string, revision: string, file: string): string | null {
  assert.match(revision, /^[a-f0-9]{40}$/u);
  const entry = execFileSync(
    "git",
    ["--no-replace-objects", "ls-tree", "-l", "-z", revision, "--", file],
    {
      cwd: root,
    },
  );
  if (entry.length === 0) return null;
  const record = entry.toString("utf8");
  assert.ok(Buffer.from(record).equals(entry));
  const records = record.split("\0");
  assert.equal(records.length, 2);
  assert.equal(records[1], "");
  const match = /^100644 blob ([a-f0-9]{40}) +([0-9]+)\t(.+)$/u.exec(records[0]);
  assert.ok(match, `one regular source blob is required: ${file}`);
  assert.equal(match[3], file);
  const size = Number(match[2]);
  assert(Number.isSafeInteger(size) && size >= 0);
  if (size > 1024 * 1024) {
    const script = `const {spawn}=require("node:child_process");const {createHash}=require("node:crypto");const child=spawn("git",["--no-replace-objects","cat-file","blob",process.argv[1]],{stdio:["ignore","pipe","inherit"]});const hash=createHash("sha256");let bytes=0;child.stdout.on("data",body=>{bytes+=body.length;hash.update(body)});child.on("error",error=>{console.error(error);process.exitCode=1});child.on("close",(status,signal)=>{if(signal){process.kill(process.pid,signal);return}if(status!==0){process.exitCode=status??1;return}if(bytes!==Number(process.argv[2])){console.error("Incomplete regular Git blob");process.exitCode=1;return}process.stdout.write(hash.digest("hex"))});`;
    const digest = execFileSync(process.execPath, ["-e", script, match[1], String(size)], {
      cwd: root,
    }).toString("utf8");
    assert.match(digest, /^[a-f0-9]{64}$/u);
    return digest;
  }
  const body = execFileSync("git", ["--no-replace-objects", "cat-file", "blob", match[1]], {
    cwd: root,
  });
  return createHash("sha256").update(body).digest("hex");
}
