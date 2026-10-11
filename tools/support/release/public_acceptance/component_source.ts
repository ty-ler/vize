import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { cases, componentCorpus, componentCorpusSHA256, sha256 } from "./component_inputs.ts";
import { publicReader } from "./http.ts";
import { readRawBlob } from "./plan.ts";

export const componentHarness = [
  "component_inputs.ts",
  "component_cli.ts",
  "component_protocol.ts",
  "component_lsp.ts",
  "component_release.ts",
  "component_observer.ts",
  "component_seal.ts",
  "github.ts",
  "http.ts",
  "inputs.ts",
  "installed.ts",
];
function object(value: unknown): Record<string, unknown> {
  assert.ok(value && typeof value === "object" && !Array.isArray(value));
  return value as Record<string, unknown>;
}
/** A historical successful release cannot receive credit for a later, unmerged transport fix. */
export async function componentSource(
  root: string,
  cut: string,
  head: string,
  fetchOverride?: typeof globalThis.fetch,
) {
  const { json } = publicReader(fetchOverride);
  const pr = await json("https://api.github.com/repos/ubugeeei-prod/vize/pulls/8497");
  assert.equal(pr.number, 8497);
  assert.equal(
    pr.merged,
    true,
    "component source PR must actually be merged before its public acceptance",
  );
  assert.equal(pr.state, "closed");
  assert.ok(typeof pr.merged_at === "string" && Number.isFinite(Date.parse(pr.merged_at)));
  assert.equal(object(pr.base).ref, "main");
  assert.equal(object(object(pr.base).repo).full_name, "ubugeeei-prod/vize");
  assert.equal(object(object(pr.head).repo).full_name, "ubugeeei-prod/vize");
  assert.equal(object(pr.head).ref, "fix/patina-project-component-context-8142");
  assert.ok(typeof pr.merge_commit_sha === "string" && /^[a-f0-9]{40}$/u.test(pr.merge_commit_sha));
  execFileSync(
    "git",
    ["--no-replace-objects", "-C", root, "merge-base", "--is-ancestor", pr.merge_commit_sha, cut],
    { timeout: 5000 },
  );
  const original = readRawBlob(root, head, componentCorpus);
  cases(original);
  const harness = componentHarness.map((file) => {
    const bytes = readRawBlob(root, head, `tools/support/release/public_acceptance/${file}`);
    assert.equal(
      sha256(bytes),
      sha256(readFileSync(fileURLToPath(new URL(file, import.meta.url)))),
      `executing component harness must equal frozen H: ${file}`,
    );
    return { file, sha256: sha256(bytes) };
  });
  return {
    original,
    receipt: {
      sourcePr: 8497,
      mergeCommit: pr.merge_commit_sha,
      mergedAt: pr.merged_at,
      includedInCut: cut,
      frozenHead: head,
      originalComponentSource: "c0dc03760aaf8cdb4810e3ed0417c668a36c4721",
      corpus: componentCorpus,
      corpusSHA256: componentCorpusSHA256,
      cases: 30,
      harness,
    },
  };
}
