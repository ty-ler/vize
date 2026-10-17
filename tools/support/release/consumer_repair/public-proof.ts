import assert from "node:assert/strict";
import { createPublicKey, verify } from "node:crypto";
import { object, repair457, type ObjectValue } from "./contract.ts";
import type { PublicationPlan } from "../public_acceptance/plan.ts";

/** Additional existing 0.457.0 closure requirements: JSR bytes, registry ECDSA,
 * decoded SLSA source/digest/workflow, and complete own release asset metadata.
 * This does not claim Sigstore verification. Public tarball/crate byte digests
 * remain the responsibility of the unchanged verifyPublication checks. */
export async function verifyAdditionalPublicProof(
  plan: PublicationPlan,
  release: ObjectValue,
  readBlob: (path: string) => Buffer,
  reader: {
    json: (url: string) => Promise<ObjectValue>;
    download: (url: string) => Promise<{ sha256: string; bytes: number }>;
  },
) {
  const keys = await reader.json("https://registry.npmjs.org/-/npm/v1/keys");
  assert.ok(Array.isArray(keys.keys));
  const keyMap = new Map((keys.keys as ObjectValue[]).map((key) => [key.keyid, key]));
  const npm = [];
  for (const item of plan.npm) {
    const metadata = await reader.json(
      `https://registry.npmjs.org/${encodeURIComponent(item.name)}/0.457.0`,
    );
    assert.equal(metadata.name, item.name);
    assert.equal(metadata.version, "0.457.0");
    const dist = object(metadata.dist),
      integrity = String(dist.integrity);
    assert.match(integrity, /^sha512-[A-Za-z0-9+/]{86}==$/);
    const url = new URL(String(object(dist.attestations).url));
    assert.equal(url.origin, "https://registry.npmjs.org");
    assert.equal(url.username + url.password + url.hash, "");
    const attestation = await reader.json(url.href);
    const statements: ObjectValue[] = [];
    function walk(value: unknown) {
      if (Array.isArray(value)) {
        for (const child of value) walk(child);
      } else if (value && typeof value === "object") {
        const record = value as ObjectValue;
        if (typeof record.payload === "string")
          statements.push(
            JSON.parse(Buffer.from(record.payload, "base64").toString()) as ObjectValue,
          );
        for (const child of Object.values(record)) walk(child);
      }
    }
    walk(attestation);
    const slsa = statements.filter((s) => s.predicateType === "https://slsa.dev/provenance/v1");
    assert.equal(slsa.length, 1);
    const statement = slsa[0]!,
      predicate = object(statement.predicate),
      definition = object(predicate.buildDefinition);
    assert.ok(
      (definition.resolvedDependencies as ObjectValue[]).some(
        (d) => object(d.digest).gitCommit === repair457.head,
      ),
    );
    const digest = Buffer.from(integrity.slice(7), "base64").toString("hex");
    assert.ok((statement.subject as ObjectValue[]).some((s) => object(s.digest).sha512 === digest));
    assert.deepEqual(object(definition.externalParameters).workflow, {
      ref: "refs/heads/release/v0.457.0",
      repository: `https://github.com/${repair457.repository}`,
      path: ".github/workflows/release.yml",
    });
    assert.match(
      String(object(object(predicate.runDetails).metadata).invocationId),
      /^https:\/\/github\.com\/ubugeeei-prod\/vize\/actions\/runs\/38805261385\/attempts\/[1-4]$/,
    );
    assert.ok(Array.isArray(dist.signatures) && dist.signatures.length > 0);
    for (const signature of dist.signatures as ObjectValue[]) {
      const key = keyMap.get(signature.keyid);
      assert.ok(key, "unknown registry signature key");
      const pem = `-----BEGIN PUBLIC KEY-----\n${String(key.key)}\n-----END PUBLIC KEY-----\n`;
      assert.equal(
        verify(
          "SHA256",
          Buffer.from(`${item.name}@0.457.0:${integrity}`),
          createPublicKey(pem),
          Buffer.from(String(signature.sig), "base64"),
        ),
        true,
        "npm registry signature mismatch",
      );
    }
    npm.push({
      name: item.name,
      metadata,
      attestation,
      signaturesVerified: dist.signatures.length,
      sigstoreVerified: false,
    });
  }
  const manifest = JSON.parse(readBlob("jsr/vize/jsr.json").toString()) as ObjectValue;
  assert.equal(manifest.name, "@vizejs/vize");
  assert.deepEqual(JSON.parse(readBlob("jsr/vize/channel.json").toString()), { enabled: true });
  const jsr = await reader.json("https://jsr.io/@vizejs/vize/0.457.0_meta.json");
  assert.deepEqual(jsr.exports, manifest.exports);
  const members = Object.entries(object(jsr.manifest));
  assert.ok(members.length > 0);
  const jsrFiles = [];
  for (const [name, value] of members) {
    assert.match(name, /^\/[A-Za-z0-9_./-]+$/);
    assert.ok(!name.includes("..") && !name.includes("//"));
    const pin = object(value),
      observed = await reader.download(`https://jsr.io/@vizejs/vize/0.457.0${name}`);
    assert.equal(`sha256-${observed.sha256}`, pin.checksum);
    assert.equal(observed.bytes, pin.size);
    jsrFiles.push({ name, ...observed });
  }
  const platforms = readBlob("tools/commands/ci/github/release-platforms.rs").toString();
  const archives = new Set(
    [...platforms.matchAll(/archive: "([^"]+)"/g)].map((match) => match[1]!),
  );
  assert.ok(archives.size > 0);
  for (const name of [
    "vize.vsix",
    "zed-vize-extension.tar.gz",
    "nvim-vize-extension.tar.gz",
    "vim-vize-extension.tar.gz",
    "helix-vize-extension.tar.gz",
    "emacs-vize-extension.tar.gz",
  ])
    archives.add(name);
  const signed = new Set([
    ...archives,
    "vize-v0.457.0-cyclonedx.sbom.json",
    "vize-v0.457.0-spdx.sbom.json",
  ]);
  const required = new Set(signed);
  for (const name of signed)
    for (const suffix of [".sig", ".pem", ".cosign.bundle"]) required.add(name + suffix);
  for (const name of archives) required.add(name + ".sha256");
  assert.ok(Array.isArray(release.assets));
  const assets = release.assets as ObjectValue[];
  assert.equal(new Set(assets.map((asset) => asset.name)).size, assets.length);
  for (const name of required) {
    const asset = assets.find((entry) => entry.name === name);
    assert.ok(asset, `missing release asset ${name}`);
    assert.equal(asset.state, "uploaded");
    assert.ok(Number(asset.size) > 0);
    assert.match(String(asset.digest), /^sha256:[0-9a-f]{64}$/);
  }
  return {
    keys,
    npm,
    jsr,
    jsrFiles,
    requiredAssets: [...required].sort((a, b) => a.localeCompare(b)),
    scope:
      "Fresh npm registry ECDSA verification, decoded SLSA source/digest/workflow, JSR member hashes and own asset metadata. No Sigstore verification claim.",
  };
}
