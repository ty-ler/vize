import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { runOwnerResolveFixture } from "./warm-type-backed-owner-resolve.ts";

type SourceBinding = { projectConfigHost?: unknown; componentContextHost?: unknown };
type Pair = {
  sourceBinding: SourceBinding;
  buildCustody: Array<{ launchBinary: string }>;
  before: { inputs: { workspace: string } };
};

export function capturesOwners(source: SourceBinding): boolean {
  return Boolean(source.projectConfigHost || source.componentContextHost);
}

/** Retain the complete original comparison until live migration proofs qualify it. */
export async function completeOwnerPackets<T>(original: T, packet: Pair): Promise<T> {
  if (!capturesOwners(packet.sourceBinding)) return original;
  const workspace = packet.before.inputs.workspace;
  const output = path.dirname(workspace);
  const resolved = [];
  for (const [i, custody] of packet.buildCustody.entries()) {
    const root = path.dirname(path.dirname(path.dirname(custody.launchBinary)));
    const side = i === 0 ? "before" : "after";
    resolved.push(
      await runOwnerResolveFixture(root, workspace, path.join(output, `owner-${side}`)),
    );
  }
  fs.writeFileSync(
    path.join(output, "owner-resolve-pair.json"),
    `${JSON.stringify(resolved, null, 2)}\n`,
  );
  assert.deepEqual(
    resolved[1].refusalFailures,
    [],
    "the successor must refuse every stale/foreign/dead-owner capability",
  );
  return original;
}
