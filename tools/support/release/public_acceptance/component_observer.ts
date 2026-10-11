import assert from "node:assert/strict";
import { mkdirSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { cases, componentCorpusSHA256, save, sha256 } from "./component_inputs.ts";
import { observeCli, observeOneEvaluation } from "./component_cli.ts";
import { observeLsp, observePolicyReplacement } from "./component_lsp.ts";
import { installComponentCli, requireVersion } from "./component_release.ts";
import { publicInputs } from "./inputs.ts";
import { rejectOverrides } from "./installed.ts";
import { componentPacketCustody } from "./component_seal.ts";

rejectOverrides();
const source = publicInputs(process.env),
  consumer = realpathSync(process.cwd());
assert.equal(process.env.GITHUB_REPOSITORY, "ubugeeei-prod/vize");
assert.equal(process.env.GITHUB_REF, "refs/heads/main");
assert.equal(consumer, realpathSync(process.env.PUBLIC_CONSUMER!));
assert.ok(
  consumer.startsWith(realpathSync(process.env.RUNNER_TEMP!) + path.sep),
  "fresh external consumer required",
);
const output = path.resolve(process.env.PUBLIC_OUTPUT!, "component-context");
mkdirSync(output, { recursive: false });
const eligibility = JSON.parse(readFileSync(path.join(consumer, "component-source.json"), "utf8"));
save(output, "source-eligibility.json", eligibility);
assert.equal(
  eligibility.success,
  true,
  "release cut must include the merged component source and frozen harness",
);
assert.equal(eligibility.receipt.includedInCut, source.cut);
assert.equal(eligibility.receipt.frozenHead, source.head);
const original = readFileSync(path.join(consumer, "component-cases.json")),
  entries = cases(original);
save(output, "original-inputs.json", {
  originalComponentSource: "c0dc03760aaf8cdb4810e3ed0417c668a36c4721",
  corpusSHA256: componentCorpusSHA256,
  entries,
});
const { binary, receipt } = await installComponentCli(source, consumer, output);
save(output, "installed-cli.json", receipt);
const observations: Record<string, { success: boolean; result?: unknown; error?: string }> = {};
const workspace = path.join(consumer, "component-context-workspaces");
mkdirSync(workspace, { recursive: false });
for (const [name, observe] of [
  ["cli", () => observeCli(binary, path.join(workspace, "cli"), output, entries)],
  ["oneEvaluation", () => observeOneEvaluation(binary, path.join(workspace, "evaluation"), output)],
  ["lsp", () => observeLsp(binary, path.join(workspace, "lsp"), output, entries)],
  [
    "policyReplacement",
    () => observePolicyReplacement(binary, path.join(workspace, "replacement"), output),
  ],
] as const) {
  try {
    observations[name] = { success: true, result: await observe() };
  } catch (error) {
    observations[name] = { success: false, error: String(error) };
  }
  save(output, "observation-status.json", { source, observations, success: false });
}
assert.equal(
  sha256(readFileSync(binary)),
  receipt.binary.sha256,
  "executed public CLI bytes unchanged",
);
assert.equal(
  sha256(readFileSync(path.join(consumer, "component-cases.json"))),
  componentCorpusSHA256,
);
const finalVersion = requireVersion(
  binary,
  source.tag.slice(1),
  output,
  "final-version-packet.json",
);
save(output, "component-context.json", {
  schema: "vize.public-component-policy-transport-v1",
  source,
  version: source.tag.slice(1),
  corpusSHA256: componentCorpusSHA256,
  installed: receipt,
  packetFiles: Object.values(observations).every(({ success }) => success)
    ? componentPacketCustody(output)
    : null,
  observations,
  finalVersion,
  success: Object.values(observations).every(({ success }) => success),
  scope:
    "Original 30 sources, complete 180 CLI and 90 LSP packets, six single evaluations and four sibling reload packets. Other n8n adoption requirements remain separate.",
});
assert.ok(
  Object.values(observations).every(({ success }) => success),
  JSON.stringify(observations),
);
