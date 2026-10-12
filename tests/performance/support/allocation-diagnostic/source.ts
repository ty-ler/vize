import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { sha256 } from "../../../differential/sha256.ts";
import { rawGit } from "./build.ts";
import { FROZEN_SOURCE } from "./launch.ts";

type Side = "before" | "after";
type Digest = (side: Side, file: string) => string | null;
export const manifest = JSON.parse(
  fs.readFileSync(new URL("./source-manifest.json", import.meta.url), "utf8"),
) as {
  version: number;
  originalSource: string;
  reviewedSource: string;
  files: string[];
  preservedBodies: string[];
  harnessBodies: string[];
  nativeDelta: string[];
  sourceDelta: string[];
};
const previousBytes = fs.readFileSync(
  new URL("../warm-type-backed-inline-bucket-manifest.json", import.meta.url),
);
assert.equal(
  sha256(previousBytes),
  "0eb167a2811ad25303d53d4e8ac72f297a439f0bfa5368f309ca7622c2284ada",
);
const previous = JSON.parse(previousBytes.toString()) as {
  files: string[];
  preservedBodies: string[];
};
export const manifestSHA256 = sha256(JSON.stringify(manifest));
assert.equal(manifestSHA256, "256dd23ed28196bf2a9f007c2a5486b3ecb54105cbb8825cce5117f503843917");
assert.equal(manifest.version, 1);
assert.equal(manifest.originalSource, FROZEN_SOURCE);
assert.match(manifest.reviewedSource, /^[a-f0-9]{40}$/);
assert.notEqual(manifest.reviewedSource, manifest.originalSource);
assert.equal(previous.files.length, 196);
assert.equal(previous.preservedBodies.length, 45);
assert.equal(manifest.files.length, 208);
assert.equal(manifest.preservedBodies.length, 45);
const decode = (row: string) => {
  const parts = row.split("\t");
  assert.equal(parts.length, 3);
  assert(parts[0] && !parts[0].startsWith("/") && !parts[0].split("/").includes(".."));
  for (const body of parts.slice(1)) assert.match(body, /^(?:[a-f0-9]{64}|-)$/);
  return parts;
};
const native = manifest.files.map(decode);
const old = new Map(
  previous.files.map((row) => {
    const [file, , body] = row.split("\t");
    return [file, body];
  }),
);
for (const [file, before] of native)
  if (old.has(file)) {
    assert.equal(before, old.get(file));
    old.delete(file);
  }
assert.equal(old.size, 0, "every original196 producer is mandatory");
assert.deepEqual(
  native
    .filter(([, a, b]) => a !== b)
    .map(([file]) => file)
    .toSorted(),
  manifest.nativeDelta,
);
const mandatory = manifest.preservedBodies.map(decode);
assert.deepEqual(
  mandatory.map(([file, before]) => `${file}\t${before}`),
  previous.preservedBodies,
);
const harness = manifest.harnessBodies.map(decode);
export const rows = [...native, ...mandatory, ...harness];
assert.equal(
  new Set(rows.map(([file]) => file)).size,
  rows.length,
  "duplicate complete body refused",
);
for (const group of [native, mandatory, harness])
  assert.deepEqual(
    group.map(([file]) => file),
    group.map(([file]) => file).toSorted(),
  );
assert.equal(new Set(manifest.nativeDelta).size, 9);

/** Exact finite producer list and every old/new whole body; omitted bodies never qualify. */
export function qualifyAllocationHost(production: string[], digest: Digest) {
  if (new Set(production).size !== production.length) return null;
  if (JSON.stringify(production.toSorted()) !== JSON.stringify(manifest.nativeDelta)) return null;
  for (const [file, before, after] of rows) {
    if (digest("before", file) !== (before === "-" ? null : before)) return null;
    if (digest("after", file) !== (after === "-" ? null : after)) return null;
  }
  return {
    authority: "complete-reviewed-optional-allocation-diagnosis",
    originalSource: manifest.originalSource,
    reviewedSource: manifest.reviewedSource,
    manifestSHA256,
    nativeBodies: 208,
    originalMandatoryBodies: 45,
    harnessBodies: harness.length,
    nativeDelta: manifest.nativeDelta,
    acceptanceCredit: "none",
  };
}

/** Replacement objects cannot lend a good body or hide an unreviewed producer. */
export function rawBody(root: string, revision: string, file: string) {
  const entry = rawGit(root, "ls-tree", revision, "--", file).toString().trim();
  if (!entry) return null;
  assert.match(entry, /^100644 blob [a-f0-9]{40}\t/);
  assert.equal(entry.split("\t")[1], file);
  return rawGit(root, "show", `${revision}:${file}`);
}
export function rawProduction(root: string, revision: string): string[] {
  return rawGit(
    root,
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
}
export function qualifyAllocationSource(root: string, revision: string) {
  assert.match(revision, /^[a-f0-9]{40}$/);
  const completeDelta = rawGit(root, "diff", "--name-only", manifest.originalSource, revision)
    .toString()
    .trim()
    .split("\n")
    .filter(Boolean)
    .toSorted();
  if (JSON.stringify(completeDelta) !== JSON.stringify(manifest.sourceDelta)) return null;
  return qualifyAllocationHost(rawProduction(root, revision), (side, file) => {
    const bytes = rawBody(root, side === "before" ? manifest.originalSource : revision, file);
    return bytes === null ? null : sha256(bytes);
  });
}
export function qualifyAllocationCheckout(root: string) {
  const revision = rawGit(root, "rev-parse", "HEAD").toString().trim();
  assert.equal(rawGit(root, "status", "--porcelain", "--untracked-files=no").toString().trim(), "");
  const receipt = qualifyAllocationSource(root, revision);
  if (!receipt) return null;
  for (const [file, , after] of rows) {
    assert.notEqual(after, "-");
    assert.equal(
      sha256(fs.readFileSync(path.join(root, file))),
      after,
      `checkout body changed: ${file}`,
    );
  }
  return {
    ...receipt,
    actualSource: revision,
    actualSourceTree: rawGit(root, "rev-parse", `${revision}^{tree}`).toString().trim(),
  };
}
export function retainSourceBodies(root: string, directory: string): void {
  assert(!fs.existsSync(directory));
  const revision = rawGit(root, "rev-parse", "HEAD").toString().trim();
  for (const [file] of rows)
    for (const [side, source] of [
      ["before", manifest.originalSource],
      ["after", revision],
    ] as const) {
      const body = rawBody(root, source, file);
      if (body === null) continue;
      const destination = path.join(directory, side, file);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.writeFileSync(destination, body, { flag: "wx" });
    }
  fs.copyFileSync(
    new URL("./source-manifest.json", import.meta.url),
    path.join(directory, "source-manifest.json"),
    fs.constants.COPYFILE_EXCL,
  );
}
