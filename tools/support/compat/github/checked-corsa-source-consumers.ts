/** Independent Canon defaults and five isolated CLI library feature roots. */
import fs from "node:fs";
import path from "node:path";
import {
  physicalPath,
  stringifyJson,
  readToml,
  requireThat,
  type Metadata,
  type Providers,
} from "./checked-corsa-contract.ts";
export const MINIMAL_STORY_TEST =
  "commands::musea::migrate::tests::story_collection_is_available_without_formatter_features";
export function verifyMinimalStoryTest(output: string) {
  requireThat(
    output.includes(`test ${MINIMAL_STORY_TEST} ... ok`) &&
      output.includes("test result: ok. 1 passed; 0 failed;"),
    "minimal CLI story collection must execute its one exact regression",
  );
}
export function sourceManifest(
  dependency: string,
  directory: string,
  defaults = true,
  features: string[] = [],
) {
  let manifest =
    '[package]\nname = "source-feature-consumer"\nversion = "0.0.0"\nedition = "2024"\n[workspace]\n';
  manifest += `[dependencies.${dependency}]\npath = ${stringifyJson(directory)}\n`;
  if (dependency === "vize")
    manifest += `default-features = ${defaults}\nfeatures = ${stringifyJson(features)}\n`;
  return manifest;
}
export function packageFeatures(metadata: Metadata, name: string, manifest: string): string[] {
  const pkg = metadata.packages.find((pkg) => pkg.name === name);
  requireThat(
    pkg && physicalPath(pkg.manifest_path) === physicalPath(manifest) && pkg.source === null,
    `source consumer resolved an unexpected ${name} provider`,
  );
  const node = metadata.resolve.nodes.find((node) => node.id === pkg.id);
  requireThat(node, `source consumer lost ${name} feature node`);
  return node.features;
}
export function cliSource(common: Buffer, features: Set<string>) {
  let source = common.toString("utf8");
  if (features.has("glyph"))
    source +=
      "\npub fn glyph_options_layout() -> usize { std::mem::size_of::<vize::glyph::FormatOptions>() }\n";
  if (features.has("maestro"))
    source +=
      "\npub fn maestro_entrypoint() -> fn() -> Result<(), Box<dyn std::error::Error + Send + Sync>> { vize::maestro::serve_blocking }\n";
  if (features.has("profiling"))
    source +=
      "\npub fn profiling_layout() -> usize { std::mem::size_of::<vize::DoctorTuiBenchmark<'static>>() }\n";
  return Buffer.from(source);
}
export type SourceRunner = {
  root: string;
  consumer(name: string, manifest: string, source: Buffer): string;
  metadata(label: string, directory: string): Metadata;
  buildOnce(label: string, mode: string, directory: string): void;
  command(label: string, args: string[]): string;
};
export function qualifySourceConsumers(
  runner: SourceRunner,
  version: string,
  providers: Providers,
  verifyGraph: (
    metadata: Metadata,
    version: string,
    providers: Providers,
    distributed: boolean,
  ) => unknown,
) {
  const canonManifest = path.join(runner.root, "crates/vize_canon/Cargo.toml"),
    fixture = path.join(runner.root, "tests/_fixtures/ci");
  let directory = runner.consumer(
    "canon-default-native",
    sourceManifest("vize_canon", path.dirname(canonManifest)),
    fs.readFileSync(path.join(fixture, "checked-canon-consumer/lib.rs")),
  );
  let metadata = runner.metadata("canon-default-native-metadata", directory);
  const canonFeatures = packageFeatures(metadata, "vize_canon", canonManifest);
  requireThat(
    ["default", "native"].every((feature) => canonFeatures.includes(feature)),
    "independent Canon consumer must activate native through defaults",
  );
  const canon = {
    features: canonFeatures,
    packages: verifyGraph(metadata, version, providers, false),
  };
  runner.buildOnce("canon-source", "default-native", directory);
  const cli = [],
    cliManifest = path.join(runner.root, "crates/vize/Cargo.toml");
  const common = fs.readFileSync(path.join(fixture, "checked-vize-consumer/lib.rs"));
  const modes: [string, boolean, string[]][] = [
    ["default", true, []],
    ["minimal", false, []],
    ["glyph", false, ["glyph"]],
    ["maestro", false, ["maestro"]],
    ["all", false, Object.keys(readToml(cliManifest).features).sort()],
  ];
  for (const [label, defaults, requested] of modes) {
    const activated = new Set([
      ...requested,
      ...(defaults || requested.includes("default") ? ["glyph", "maestro"] : []),
    ]);
    directory = runner.consumer(
      `cli-${label}`,
      sourceManifest("vize", path.dirname(cliManifest), defaults, requested),
      cliSource(common, activated),
    );
    metadata = runner.metadata(`cli-${label}-metadata`, directory);
    const features = packageFeatures(metadata, "vize", cliManifest);
    requireThat(
      requested.every((feature) => features.includes(feature)) &&
        ["glyph", "maestro"].every(
          (feature) => features.includes(feature) === activated.has(feature),
        ),
      "CLI optional feature parity changed",
    );
    const canonNative = packageFeatures(metadata, "vize_canon", canonManifest);
    requireThat(canonNative.includes("native"), "CLI consumer lost its native Canon provider");
    cli.push({
      mode: label,
      features,
      canonFeatures: canonNative,
      packages: verifyGraph(metadata, version, providers, false),
    });
    runner.buildOnce("cli-source", label, directory);
  }
  verifyMinimalStoryTest(
    runner.command("cli-minimal-story-collection-test", [
      "cargo",
      "test",
      "--locked",
      "--offline",
      "--profile",
      "ci",
      "-p",
      "vize",
      "--no-default-features",
      "--lib",
      MINIMAL_STORY_TEST,
      "--",
      "--exact",
      "--nocapture",
    ]),
  );
  return { canon, cli, minimalStoryCollectionTestPassed: true };
}
