import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import type { PinnedFixtureWorkspace } from "../../../_helpers/realworld-patch.ts";
import { sha256 } from "../../../differential/sha256.ts";
import type { MemoryBinding } from "./launch.ts";

type Selected = { files: { path: string; bytes: number; sha256: string }[]; sha256: string };

/** Called at the existing before-spawn input fence; no baseline query is enabled. */
export function recordMemoryInputs(
  fixture: PinnedFixtureWorkspace,
  sources: Record<string, string>,
  manifest: (directory: string) => Selected,
): void {
  const bindingPath = process.env.VIZE_LSP_MEMORY_BINDING;
  if (!bindingPath) return;
  assert.equal(process.env.VIZE_LSP_CURRENT_BASELINE, undefined);
  assert.equal(fixture.entry.id, "misskey");
  assert.equal(fixture.entry.revision, "810faa8e5db4bbf9d6d408a61df148559340ee99");
  const binding = JSON.parse(fs.readFileSync(bindingPath, "utf8")) as MemoryBinding;
  const selected = manifest(path.join(fixture.workspaceDir, "packages/frontend"));
  assert.deepEqual(selected, manifest(path.join(fixture.upstreamDir, "packages/frontend")));
  assert.deepEqual(Object.keys(sources).sort(), [
    "brokenDependency",
    "cleanDependency",
    "cleanSource",
    "leafBrokenSource",
  ]);
  const packet = {
    schema: "vize.lsp.allocation.original.inputs",
    version: 1,
    fixture: fixture.entry,
    selectedPath: "packages/frontend",
    selected,
    workspaceDir: fixture.workspaceDir,
    authoredSources: Object.fromEntries(
      Object.entries(sources).map(([name, text]) => [
        name,
        { text, bytes: Buffer.byteLength(text), sha256: sha256(text) },
      ]),
    ),
    sourceRevision: binding.sourceRevision,
    role: binding.role,
    scope: "whole-original-selected-Misskey-and-four-authored-buffers-before-spawn",
    acceptanceCredit: "none",
  };
  fs.writeFileSync(`${binding.outputRoot}.inputs.json`, `${JSON.stringify(packet, null, 2)}\n`, {
    flag: "wx",
  });
}
