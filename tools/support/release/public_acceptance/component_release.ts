import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { open } from "node:fs/promises";
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import { save, sha256 } from "./component_inputs.ts";
import { verifyGithub } from "./github.ts";
import { publicReader } from "./http.ts";
import { rejectOverrides } from "./installed.ts";
import type { PublicationOptions } from "./registry.ts";

export const componentArchive = "vize-x86_64-unknown-linux-gnu.tar.gz";
type ObjectValue = Record<string, unknown>;
function object(value: unknown): ObjectValue {
  assert.ok(value && typeof value === "object" && !Array.isArray(value));
  return value as ObjectValue;
}
export function componentAsset(release: ObjectValue, tag: string, name: string) {
  assert.match(tag, /^v0\.[1-9][0-9]*\.0$/u);
  assert.ok(name === componentArchive || name === `${componentArchive}.sha256`);
  assert.equal(release.tag_name, tag);
  assert.equal(release.draft, false);
  assert.equal(release.prerelease, false);
  assert.ok(Array.isArray(release.assets));
  const matches = release.assets.map(object).filter((asset) => asset.name === name);
  assert.equal(matches.length, 1, `one exact public asset: ${name}`);
  const asset = matches[0],
    url = `https://github.com/ubugeeei-prod/vize/releases/download/${tag}/${name}`;
  assert.equal(asset.state, "uploaded");
  assert.ok(typeof asset.id === "number" && Number.isSafeInteger(asset.id) && asset.id > 0);
  assert.ok(typeof asset.size === "number" && Number.isSafeInteger(asset.size) && asset.size > 0);
  assert.equal(asset.browser_download_url, url);
  return { id: asset.id, name, size: asset.size, url };
}
export function requireComponentChecksum(checksum: string, digest: string) {
  assert.match(digest, /^[a-f0-9]{64}$/u);
  assert.equal(
    checksum,
    `${digest}  ${componentArchive}\n`,
    "exact CLI archive sidecar digest/name",
  );
}
async function download(url: string, destination: string, expectedBytes: number) {
  assert.ok(expectedBytes <= 128 * 1024 * 1024, "bounded public CLI archive");
  const response = await fetch(url, {
    credentials: "omit",
    redirect: "follow",
    signal: AbortSignal.timeout(30_000),
    headers: { "User-Agent": "vize-public-component-context" },
  });
  assert.ok(response.ok && response.body, `public CLI HTTP ${response.status}`);
  const file = await open(destination, "wx"),
    reader = response.body.getReader();
  let bytes = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      assert.ok(bytes <= expectedBytes, "public archive exceeds authenticated asset size");
      await file.writeFile(part.value);
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
    await file.close();
  }
  assert.equal(bytes, expectedBytes, "complete public asset bytes");
  return sha256(readFileSync(destination));
}
export function requireVersion(
  binary: string,
  version: string,
  output?: string,
  filename = "initial-version-packet.json",
) {
  rejectOverrides();
  const actual = spawnSync(binary, ["--version"], { timeout: 5000 });
  const stdout = actual.stdout?.toString("utf8") ?? "",
    stderr = actual.stderr?.toString("utf8") ?? "";
  const stdoutBase64 = actual.stdout?.toString("base64") ?? "",
    stderrBase64 = actual.stderr?.toString("base64") ?? "";
  if (output)
    save(output, filename, {
      args: ["--version"],
      status: actual.status,
      signal: actual.signal,
      stdout,
      stderr,
      stdoutBase64,
      stderrBase64,
      error: actual.error ? String(actual.error) : null,
    });
  assert.equal(actual.error, undefined);
  assert.equal(actual.signal, null);
  assert.equal(actual.status, 0);
  assert.equal(stderrBase64, "");
  assert.equal(Buffer.from(stdout).toString("base64"), stdoutBase64);
  assert.equal(stdout, `vize ${version}\n`);
  return {
    args: ["--version"],
    status: actual.status,
    signal: actual.signal,
    stdout,
    stderr,
    stdoutBase64,
    stderrBase64,
  };
}
/** Install only authenticated, published CLI archive bytes; source builds and npm wrappers are never invoked. */
export async function installComponentCli(
  source: PublicationOptions,
  consumer: string,
  output: string,
) {
  rejectOverrides();
  assert.equal(process.platform, "linux");
  assert.equal(process.arch, "x64");
  const { json, text } = publicReader();
  const publication = await verifyGithub(source, json);
  save(output, "release-source.json", { source, publication });
  const archive = componentAsset(publication.release, source.tag, componentArchive);
  const sidecar = componentAsset(publication.release, source.tag, `${componentArchive}.sha256`);
  const directory = path.join(consumer, "component-public-cli");
  mkdirSync(directory, { recursive: false });
  const archivePath = path.join(output, componentArchive),
    checksum = await text(sidecar.url, "follow");
  assert.equal(Buffer.byteLength(checksum), sidecar.size);
  writeFileSync(path.join(output, sidecar.name), checksum, { flag: "wx" });
  const archiveSha256 = await download(archive.url, archivePath, archive.size);
  requireComponentChecksum(checksum, archiveSha256);
  const members = execFileSync("tar", ["-tzf", archivePath], { encoding: "utf8", timeout: 5000 });
  assert.equal(members, "vize\n", "one exact executable member");
  const description = execFileSync("tar", ["-tvzf", archivePath], {
    encoding: "utf8",
    timeout: 5000,
  });
  assert.match(description, /^-[rwx-]{9} [^\n]+ vize\n$/u, "regular executable, no archive links");
  const bytes = execFileSync("tar", ["-xOzf", archivePath, "vize"], {
    maxBuffer: 256 * 1024 * 1024,
    timeout: 10_000,
  });
  assert.ok(bytes.length > 0);
  const binary = path.join(directory, "vize");
  writeFileSync(binary, bytes, { flag: "wx", mode: 0o755 });
  assert.ok(realpathSync(binary).startsWith(realpathSync(consumer) + path.sep));
  save(output, "installed-binary.json", {
    source,
    archive,
    sidecar,
    archiveSha256,
    checksum,
    binary: { path: binary, sha256: sha256(bytes), bytes: bytes.length },
  });
  const version = source.tag.slice(1),
    versionPacket = requireVersion(binary, version, output);
  const receipt = {
    source,
    releaseId: publication.release.id,
    releaseRun: publication.releaseRun,
    tagObject: publication.tagObject,
    tag: publication.tag,
    sourcePr: publication.source,
    jobs: publication.jobs,
    archive: { ...archive, sha256: archiveSha256, path: archivePath, members, description },
    sidecar: { ...sidecar, checksum },
    binary: { path: binary, sha256: sha256(bytes), bytes: bytes.length, versionPacket },
    qualification:
      "Exact successful public Release, tag/source and asset/sidecar/binary custody; no signature verification claim",
  };
  return { binary, receipt };
}
