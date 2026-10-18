/** Whole frozen source/archive fixtures shared by the checked-provider laws. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
export const root = fileURLToPath(new URL("../../../../", import.meta.url));
export const VERSION = "0.999.0",
  SHA = "b".repeat(40),
  clone = <T>(value: T): T => structuredClone(value);
export function temporary(t: any) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "checked-corsa-ts-"));
  t.after(() => {
    const capture = process.env.VIZE_CHECKED_CORSA_TEST_CAPTURE_DIR;
    if (capture)
      fs.cpSync(directory, path.join(capture, path.basename(directory)), {
        recursive: true,
        errorOnExist: true,
        force: false,
      });
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return directory;
}
export function write(directory: string, relative: string, body: string | Buffer) {
  const target = path.join(directory, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, body);
}
// Whole deterministic USTAR archives, including malformed paths/types, with real
// header checksums. No tar subprocess or Cargo package command is used by tests.
export function tarArchive(target: string, members: [string, Buffer, string?][]) {
  const chunks: Buffer[] = [];
  for (const [name, body, type = "0"] of members) {
    const header = Buffer.alloc(512),
      put = (offset: number, size: number, value: string) =>
        header.write(value, offset, size, "utf8");
    put(0, 100, name);
    put(100, 8, "0000644\0");
    put(108, 8, "0000000\0");
    put(116, 8, "0000000\0");
    put(124, 12, body.length.toString(8).padStart(11, "0") + "\0");
    put(136, 12, "00000000000\0");
    header.fill(32, 148, 156);
    put(156, 1, type);
    put(257, 6, "ustar\0");
    put(263, 2, "00");
    const checksum = header.reduce((sum, byte) => sum + byte, 0);
    put(148, 8, checksum.toString(8).padStart(6, "0") + "\0 ");
    chunks.push(header, body, Buffer.alloc((512 - (body.length % 512)) % 512));
  }
  chunks.push(Buffer.alloc(1024));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, gzipSync(Buffer.concat(chunks)));
}
/** Independent frozen command contract from the original Python harness. */
export function frozenPackageCommands(source: string, output: string) {
  const aliases = [
    "corsa_core",
    "corsa_jsonrpc",
    "corsa_client",
    "corsa_lsp",
    "corsa_orchestrator",
    "corsa",
  ];
  const profile = [
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
  const calls: { label: string; args: string[]; cwd: string }[] = [];
  const command = (label: string, args: string[], cwd = source) => calls.push({ label, args, cwd });
  const metadata = (label: string, directory: string, features: string[] = []) =>
    command(
      label,
      ["cargo", "metadata", "--offline", "--format-version", "1", ...features],
      directory,
    );
  const clean = (label: string, directory: string, name: string) =>
    command(
      `${label}-clean-root`,
      ["cargo", "clean", "--locked", "--offline", "--package", name, ...profile],
      directory,
    );
  const build = (
    label: string,
    mode: string,
    directory: string,
    name: string,
    features: string[] = [],
  ) => {
    clean(`${label}-${mode}`, directory, name);
    command(
      `${label}-${mode}-build`,
      [
        "cargo",
        "build",
        "--locked",
        "--offline",
        "--lib",
        "--message-format=json",
        ...profile,
        ...features,
      ],
      directory,
    );
  };
  const modes: [string, string[]][] = [
    ["default", []],
    ["distributed", ["--features", "distributed"]],
  ];
  const builds = (label: string, directory: string, name: string) => {
    for (const [mode, features] of modes) {
      build(label, mode, directory, name, features);
      command(
        `${label}-${mode}-test`,
        ["cargo", "test", "--locked", "--offline", "--lib", ...profile, ...features],
        directory,
      );
    }
  };
  command("source-head", ["git", "rev-parse", "HEAD"]);
  command("source-status", ["git", "status", "--porcelain", "--untracked-files=no"]);
  command("cargo-version", ["cargo", "-Vv"]);
  command("rustc-version", ["rustc", "-Vv"]);
  const consumer = path.join(output, "path-consumer");
  for (const [mode, features] of modes) metadata(`path-${mode}-metadata`, consumer, features);
  builds("path", consumer, "checked-corsa-consumer-path-consumer");
  command(
    "vendor-registry-dependencies",
    [
      "cargo",
      "vendor",
      "--locked",
      "--offline",
      "--versioned-dirs",
      path.join(output, "archive-directory-source"),
    ],
    consumer,
  );
  command("generate-cargo-archives", [
    "cargo",
    "package",
    "--locked",
    "--offline",
    "--no-verify",
    "--exclude-lockfile",
    "--target-dir",
    path.join(output, "package-target"),
    ...aliases.flatMap((alias) => ["-p", `vize_${alias}`]),
  ]);
  const archive = path.join(output, "archive-consumer"),
    negative = path.join(output, "default-feature-negative");
  for (const [mode, features] of modes) metadata(`archive-${mode}-metadata`, archive, features);
  builds("archive", archive, "checked-corsa-consumer-archive-consumer");
  metadata("negative-default-metadata", negative);
  clean("negative-default", negative, "checked-corsa-consumer-default-feature-negative");
  command(
    "default-experimental-import-refused",
    ["cargo", "build", "--locked", "--offline", "--lib", "--message-format=json", ...profile],
    negative,
  );
  const canon = path.join(output, "canon-default-native");
  metadata("canon-default-native-metadata", canon);
  build("canon-source", "default-native", canon, "source-feature-consumer-canon-default-native");
  for (const mode of ["default", "minimal", "glyph", "maestro", "all"]) {
    const directory = path.join(output, `cli-${mode}`);
    metadata(`cli-${mode}-metadata`, directory);
    build("cli-source", mode, directory, `source-feature-consumer-cli-${mode}`);
  }
  command("cli-minimal-story-collection-test", [
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
    "commands::musea::migrate::tests::story_collection_is_available_without_formatter_features",
    "--",
    "--exact",
    "--nocapture",
  ]);
  command("final-source-status", ["git", "status", "--porcelain", "--untracked-files=no"]);
  command("final-source-head", ["git", "rev-parse", "HEAD"]);
  return calls;
}
