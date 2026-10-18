/** Shared checked-provider identity, complete source inventories and Cargo archive laws. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { gunzipSync } from "node:zlib";

// Reuse the repository's full TOML parser; Cargo.lock and normalized manifests
// must not be interpreted by a partial manifest-specific parser.
export function toml(value: string): any {
  const parsed = createRequire(import.meta.url)("@iarna/toml").parse(value);
  // This existing parser wraps out-of-range TOML integer tokens to signed i64.
  // Reject its bigint path explicitly; never emit a rounded/wrapped identity.
  // JSON process packets below retain arbitrary integer tokens losslessly.
  const check = (item: unknown) => {
    requireThat(
      typeof item !== "bigint",
      "unsafe TOML integer refused; exact safe integer required",
    );
    if (item && typeof item === "object") for (const child of Object.values(item)) check(child);
  };
  check(parsed);
  return parsed;
}
/** Python JSON integers are arbitrary precision. Node 24 supplies the original
 * number token to the reviver; retain unsafe integers as bigint internally and
 * write raw JSON numbers, preserving the existing numeric wire protocol. */
export function parseJson(value: string): any {
  return JSON.parse(value, (_key, item, context?: { source?: string }) => {
    if (typeof item !== "number") return item;
    requireThat(Number.isFinite(item), "nonfinite JSON number refused");
    if (Number.isInteger(item) && !Number.isSafeInteger(item)) {
      requireThat(context?.source, "original JSON number token required");
      if (/^-?(?:0|[1-9][0-9]*)$/u.test(context.source)) return BigInt(context.source);
    }
    return item;
  });
}
export function stringifyJson(value: unknown, space?: number): string {
  requireThat(
    space === undefined || space === 2,
    "checked JSON supports original default or indent=2",
  );
  const encoded = JSON.stringify(
    value,
    (_key, item) =>
      typeof item === "bigint"
        ? (JSON as typeof JSON & { rawJSON(value: string): unknown }).rawJSON(item.toString())
        : item,
    space,
  );
  requireThat(typeof encoded === "string", "unsupported JSON root value");
  // Match json.dumps' default ensure_ascii, including DEL, astral UTF-16
  // pairs and lone surrogates. Built-in JSON escaping handles ASCII controls.
  const ascii = encoded.replace(
    /[\u007f-\uffff]/g,
    (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
  if (space !== undefined) return ascii;
  let quoted = false,
    escaped = false,
    result = "";
  for (const character of ascii) {
    result += character;
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') quoted = false;
    } else if (character === '"') quoted = true;
    else if (character === "," || character === ":") result += " ";
  }
  return result;
}
/** Command durations are Python floats even when rounded to whole seconds. */
export function jsonDuration(value: number): { readonly rawJSON: string } {
  requireThat(Number.isFinite(value) && value >= 0, "finite command duration required");
  const token = Number.isInteger(value) ? `${value}.0` : String(value);
  return (JSON as typeof JSON & { rawJSON(value: string): { readonly rawJSON: string } }).rawJSON(
    token,
  );
}
export const readToml = (file: string) => toml(fs.readFileSync(file, "utf8"));
export const digest = (body: Uint8Array) => createHash("sha256").update(body).digest("hex");
export const ALIASES = [
  "corsa_core",
  "corsa_jsonrpc",
  "corsa_client",
  "corsa_lsp",
  "corsa_orchestrator",
  "corsa",
];
export const OWNED = new Set(ALIASES.map((name) => `vize_${name}`));
export const REGISTRY = "registry+https://github.com/rust-lang/crates.io-index";
export const RUNTIME_VERSION = "1.14.2";
export const GENERATED = new Set([
  "Cargo.toml",
  "Cargo.toml.orig",
  "Cargo.lock",
  ".cargo_vcs_info.json",
]);
export const PROFILE = [
  "--profile",
  "ci",
  "--config",
  'profile.ci.inherits="dev"',
  "--config",
  "profile.ci.debug=false",
  "--config",
  "profile.ci.incremental=false",
  "--config",
  "profile.ci.codegen-units=256",
];
export type Bodies = Record<string, Buffer>;
export type Providers = Record<string, [string, string | null]>;
export type Metadata = { packages: any[]; resolve: { root?: string; nodes: any[] } };
export const requireThat: (condition: unknown, message: string) => asserts condition = (
  condition,
  message,
) => assert.ok(condition, message);
export const sameSet = (a: Iterable<string>, b: Iterable<string>) =>
  assert.deepEqual([...a].sort(), [...b].sort());
export const jsonLines = (output: string) => {
  // Match Python str.splitlines(), including its Unicode line separators.
  const separators = new Set([10, 11, 12, 13, 28, 29, 30, 133, 8232, 8233]);
  const lines: string[] = [];
  let start = 0;
  for (let index = 0; index < output.length; index++) {
    const character = output.charCodeAt(index);
    if (!separators.has(character)) continue;
    lines.push(output.slice(start, index));
    if (character === 13 && output.charCodeAt(index + 1) === 10) index++;
    start = index + 1;
  }
  if (start < output.length) lines.push(output.slice(start));
  return lines.map((line) => parseJson(line));
};
/** Match Path.resolve() for existing symlinks and not-yet-created roots. */
export function physicalPath(...parts: string[]): string {
  const value = path.resolve(...parts);
  if (fs.existsSync(value)) return fs.realpathSync(value);
  const parent = path.dirname(value);
  return parent === value ? value : path.join(physicalPath(parent), path.basename(value));
}
export function files(directory: string): string[] {
  const result: string[] = [];
  const walk = (relative: string) => {
    for (const entry of fs.readdirSync(path.join(directory, relative), { withFileTypes: true })) {
      const name = path.join(relative, entry.name);
      requireThat(!entry.isSymbolicLink(), "symlink in package source inventory");
      if (entry.isDirectory()) walk(name);
      else {
        requireThat(entry.isFile(), "nonregular package source member");
        result.push(name.split(path.sep).join("/"));
      }
    }
  };
  walk("");
  return result;
}
export function isolatedManifest(manifest: string, name: string) {
  requireThat(/^[a-z0-9-]+$/u.test(name) && !name.includes("\n"), "invalid consumer identity");
  const original = toml(manifest).package.name;
  const before = `name = ${stringifyJson(original)}`;
  requireThat(manifest.split(before).length === 2, "ambiguous consumer package name");
  return manifest.replace(before, `name = ${stringifyJson(`${original}-${name}`)}`);
}
export function verifyConsumerBuild(stdout: string, directory: string) {
  const manifest = physicalPath(directory, "Cargo.toml");
  const name = readToml(manifest).package.name.replaceAll("-", "_");
  const artifacts = jsonLines(stdout).filter(
    (row) =>
      row.reason === "compiler-artifact" &&
      physicalPath(row.manifest_path) === manifest &&
      stringifyJson(row.target.kind) === '["lib"]',
  );
  requireThat(artifacts.length === 1, "build must report exactly one consumer library artifact");
  const artifact = artifacts[0];
  requireThat(
    artifact.fresh === false,
    "consumer root must actually compile, not reuse another cached root",
  );
  requireThat(
    artifact.target.name === name &&
      physicalPath(artifact.target.src_path) === physicalPath(directory, "src/lib.rs"),
    "compiled consumer source identity mismatch",
  );
  return Object.fromEntries(
    ["package_id", "manifest_path", "target", "fresh", "features", "filenames"].map((key) => [
      key,
      artifact[key],
    ]),
  );
}

/** Cargo's gzip TAR, read without extraction or shelling out. GNU/PAX names are
 * decoded before applying the same complete member law as the Python reader.
 * Header/length/end checks follow consumer_recovery/archive.ts's strict reader. */
export function archiveMembers(archive: string, prefix: string): Bodies {
  const tar = gunzipSync(fs.readFileSync(archive), { maxOutputLength: 512 * 1024 * 1024 });
  const bodies: Bodies = Object.create(null);
  const text = (bytes: Buffer) =>
    new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  const field = (bytes: Buffer) =>
    text(bytes.subarray(0, bytes.indexOf(0) < 0 ? bytes.length : bytes.indexOf(0)));
  const octal = (bytes: Buffer) => {
    const value = text(bytes).replaceAll("\0", " ").trim();
    requireThat(/^[0-7]+$/u.test(value), "invalid TAR number");
    const result = Number.parseInt(value, 8);
    requireThat(Number.isSafeInteger(result), "unbounded TAR number");
    return result;
  };
  let offset = 0,
    pending: string | undefined,
    terminated = false,
    count = 0;
  requireThat(tar.length >= 1024 && tar.length % 512 === 0, "whole TAR blocks required");
  while (offset < tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) {
      requireThat(
        tar.length - offset >= 1024 && tar.subarray(offset).every((byte) => byte === 0),
        "complete TAR end required",
      );
      terminated = true;
      break;
    }
    requireThat(++count <= 100_000, "too many TAR entries");
    const sum = header.reduce(
      (total, byte, index) => total + (index >= 148 && index < 156 ? 32 : byte),
      0,
    );
    requireThat(sum === octal(header.subarray(148, 156)), "TAR checksum mismatch");
    const size = octal(header.subarray(124, 136));
    const end = offset + 512 + size,
      next = offset + 512 + Math.ceil(size / 512) * 512;
    requireThat(next <= tar.length, "truncated TAR member");
    const body = tar.subarray(offset + 512, end);
    requireThat(
      tar.subarray(end, next).every((byte) => byte === 0),
      "nonzero TAR padding",
    );
    offset = next;
    const type = String.fromCharCode(header[156]);
    if (type === "L" || type === "x") {
      requireThat(pending === undefined, "overlapping TAR name overrides");
      if (type === "L") {
        requireThat(body.at(-1) === 0, "terminated GNU name required");
        pending = field(body);
      } else {
        let position = 0;
        const values = new Map<string, string>();
        while (position < body.length) {
          const space = body.indexOf(32, position),
            lengthText = text(body.subarray(position, space));
          requireThat(space > position && /^[1-9][0-9]*$/u.test(lengthText), "invalid PAX length");
          const length = Number(lengthText),
            finish = position + length;
          requireThat(
            Number.isSafeInteger(length) &&
              finish <= body.length &&
              finish > space + 2 &&
              body[finish - 1] === 10,
            "truncated PAX record",
          );
          const value = text(body.subarray(space + 1, finish - 1)),
            equals = value.indexOf("=");
          const key = value.slice(0, equals);
          requireThat(
            equals > 0 &&
              !values.has(key) &&
              !["size", "linkpath"].includes(key) &&
              !key.startsWith("GNU.sparse."),
            "unsupported/duplicate PAX override",
          );
          values.set(key, value.slice(equals + 1));
          position = finish;
        }
        requireThat(values.has("path"), "PAX member path required");
        pending = values.get("path");
      }
      continue;
    }
    requireThat(
      (type === "0" || type === "\0") && !field(header.subarray(157, 257)),
      "foreign/nonregular archive member",
    );
    requireThat(
      octal(header.subarray(100, 108)) === 0o644,
      "archive regular member mode must be0644",
    );
    const magic = field(header.subarray(257, 263));
    requireThat(["", "ustar", "ustar "].includes(magic), "unsupported TAR format");
    const tarPrefix = magic === "ustar" ? field(header.subarray(345, 500)) : "";
    const name = pending ?? [tarPrefix, field(header.subarray(0, 100))].filter(Boolean).join("/");
    pending = undefined;
    requireThat(name.startsWith(prefix + "/"), "foreign/nonregular archive member");
    const relative = name.slice(prefix.length + 1);
    requireThat(
      relative.length > 0 &&
        !/[\\\0]/u.test(relative) &&
        relative.split("/").every((part) => part && part !== "." && part !== "..") &&
        !Object.hasOwn(bodies, relative),
      "unsafe/duplicate archive path",
    );
    bodies[relative] = Buffer.from(body);
  }
  requireThat(terminated && pending === undefined, "complete TAR without pending name required");
  return bodies;
}
export function verifyPackagedSource(directory: string, bodies: Bodies) {
  const exclusions: string[] = readToml(path.join(directory, "Cargo.toml")).package.exclude ?? [];
  requireThat(
    exclusions.every((name) => GENERATED.has(name) && name !== "Cargo.toml"),
    "only reserved Cargo source files may be excluded",
  );
  const source = files(directory),
    expected = source.filter((name) => !GENERATED.has(name));
  requireThat(
    Object.hasOwn(bodies, "LICENSE") && source.includes("LICENSE"),
    "archive must preserve LICENSE",
  );
  requireThat(
    bodies.LICENSE.equals(fs.readFileSync(path.join(directory, "LICENSE"))),
    "archive LICENSE bytes changed",
  );
  requireThat(
    stringifyJson(Object.keys(bodies).sort()) ===
      stringifyJson(
        [...expected, ...[...GENERATED].filter((name) => name !== "Cargo.lock")].sort(),
      ),
    "archive member inventory differs",
  );
  for (const relative of expected)
    requireThat(
      bodies[relative].equals(fs.readFileSync(path.join(directory, relative))),
      `archived source/readme/license changed: ${relative}`,
    );
  return expected.sort();
}
export function verifyGraph(
  metadata: Metadata,
  version: string,
  providers: Providers,
  distributed: boolean,
) {
  const owned = metadata.packages.filter((pkg) => OWNED.has(pkg.name));
  requireThat(
    owned.length === OWNED.size && new Set(owned.map((pkg) => pkg.name)).size === OWNED.size,
    "consumer must resolve exactly the six owned packages",
  );
  requireThat(
    !metadata.packages.some((pkg) => ALIASES.includes(pkg.name)),
    "upstream six-package graph leaked in",
  );
  const runtime = metadata.packages.filter((pkg) => pkg.name === "corsa_runtime");
  requireThat(
    runtime.length === 1 &&
      runtime[0].version === RUNTIME_VERSION &&
      runtime[0].source === REGISTRY,
    `runtime must remain the unique published ${RUNTIME_VERSION} provider`,
  );
  const nodes = new Map(metadata.resolve.nodes.map((node) => [node.id, node]));
  return owned.map((pkg) => {
    requireThat(pkg.version === version, "owned package version differs from workspace");
    const [manifest, source] = providers[pkg.name];
    requireThat(
      physicalPath(pkg.manifest_path) === physicalPath(manifest) && pkg.source === source,
      "unexpected consumer package provider",
    );
    const features = nodes.get(pkg.id).features;
    if (["vize_corsa", "vize_corsa_orchestrator"].includes(pkg.name))
      requireThat(
        features.includes("experimental-distributed") === distributed,
        "experimental feature activation differs from consumer request",
      );
    return {
      name: pkg.name,
      version: pkg.version,
      source: pkg.source,
      manifest: pkg.manifest_path,
      features,
    };
  });
}

/** Cargo's only observed normalization of these six complete owned manifests. */
export function verifyNormalizedManifest(
  sourceFile: string,
  workspaceFile: string,
  alias: string,
  actual: unknown,
) {
  const source = readToml(sourceFile),
    workspace = readToml(workspaceFile).workspace;
  const inheritedAlias = (name: string) => {
    requireThat(ALIASES.includes(name), "unknown owned manifest alias");
    assert.deepEqual(workspace.dependencies[name], {
      package: `vize_${name}`,
      version: `=${workspace.package.version}`,
      path: `vendor/${name}`,
    });
    return workspace.dependencies[name];
  };
  inheritedAlias(alias);
  requireThat(
    physicalPath(sourceFile) ===
      physicalPath(path.dirname(workspaceFile), "vendor", alias, "Cargo.toml"),
    "owned source manifest path differs",
  );
  requireThat(
    source.package.name === `vize_${alias}` && source.lib.name === alias,
    "owned source package/lib mismatch",
  );
  assert.deepEqual(source.package.version, { workspace: true });
  requireThat(
    source.package.resolver === "2" && workspace.resolver === "3",
    "unexpected owned resolver inheritance",
  );
  sameSet(source.package.exclude, [".cargo_vcs_info.json", "Cargo.toml.orig"]);
  const expected = structuredClone(source);
  expected.package.version = workspace.package.version;
  expected.package.resolver = workspace.resolver;
  for (const section of ["dependencies", "dev-dependencies", "build-dependencies"])
    for (const [name, dependency] of Object.entries(expected[section] ?? {})) {
      if (
        !(
          dependency &&
          typeof dependency === "object" &&
          "workspace" in dependency &&
          dependency.workspace === true
        )
      )
        continue;
      assert.deepEqual(dependency, { workspace: true });

      expected[section][name] = Object.fromEntries(
        Object.entries(inheritedAlias(name)).filter(([key]) => key !== "path"),
      );
    }
  assert.deepEqual(actual, expected, "complete normalized Cargo manifest differs");
}

type RegistryLock = {
  package?: { name?: string; version?: string; source?: string; checksum?: string }[];
};
/** Read the consumer lock AFTER metadata; a copied seed lock is not this evidence. */
export function verifyRegistryLock(metadata: Metadata, root: RegistryLock, consumer: RegistryLock) {
  requireThat(
    Array.isArray(root.package) && Array.isArray(consumer.package),
    "complete registry lock packages required",
  );
  const tuple = (
    a: { name?: string; version?: string; source?: string },
    b: { name?: string; version?: string; source?: string },
  ) => a.name === b.name && a.version === b.version && a.source === b.source;
  const registry = metadata.packages.filter(
    (pkg) =>
      typeof pkg.source === "string" && pkg.source.startsWith("registry+") && !OWNED.has(pkg.name),
  );
  const seen = new Set<string>();
  for (const pkg of registry) {
    const key = stringifyJson([pkg.name, pkg.version, pkg.source]);
    requireThat(!seen.has(key), "duplicate registry metadata tuple");
    seen.add(key);
    const expected = root.package.filter((entry) => tuple(entry, pkg));
    const actual = consumer.package.filter((entry) => tuple(entry, pkg));
    requireThat(
      expected.length === 1 && actual.length === 1,
      "registry tuple missing or ambiguous after metadata",
    );
    requireThat(
      typeof expected[0].checksum === "string" &&
        /^[a-f0-9]{64}$/u.test(expected[0].checksum) &&
        actual[0].checksum === expected[0].checksum,
      "registry checksum differs from current source lock",
    );
  }
  for (const pkg of consumer.package.filter(
    (entry) =>
      typeof entry.source === "string" &&
      entry.source.startsWith("registry+") &&
      !OWNED.has(entry.name ?? ""),
  )) {
    const expected = root.package.filter((entry) => tuple(entry, pkg));
    requireThat(
      expected.length === 1 &&
        expected[0].checksum === pkg.checksum &&
        typeof pkg.checksum === "string" &&
        /^[a-f0-9]{64}$/u.test(pkg.checksum),
      "consumer lock introduced a foreign registry tuple/checksum",
    );
  }
  return registry.length;
}
