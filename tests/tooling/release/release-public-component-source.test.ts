import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";
import {
  componentHarness,
  componentSource,
} from "../../../tools/support/release/public_acceptance/component_source.ts";
import {
  componentCorpus,
  componentCorpusSHA256,
  sha256,
} from "../../../tools/support/release/public_acceptance/component_inputs.ts";
import {
  assertComponentReceipt,
  componentPacketCustody,
  componentPacketFiles,
} from "../../../tools/support/release/public_acceptance/component_seal.ts";
import { componentArchive } from "../../../tools/support/release/public_acceptance/component_release.ts";

function fixture(t: TestContext) {
  const root = mkdtempSync(path.join(os.tmpdir(), "vize-component-source-law-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();
  git("init", "-q");
  git("config", "user.name", "fixture");
  git("config", "user.email", "fixture@example.invalid");
  writeFileSync(path.join(root, "base"), "inert source eligibility fixture\n");
  git("add", ".");
  git("commit", "-qm", "fixture before component source");
  const before = git("rev-parse", "HEAD");
  const bytes = readFileSync(new URL("../../../" + componentCorpus, import.meta.url));
  mkdirSync(path.dirname(path.join(root, componentCorpus)), { recursive: true });
  writeFileSync(path.join(root, componentCorpus), bytes);
  for (const file of componentHarness) {
    const destination = path.join(root, "tools/support/release/public_acceptance", file);
    mkdirSync(path.dirname(destination), { recursive: true });
    writeFileSync(
      destination,
      readFileSync(
        new URL("../../../tools/support/release/public_acceptance/" + file, import.meta.url),
      ),
    );
  }
  git("add", ".");
  git("commit", "-qm", "inert complete component source");
  const merged = git("rev-parse", "HEAD");
  const pr = {
    number: 8497,
    merged: true,
    state: "closed",
    merged_at: "2026-10-11T00:00:00Z",
    merge_commit_sha: merged,
    head: {
      ref: "fix/patina-project-component-context-8142",
      repo: { full_name: "ubugeeei-prod/vize" },
    },
    base: { ref: "main", repo: { full_name: "ubugeeei-prod/vize" } },
  };
  const fetchFor =
    (packet: unknown): typeof globalThis.fetch =>
    async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      assert.equal(url, "https://api.github.com/repos/ubugeeei-prod/vize/pulls/8497");
      return new Response(JSON.stringify(packet), { status: 200 });
    };
  return { root, git, before, merged, pr, fetchFor };
}
test("component public eligibility requires the actual merged feature in C and every frozen H harness body", async (t) => {
  const f = fixture(t),
    good = await componentSource(f.root, f.merged, f.merged, f.fetchFor(f.pr));
  assert.equal(sha256(good.original), componentCorpusSHA256);
  assert.equal(good.receipt.cases, 30);
  assert.equal(good.receipt.harness.length, componentHarness.length);
  await assert.rejects(componentSource(f.root, f.before, f.merged, f.fetchFor(f.pr)));
  for (const bad of [
    { merged: false },
    { state: "open" },
    { merged_at: null },
    { number: 1 },
    { base: { ref: "other", repo: { full_name: "ubugeeei-prod/vize" } } },
    {
      head: {
        ref: "fix/patina-project-component-context-8142",
        repo: { full_name: "foreign/vize" },
      },
    },
  ])
    await assert.rejects(
      componentSource(f.root, f.merged, f.merged, f.fetchFor({ ...f.pr, ...bad })),
    );
  for (const file of ["component_cli.ts", "installed.ts"]) {
    const changed = "tools/support/release/public_acceptance/" + file;
    const original = readFileSync(path.join(f.root, changed));
    writeFileSync(path.join(f.root, changed), "unreviewed harness\n");
    f.git("add", changed);
    f.git("commit", "-qm", "inert harness drift");
    await assert.rejects(
      componentSource(f.root, f.merged, f.git("rev-parse", "HEAD"), f.fetchFor(f.pr)),
      /frozen H/u,
    );
    writeFileSync(path.join(f.root, changed), original);
    f.git("add", changed);
    f.git("commit", "-qm", "restore inert fixture");
  }
});
test("final component seal refuses missing packets, source/count drift and changed installed bytes", (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "vize-component-seal-law-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const consumer = path.join(root, "consumer"),
    output = path.join(root, "packets"),
    binary = path.join(consumer, "component-public-cli/vize");
  mkdirSync(path.dirname(binary), { recursive: true });
  mkdirSync(output);
  writeFileSync(binary, "inert binary custody fixture");
  writeFileSync(
    path.join(consumer, "component-cases.json"),
    readFileSync(new URL("../../../" + componentCorpus, import.meta.url)),
  );
  for (const file of componentPacketFiles)
    writeFileSync(
      path.join(output, file),
      JSON.stringify({ inertWholePacketCustodyFixture: file }),
    );
  const archive = path.join(output, componentArchive);
  writeFileSync(archive, "inert public archive custody fixture");
  const archiveSHA256 = sha256(readFileSync(archive)),
    checksum = `${archiveSHA256}  ${componentArchive}\n`;
  writeFileSync(archive + ".sha256", checksum);
  const source = {
    cut: "a".repeat(40),
    head: "b".repeat(40),
    tag: "v0.999.0",
    sourcePr: "123",
    run: "456",
  };
  const receipt = {
    schema: "vize.public-component-policy-transport-v1",
    source,
    version: "0.999.0",
    success: true,
    corpusSHA256: componentCorpusSHA256,
    installed: {
      source,
      binary: { path: binary, sha256: sha256(readFileSync(binary)) },
      archive: { path: archive, sha256: archiveSHA256 },
      sidecar: { checksum },
    },
    packetFiles: componentPacketCustody(output),
    observations: {
      cli: { success: true, result: { packets: 180 } },
      lsp: { success: true, result: { packets: 90 } },
      oneEvaluation: { success: true, result: { packets: 6 } },
      policyReplacement: { success: true, result: { packets: 4 } },
    },
  };
  assertComponentReceipt(receipt, source, consumer, output);
  for (const bad of [
    { success: false },
    { version: "0.998.0" },
    { corpusSHA256: "0".repeat(64) },
    { source: { ...source, head: "c".repeat(40) } },
    { packetFiles: receipt.packetFiles.slice(1) },
  ])
    assert.throws(() => assertComponentReceipt({ ...receipt, ...bad }, source, consumer, output));
  for (const [name, observation] of Object.entries(receipt.observations))
    assert.throws(() =>
      assertComponentReceipt(
        {
          ...receipt,
          observations: {
            ...receipt.observations,
            [name]: { ...observation, result: { packets: observation.result.packets - 1 } },
          },
        },
        source,
        consumer,
        output,
      ),
    );
  for (const file of componentPacketFiles) {
    const destination = path.join(output, file),
      original = readFileSync(destination);
    writeFileSync(destination, Buffer.concat([original, Buffer.from(" ")]));
    assert.throws(() => assertComponentReceipt(receipt, source, consumer, output), /packet file/u);
    writeFileSync(destination, original);
  }
  writeFileSync(binary, "changed inert installed bytes");
  assert.throws(() => assertComponentReceipt(receipt, source, consumer, output));
});
