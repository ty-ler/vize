import assert from "node:assert/strict";
import { readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { componentCorpusSHA256, sha256 } from "./component_inputs.ts";
import type { publicInputs } from "./inputs.ts";
import { componentArchive, requireComponentChecksum } from "./component_release.ts";

export const componentPacketFiles = [
  "original-inputs.json",
  "installed-cli.json",
  "cli-transport.json",
  "cli-one-evaluation.json",
  "lsp-transport.json",
  "lsp-policy-replacement.json",
  "source-eligibility.json",
  "release-source.json",
  "installed-binary.json",
  "initial-version-packet.json",
  "final-version-packet.json",
];
export function componentPacketCustody(output: string) {
  return componentPacketFiles.map((file) => {
    const bytes = readFileSync(path.join(output, file));
    return { file, bytes: bytes.length, sha256: sha256(bytes) };
  });
}
type Source = ReturnType<typeof publicInputs>;
interface Receipt {
  schema: string;
  version: string;
  source: Source;
  success: boolean;
  corpusSHA256: string;
  packetFiles: ReturnType<typeof componentPacketCustody>;
  installed: {
    source: Source;
    binary: { path: string; sha256: string };
    archive: { path: string; sha256: string };
    sidecar: { checksum: string };
  };
  observations: Record<string, { success: boolean; result: { packets: number } }>;
}
export function assertComponentReceipt(
  receipt: Receipt,
  source: Source,
  consumer: string,
  output: string,
) {
  assert.equal(receipt.schema, "vize.public-component-policy-transport-v1");
  assert.deepEqual(receipt.source, source);
  assert.deepEqual(receipt.installed.source, source);
  assert.equal(receipt.version, source.tag.slice(1));
  assert.equal(receipt.success, true);
  assert.equal(receipt.corpusSHA256, componentCorpusSHA256);
  assert.deepEqual(Object.keys(receipt.observations).sort(), [
    "cli",
    "lsp",
    "oneEvaluation",
    "policyReplacement",
  ]);
  for (const [name, count] of [
    ["cli", 180],
    ["lsp", 90],
    ["oneEvaluation", 6],
    ["policyReplacement", 4],
  ] as const) {
    assert.equal(receipt.observations[name].success, true, name);
    assert.equal(receipt.observations[name].result.packets, count, name);
  }
  assert.deepEqual(
    receipt.packetFiles,
    componentPacketCustody(output),
    "every executed complete packet file is unchanged at final seal",
  );
  const binary = realpathSync(receipt.installed.binary.path);
  assert.equal(binary, path.join(realpathSync(consumer), "component-public-cli", "vize"));
  assert.equal(sha256(readFileSync(binary)), receipt.installed.binary.sha256);
  assert.equal(
    realpathSync(receipt.installed.archive.path),
    path.join(realpathSync(output), componentArchive),
  );
  assert.equal(
    sha256(readFileSync(receipt.installed.archive.path)),
    receipt.installed.archive.sha256,
  );
  requireComponentChecksum(receipt.installed.sidecar.checksum, receipt.installed.archive.sha256);
  assert.equal(
    readFileSync(path.join(output, `${componentArchive}.sha256`), "utf8"),
    receipt.installed.sidecar.checksum,
  );
  assert.equal(
    sha256(readFileSync(path.join(consumer, "component-cases.json"))),
    componentCorpusSHA256,
  );
}
