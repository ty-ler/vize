/** Whole frozen source/archive fixtures shared by the checked-provider laws. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";
import { readToml, REGISTRY, RUNTIME_VERSION } from "./checked-corsa-contract.ts";
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
export function write(directory: string, relative: string, body: string | Uint8Array) {
  const target = path.join(directory, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, body);
}
// Whole deterministic USTAR archives, including malformed paths/types, with real
// header checksums. No tar subprocess or Cargo package command is used by tests.
export function tarArchive(target: string, members: [string, Buffer, string?, number?][]) {
  const chunks: Buffer[] = [];
  for (const [name, body, type = "0", mode = 0o644] of members) {
    const header = Buffer.alloc(512),
      put = (offset: number, size: number, value: string) =>
        header.write(value, offset, size, "utf8");
    put(0, 100, name);
    put(100, 8, mode.toString(8).padStart(7, "0") + "\0");
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

// Whole native1.99.1 packets: run39121980514/job117659457103/artifact12134408612.
// Only EXPECTED provider/consumer paths and workspace version are instantiated;
// actual output is never normalized. All primary8..39 and contextual spans stay exact.
const DEFAULT_REFUSAL = {
  error: {
    reason: "compiler-message",
    package_id:
      "path+file:///home/runner/_work/_temp/checked-corsa-package-consumer/default-feature-negative#checked-corsa-consumer-default-feature-negative@0.0.0",
    manifest_path:
      "/home/runner/_work/_temp/checked-corsa-package-consumer/default-feature-negative/Cargo.toml",
    target: {
      kind: ["lib"],
      crate_types: ["lib"],
      name: "checked_corsa_consumer_default_feature_negative",
      src_path:
        "/home/runner/_work/_temp/checked-corsa-package-consumer/default-feature-negative/src/lib.rs",
      edition: "2024",
      doc: true,
      doctest: true,
      test: true,
    },
    message: {
      rendered:
        'error[E0432]: unresolved import `corsa::orchestrator::RaftConfig`\n  --> src/lib.rs:1:9\n   |\n 1 | pub use corsa::orchestrator::RaftConfig;\n   |         ^^^^^^^^^^^^^^^^^^^^^----------\n   |                              |\n   |                              no `RaftConfig` in `orchestrator`\n   |\nnote: found an item that was configured out\n  --> /home/runner/_work/_temp/checked-corsa-package-consumer/archive-directory-source/vize_corsa-0.467.0/src/lib.rs:78:81\n   |\n75 |     #[cfg(feature = "experimental-distributed")]\n   |           ------------------------------------ the item is gated behind the `experimental-distributed` feature\n...\n78 |         InProcessTransport, PersistedLogEntry, RaftCluster, RaftClusterBuilder, RaftConfig,\n   |                                                                                 ^^^^^^^^^^\n\n',
      $message_type: "diagnostic",
      children: [
        {
          children: [],
          code: null,
          level: "note",
          message: "found an item that was configured out",
          rendered: null,
          spans: [
            {
              byte_end: 2302,
              byte_start: 2266,
              column_end: 47,
              column_start: 11,
              expansion: null,
              file_name:
                "/home/runner/_work/_temp/checked-corsa-package-consumer/archive-directory-source/vize_corsa-0.467.0/src/lib.rs",
              is_primary: false,
              label: "the item is gated behind the `experimental-distributed` feature",
              line_end: 75,
              line_start: 75,
              suggested_replacement: null,
              suggestion_applicability: null,
              text: [
                {
                  highlight_end: 47,
                  highlight_start: 11,
                  text: '    #[cfg(feature = "experimental-distributed")]',
                },
              ],
            },
            {
              byte_end: 2524,
              byte_start: 2514,
              column_end: 91,
              column_start: 81,
              expansion: null,
              file_name:
                "/home/runner/_work/_temp/checked-corsa-package-consumer/archive-directory-source/vize_corsa-0.467.0/src/lib.rs",
              is_primary: true,
              label: null,
              line_end: 78,
              line_start: 78,
              suggested_replacement: null,
              suggestion_applicability: null,
              text: [
                {
                  highlight_end: 91,
                  highlight_start: 81,
                  text: "        InProcessTransport, PersistedLogEntry, RaftCluster, RaftClusterBuilder, RaftConfig,",
                },
              ],
            },
          ],
        },
      ],
      level: "error",
      message: "unresolved import `corsa::orchestrator::RaftConfig`",
      spans: [
        {
          byte_end: 39,
          byte_start: 29,
          column_end: 40,
          column_start: 30,
          expansion: null,
          file_name: "src/lib.rs",
          is_primary: false,
          label: "no `RaftConfig` in `orchestrator`",
          line_end: 1,
          line_start: 1,
          suggested_replacement: null,
          suggestion_applicability: null,
          text: [
            {
              highlight_end: 40,
              highlight_start: 30,
              text: "pub use corsa::orchestrator::RaftConfig;",
            },
          ],
        },
        {
          byte_end: 39,
          byte_start: 8,
          column_end: 40,
          column_start: 9,
          expansion: null,
          file_name: "src/lib.rs",
          is_primary: true,
          label: null,
          line_end: 1,
          line_start: 1,
          suggested_replacement: null,
          suggestion_applicability: null,
          text: [
            {
              highlight_end: 40,
              highlight_start: 9,
              text: "pub use corsa::orchestrator::RaftConfig;",
            },
          ],
        },
      ],
      code: {
        code: "E0432",
        explanation:
          "An import was unresolved.\n\nErroneous code example:\n\n```compile_fail,E0432\nuse something::Foo; // error: unresolved import `something::Foo`.\n```\n\nIn Rust 2015, paths in `use` statements are relative to the crate root. To\nimport items relative to the current and parent modules, use the `self::` and\n`super::` prefixes, respectively.\n\nIn Rust 2018 or later, paths in `use` statements are relative to the current\nmodule unless they begin with the name of a crate or a literal `crate::`, in\nwhich case they start from the crate root. As in Rust 2015 code, the `self::`\nand `super::` prefixes refer to the current and parent modules respectively.\n\nAlso verify that you didn't misspell the import name and that the import exists\nin the module from where you tried to import it. Example:\n\n```\nuse self::something::Foo; // Ok.\n\nmod something {\n    pub struct Foo;\n}\n# fn main() {}\n```\n\nIf you tried to use a module from an external crate and are using Rust 2015,\nyou may have missed the `extern crate` declaration (which is usually placed in\nthe crate root):\n\n```edition2015\nextern crate core; // Required to use the `core` crate in Rust 2015.\n\nuse core::any;\n# fn main() {}\n```\n\nSince Rust 2018 the `extern crate` declaration is not required and\nyou can instead just `use` it:\n\n```edition2018\nuse core::any; // No extern crate required in Rust 2018.\n# fn main() {}\n```\n",
      },
    },
  },
  note: {
    reason: "compiler-message",
    package_id:
      "path+file:///home/runner/_work/_temp/checked-corsa-package-consumer/default-feature-negative#checked-corsa-consumer-default-feature-negative@0.0.0",
    manifest_path:
      "/home/runner/_work/_temp/checked-corsa-package-consumer/default-feature-negative/Cargo.toml",
    target: {
      kind: ["lib"],
      crate_types: ["lib"],
      name: "checked_corsa_consumer_default_feature_negative",
      src_path:
        "/home/runner/_work/_temp/checked-corsa-package-consumer/default-feature-negative/src/lib.rs",
      edition: "2024",
      doc: true,
      doctest: true,
      test: true,
    },
    message: {
      rendered: "For more information about this error, try `rustc --explain E0432`.\n",
      $message_type: "diagnostic",
      children: [],
      level: "failure-note",
      message: "For more information about this error, try `rustc --explain E0432`.",
      spans: [],
      code: null,
    },
  },
};
export function defaultRefusalPackets(directory: string, version: string) {
  const { error, note } = clone(DEFAULT_REFUSAL);
  for (const row of [error, note]) {
    row.package_id = `path+${pathToFileURL(directory).href}#checked-corsa-consumer-default-feature-negative@0.0.0`;
    row.manifest_path = path.join(directory, "Cargo.toml");
    row.target.src_path = path.join(directory, "src/lib.rs");
  }
  const archive = path.join(
    path.dirname(directory),
    "archive-directory-source",
    `vize_corsa-${version}`,
    "src/lib.rs",
  );
  error.message.rendered = error.message.rendered.replaceAll(
    "/home/runner/_work/_temp/checked-corsa-package-consumer/archive-directory-source/vize_corsa-0.467.0/src/lib.rs",
    archive,
  );
  for (const child of error.message.children)
    for (const span of child.spans) span.file_name = archive;
  return [error, note, { reason: "build-finished", success: false }] satisfies [
    typeof error,
    typeof note,
    { reason: string; success: boolean },
  ];
}

/** Current source-lock runtime authority, not an invented synthetic checksum. */
export function runtimeLockFixture() {
  const matches = readToml(path.join(root, "Cargo.lock")).package.filter(
    (row: { name: string }) => row.name === "corsa_runtime",
  );
  if (
    matches.length !== 1 ||
    matches[0].version !== RUNTIME_VERSION ||
    matches[0].source !== REGISTRY
  )
    throw Error("current runtime lock fixture identity differs");
  return { package: [clone(matches[0])] };
}
export function runtimeLockText() {
  return (
    "[[package]]\n" +
    Object.entries(runtimeLockFixture().package[0])
      .filter(([key]) => ["name", "version", "source", "checksum"].includes(key))
      .map(([key, value]) => `${key} = ${JSON.stringify(value)}\n`)
      .join("")
  );
}

/** Complete counterfactual packets; original minimal-only fixture remains a refusal. */
export function defaultRefusalCounterexamples(directory: string, version: string) {
  const packets = defaultRefusalPackets(directory, version);
  return [
    (rows: typeof packets) => {
      rows[0].message.spans[1].byte_start = 9;
    },
    (rows: typeof packets) => {
      rows[0].message.spans[1].text[0].text = "pub use foreign::RaftConfig;";
    },
    (rows: typeof packets) => {
      rows[0].message.children[0].spans[0].label = "wrong feature";
    },
    (rows: typeof packets) => {
      rows[0].message.rendered += "foreign output";
    },
    (rows: typeof packets) => {
      rows[0].target.src_path = "/foreign/src/lib.rs";
    },
    (rows: typeof packets) => {
      rows.pop();
    },
    (rows: typeof packets) => {
      rows.push(clone(rows[0]));
    },
  ].map((mutate) => {
    const changed = clone(packets);
    mutate(changed);
    return changed;
  });
}
