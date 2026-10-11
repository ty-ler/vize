import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import manifest from "../../_fixtures/differential/lsp/warm-type-backed-owned-completion/manifest.json" with { type: "json" };
import { SessionRoots } from "./warm-type-backed-packets.ts";

export const fixtureRoot = new URL(
  "../../_fixtures/differential/lsp/warm-type-backed-owned-completion/",
  import.meta.url,
);
export const digest = (value: string | Uint8Array) =>
  createHash("sha256").update(value).digest("hex");
export const fixtureManifest = manifest;
assert.equal(manifest.version, 1);
assert.deepEqual(
  [manifest.originalPackets, manifest.unchangedPackets, manifest.originalComparedFields],
  [79, 77, 20],
);
assert.deepEqual(manifest.successorPackets, [72, 80]);
for (const [name, expected] of manifest.files)
  assert.equal(digest(fs.readFileSync(new URL(name, fixtureRoot))), expected, name);

export function readFixture<T>(name: string): T {
  assert.ok(
    manifest.files.some(([file]) => file === name),
    name,
  );
  return JSON.parse(fs.readFileSync(new URL(name, fixtureRoot), "utf8")) as T;
}

export type CompletePacket = {
  stage: string;
  name: string;
  method: string;
  params: unknown;
  requestId: number;
  response: unknown;
};
export type ObservedSide = {
  rows: Array<Record<string, unknown>>;
  sessionRoots: { physical: string[]; spellings: Array<[string, string]> };
  changedInputs: Array<Record<string, unknown>>;
  source: { revision: string };
  inputs: { source: unknown };
  wire: { capture: string };
};
export type ObservedPair = {
  sourceBinding: { baseline: string; head: string; projectConfigHost?: unknown };
  before: ObservedSide;
  after: ObservedSide;
};
function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
export const originalPackets = freeze(readFixture<CompletePacket[]>("original-79.json"));
export const successorPackets = freeze(readFixture<CompletePacket[]>("successor-2.json"));

export function completePackets(side: ObservedSide): CompletePacket[] {
  return side.rows.map((row) => ({
    stage: row.stage as string,
    name: row.name as string,
    method: row.method as string,
    params: row.comparableParams,
    requestId: row.requestId as number,
    response: row.comparableResponse,
  }));
}

/** Reuse only the original, already observed physical-root bijection. */
export function observedRoots(side: ObservedSide): SessionRoots {
  const roots = new SessionRoots();
  roots.roots.push(...side.sessionRoots.physical);
  for (const [spelling, token] of side.sessionRoots.spellings) roots.spellings.set(spelling, token);
  assert.equal(new Set(roots.roots).size, roots.roots.length);
  return roots;
}

export function object(value: unknown): Record<string, unknown> {
  assert.ok(value !== null && typeof value === "object" && !Array.isArray(value));
  return value as Record<string, unknown>;
}

export function items(row: Record<string, unknown>): Array<Record<string, unknown>> {
  assert.ok(Array.isArray(row.result));
  assert.deepEqual(
    row.result.map((item) => object(item).label),
    ["count", "double", "items", "add"],
  );
  return row.result.map(object);
}

export function differingFields(before: unknown, after: unknown, at = ""): string[] {
  if (Array.isArray(before) && Array.isArray(after)) {
    assert.equal(before.length, after.length);
    return before.flatMap((value, index) => differingFields(value, after[index], `${at}/${index}`));
  }
  if (
    before !== null &&
    after !== null &&
    typeof before === "object" &&
    typeof after === "object"
  ) {
    const a = object(before),
      b = object(after);
    assert.deepEqual(Object.keys(a).toSorted(), Object.keys(b).toSorted());
    return Object.keys(a).flatMap((key) => differingFields(a[key], b[key], `${at}/${key}`));
  }
  return before === after ? [] : [at];
}
