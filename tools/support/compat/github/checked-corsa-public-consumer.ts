/** Optional registry-only post-publication acceptance. Never publishes/registers. */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { Acceptance, MODES } from "./checked-corsa-package-consumer.ts";
import {
  parseJson,
  stringifyJson,
  physicalPath,
  OWNED,
  REGISTRY,
  GENERATED,
  archiveMembers,
  digest,
  files,
  isolatedManifest,
  readToml,
  requireThat,
  sameSet,
  toml,
  verifyGraph,
  type Metadata,
  type Providers,
} from "./checked-corsa-contract.ts";
export const PUBLIC = new Set([...OWNED, "vize_canon"]);
export function validateIdentity(version: string, sourceSha: string) {
  requireThat(
    /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/u.test(version) &&
      !version.includes("\n"),
    "explicit exact release version required",
  );
  requireThat(
    /^[0-9a-f]{40}$/u.test(sourceSha) && sourceSha.length === 40,
    "explicit 40-character release source SHA required",
  );
}
// Resolve existing ancestors too: an output symlink must not smuggle the public
// consumer into the release workspace or behind ancestor Cargo configuration.
export function checkOutsideWorkspace(output: string, root: string) {
  output = physicalPath(output);
  root = physicalPath(root);
  const relative = path.relative(root, output);
  requireThat(
    relative !== "" &&
      (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)),
    "public consumer output must be outside the source workspace",
  );
  for (let ancestor = output; ; ancestor = path.dirname(ancestor)) {
    requireThat(
      !["config", "config.toml"].some((name) => fs.existsSync(path.join(ancestor, ".cargo", name))),
      "ancestor Cargo configuration could replace public dependency sources",
    );
    if (ancestor === path.dirname(ancestor)) break;
  }
}
export function publicEnvironment(
  environment: NodeJS.ProcessEnv,
  home: string,
  target: string,
): NodeJS.ProcessEnv {
  return {
    ...Object.fromEntries(
      Object.entries(environment).filter(
        ([key]) => !key.startsWith("CARGO_") && !/^(?:RUSTC|RUSTDOC|RUSTFLAGS)/u.test(key),
      ),
    ),
    CARGO_HOME: home,
    CARGO_TARGET_DIR: target,
    CARGO_TERM_COLOR: "never",
    CARGO_INCREMENTAL: "0",
  };
}
export function verifyPublicGraph(
  metadata: Metadata,
  version: string,
  home: string,
  directory: string,
  distributed: boolean,
  canon = false,
) {
  const root = metadata.packages.find((pkg) => pkg.id === metadata.resolve.root);
  requireThat(
    root &&
      root.source === null &&
      physicalPath(root.manifest_path) === physicalPath(directory, "Cargo.toml"),
    "unexpected public consumer root",
  );
  const registry = physicalPath(home, "registry/src");
  for (const pkg of metadata.packages) {
    if (pkg.id === root.id) continue;
    const manifest = physicalPath(pkg.manifest_path),
      parent = path.dirname(manifest);
    requireThat(
      pkg.source === REGISTRY &&
        path.dirname(path.dirname(parent)) === registry &&
        path.basename(manifest) === "Cargo.toml" &&
        path.basename(parent) === `${pkg.name}-${pkg.version}`,
      `public dependency must use the fresh crates.io source: ${pkg.name}`,
    );
  }
  const providers: Providers = Object.fromEntries(
    metadata.packages
      .filter((pkg) => OWNED.has(pkg.name))
      .map((pkg) => [pkg.name, [pkg.manifest_path, REGISTRY]]),
  );
  const owned = verifyGraph(metadata, version, providers, distributed);
  if (canon) {
    const candidates = metadata.packages.filter((pkg) => pkg.name === "vize_canon");
    requireThat(
      candidates.length === 1 && candidates[0].version === version,
      "published Canon exact version required",
    );
    const features =
      metadata.resolve.nodes.find((node) => node.id === candidates[0].id)?.features ?? [];
    requireThat(
      ["default", "native"].every((feature) => features.includes(feature)),
      "published Canon must activate default native APIs",
    );
  }
  return {
    ownedPackages: owned,
    packages: metadata.packages.map((pkg) =>
      Object.fromEntries(
        ["id", "name", "version", "source", "manifest_path"].map((key) => [key, pkg[key]]),
      ),
    ),
  };
}
export function archiveEvidence(
  pkg: any,
  home: string,
  lock: any,
  sourceSha: string,
  sourceDirectory: string,
) {
  const { name, version } = pkg,
    prefix = `${name}-${version}`,
    cache = path.join(home, "registry/cache");
  const archives = fs
    .readdirSync(cache)
    .map((entry) => path.join(cache, entry, `${prefix}.crate`))
    .filter((entry) => fs.existsSync(entry));
  requireThat(archives.length === 1, `downloaded public archive missing or ambiguous: ${name}`);
  const archive = archives[0],
    checksum = digest(fs.readFileSync(archive));
  const entries = lock.package.filter(
    (entry: any) => entry.name === name && entry.version === version,
  );
  requireThat(
    entries.length === 1 && entries[0].source === REGISTRY && entries[0].checksum === checksum,
    "downloaded archive does not match the public registry lock checksum",
  );
  const bodies = archiveMembers(archive, prefix),
    manifest = toml(bodies["Cargo.toml"].toString("utf8"));
  requireThat(
    manifest.package.name === name &&
      manifest.package.version === version &&
      manifest.package.license === "MIT",
    "public archive manifest identity/license mismatch",
  );
  const vcs = parseJson(bodies[".cargo_vcs_info.json"].toString("utf8"));
  requireThat(vcs.git.sha1 === sourceSha, "public archive source SHA mismatch");
  requireThat(
    vcs.path_in_vcs === (name === "vize_canon" ? "crates/vize_canon" : `vendor/${name.slice(5)}`),
    "public archive source directory mismatch",
  );
  // Preserve truthful dirty:true from publisher staging; never rewrite VCS evidence.
  requireThat(
    bodies.LICENSE && bodies.LICENSE.equals(fs.readFileSync(path.join(sourceDirectory, "LICENSE"))),
    "public archive must retain the complete expected MIT notice",
  );
  sameSet(
    Object.keys(bodies).filter((relative) => !GENERATED.has(relative)),
    files(sourceDirectory).filter((relative) => !GENERATED.has(relative)),
  );
  const extracted = path.dirname(pkg.manifest_path);
  sameSet(
    files(extracted).filter(
      (relative) => ![".cargo-ok", ".cargo-checksum.json"].includes(relative),
    ),
    Object.keys(bodies),
  );
  for (const [relative, body] of Object.entries(bodies)) {
    requireThat(
      fs.readFileSync(path.join(extracted, relative)).equals(body),
      `compiled registry source differs from archive: ${relative}`,
    );
    if (!GENERATED.has(relative))
      requireThat(
        fs.readFileSync(path.join(sourceDirectory, relative)).equals(body),
        `published source differs from release checkout: ${relative}`,
      );
  }
  return {
    name,
    version,
    source: pkg.source,
    archive,
    checksum,
    vcs,
    normalizedManifest: manifest,
    originalManifest: bodies["Cargo.toml.orig"].toString("utf8"),
    members: Object.fromEntries(
      Object.entries(bodies)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([relative, body]) => [relative, digest(body)]),
    ),
  };
}
export class PublicAcceptance extends Acceptance {
  version = "";
  consumer(name: string, manifest: string, source: Buffer) {
    const parsed = toml(manifest);
    requireThat(
      !["patch", "replace"].some((key) => Object.hasOwn(parsed, key)),
      "public consumers cannot replace dependencies",
    );
    const dependencies = Object.values(parsed.dependencies) as any[];
    requireThat(
      dependencies.every((dependency) =>
        Object.keys(dependency).every((key) => ["package", "version"].includes(key)),
      ),
      "public consumers require version-only registry dependencies",
    );
    requireThat(
      dependencies.every((dependency) => dependency.version === `=${this.version}`),
      "public consumer dependencies must match the explicit exact version",
    );
    const directory = path.join(this.output, name);
    fs.mkdirSync(path.join(directory, "src"), { recursive: true });
    fs.writeFileSync(path.join(directory, "Cargo.toml"), isolatedManifest(manifest, name));
    fs.writeFileSync(path.join(directory, "src/lib.rs"), source);
    return directory;
  }
  metadata(label: string, directory: string, features: string[] = [], locked = false) {
    // Only metadata resolves/downloads. All actual builds are locked/offline.
    return parseJson(
      this.command(
        label,
        [
          "cargo",
          "metadata",
          "--format-version",
          "1",
          ...(locked ? ["--locked"] : []),
          ...features,
        ],
        directory,
      ),
    );
  }
}
export function runPublic(root: string, output: string, version: string, sourceSha: string) {
  validateIdentity(version, sourceSha);
  checkOutsideWorkspace(output, root);
  requireThat(!fs.existsSync(output), "public evidence directory must be new");
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8" });
  requireThat(
    git("rev-parse", "HEAD").trim() === sourceSha &&
      !git("status", "--porcelain") &&
      readToml(path.join(root, "Cargo.toml")).workspace.package.version === version,
    "run public acceptance from the clean exact release checkout",
  );
  fs.mkdirSync(output, { recursive: true });
  const home = path.join(output, "cargo-home"),
    work = path.join(output, "work");
  fs.mkdirSync(home);
  fs.mkdirSync(work);
  const environment = publicEnvironment(process.env, home, path.join(output, "target"));
  environment.RUSTUP_TOOLCHAIN = readToml(path.join(root, "rust-toolchain.toml")).toolchain.channel;
  const runner = new PublicAcceptance(work, path.join(output, "evidence"), sourceSha, environment);
  runner.version = version;
  runner.command("cargo-version", ["cargo", "-Vv"], work);
  runner.command("rustc-version", ["rustc", "-Vv"], work);
  const fixture = path.join(root, "tests/_fixtures/ci/checked-corsa-consumer"),
    template = fs
      .readFileSync(path.join(fixture, "Cargo.toml"), "utf8")
      .replaceAll('version = "*"', `version = "=${version}"`);
  const consumer = runner.consumer(
    "public-six",
    template,
    fs.readFileSync(path.join(fixture, "src/lib.rs")),
  );
  const graphs = [],
    metadataValues: [Metadata, string][] = [];
  for (const [mode, features] of MODES) {
    const metadata = runner.metadata(`public-${mode}-metadata`, consumer, features);
    graphs.push({
      mode,
      ...verifyPublicGraph(metadata, version, home, consumer, features.length > 0),
      lockPackages: readToml(path.join(consumer, "Cargo.lock")).package,
    });
    metadataValues.push([metadata, consumer]);
  }
  runner.builds("public-six", consumer);
  const manifest =
    '[package]\nname = "public-canon-consumer"\nversion = "0.0.0"\nedition = "2024"\n[workspace]\n[dependencies]\nvize_canon = { version = "=' +
    version +
    '" }\n';
  const canon = runner.consumer(
    "public-canon-default",
    manifest,
    fs.readFileSync(path.join(root, "tests/_fixtures/ci/checked-canon-consumer/lib.rs")),
  );
  const metadata = runner.metadata("public-canon-default-metadata", canon);
  graphs.push({
    mode: "canon-default-native",
    ...verifyPublicGraph(metadata, version, home, canon, false, true),
    lockPackages: readToml(path.join(canon, "Cargo.lock")).package,
  });
  metadataValues.push([metadata, canon]);
  runner.buildOnce("public-canon", "default-native", canon);
  const archives = new Map<string, unknown>();
  for (const [metadata, directory] of metadataValues)
    for (const pkg of metadata.packages) {
      if (!PUBLIC.has(pkg.name) || archives.has(pkg.name)) continue;
      const source = path.join(
        root,
        pkg.name === "vize_canon" ? "crates/vize_canon" : `vendor/${pkg.name.slice(5)}`,
      );
      archives.set(
        pkg.name,
        archiveEvidence(pkg, home, readToml(path.join(directory, "Cargo.lock")), sourceSha, source),
      );
    }
  sameSet(archives.keys(), PUBLIC);
  requireThat(
    !["config", "config.toml"].some((name) => fs.existsSync(path.join(home, name))),
    "fresh Cargo home acquired dependency source configuration",
  );
  for (const directory of [home, work, runner.output, consumer, canon])
    requireThat(
      !["config", "config.toml"].some((name) =>
        fs.existsSync(path.join(directory, ".cargo", name)),
      ),
      "Cargo configuration appeared during public acceptance",
    );
  requireThat(
    runner.command("release-final-head", ["git", "rev-parse", "HEAD"], root).trim() === sourceSha &&
      !runner.command("release-final-status", ["git", "status", "--porcelain"], root),
    "release checkout changed during public acceptance",
  );
  fs.writeFileSync(
    path.join(runner.output, "receipt.json"),
    stringifyJson(
      {
        sourceSha,
        version,
        commands: runner.commands,
        consumerBuilds: runner.consumerBuilds,
        graphs,
        archives: [...archives.values()],
        publicRegistryAcceptance: true,
        sixDefaultAndDistributedCompiledAndTested: true,
        canonDefaultNativeCompiled: true,
        cliVariantsCompiled: false,
        cliPackagePublishable: false,
        freshCargoHome: home,
        sourcePatches: false,
        sourceReplacement: false,
      },
      2,
    ) + "\n",
  );
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({
    options: {
      root: { type: "string", default: "." },
      output: { type: "string" },
      version: { type: "string" },
      "source-sha": { type: "string" },
    },
  });
  requireThat(
    values.output && values.version && values["source-sha"],
    "--output, --version and --source-sha required",
  );
  runPublic(
    physicalPath(values.root!),
    physicalPath(values.output),
    values.version,
    values["source-sha"],
  );
}
