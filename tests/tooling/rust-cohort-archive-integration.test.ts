import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  buildCohortArchives,
  verifyCohortArchive,
  verifyCohortExecution,
  verifyCohortFiles,
} from "../../tools/support/compat/github/rust-test-archive.ts";
import { RUST_TEST_COHORTS } from "../../tools/support/compat/github/rust-test-cohorts.ts";
import {
  normalizeWorkspaceInventory,
  verifyInventoryJUnit,
} from "../../tools/support/compat/github/rust-workspace-inventory.ts";

// This probe requires a prepared Linux Actions runner. Ordinary tooling tests
// skip it; neither importing this file nor a skipped test invokes native tools.
const enabled = process.env.VIZE_TEST_REAL_COHORT_ARCHIVES === "1";
const root = fileURLToPath(new URL("../../", import.meta.url));
const packages = ["vize_l0", "vize_l1", "vize_canon", "vize_maestro", "vize_glyph", "vize"];
const cargoPackages = packages.flatMap((pkg) => ["--package", pkg]);
const metadataFiles = new Set([
  "target/nextest/binaries-metadata.json",
  "target/nextest/cargo-metadata.json",
]);
const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

function write(cwd: string, relative: string, contents: string) {
  const destination = path.join(cwd, relative);
  mkdirSync(path.dirname(destination), { recursive: true });
  writeFileSync(destination, contents);
}

function packageSources(cwd: string, pkg: string, index: number) {
  const directory = `crates/${pkg}`;
  const shared = pkg === "vize_l0";
  const dependency = shared
    ? ""
    : `\n[dependencies]\nvize_l0 = { path = "../vize_l0", features = ["${index % 2 ? "left" : "right"}"] }\n`;
  write(
    cwd,
    `${directory}/Cargo.toml`,
    `[package]
name = "${pkg}"
version = "0.0.0"
edition = "2024"
build = "build.rs"
${shared ? '[lib]\ncrate-type = ["rlib", "cdylib"]\n\n[features]\nleft = []\nright = []\n' : ""}${dependency}`,
  );
  write(
    cwd,
    `${directory}/src/lib.rs`,
    shared
      ? `pub fn unified() -> bool { cfg!(all(feature = "left", feature = "right")) }
#[test] fn unified_feature_graph() { assert!(unified()); }
#[test] #[ignore] fn inventoried_ignored_case() { panic!("ignored policy changed"); }
`
      : `#[test] fn unified_feature_graph() { assert!(vize_l0::unified()); }
#[test] #[ignore] fn inventoried_ignored_case() { panic!("ignored policy changed"); }
`,
  );
  write(cwd, `${directory}/src/bin/${pkg}_helper.rs`, `fn main() { println!("helper:${pkg}"); }\n`);
  write(
    cwd,
    `${directory}/build.rs`,
    `use std::{env, fs, path::PathBuf};
fn main() {
    let out = PathBuf::from(env::var_os("OUT_DIR").unwrap());
    fs::write(out.join("generated.txt"), b"generated:${pkg}").unwrap();
    let linked = out.join("linked");
    fs::create_dir_all(&linked).unwrap();
    fs::write(linked.join("linked-resource.bin"), b"linked:${pkg}").unwrap();
    let private = out.join("private");
    fs::create_dir_all(&private).unwrap();
    fs::write(private.join("data.bin"), b"referent:${pkg}").unwrap();
    for (name, target) in [(out.join("selected-link.bin"), "private/data.bin"), (linked.join("selected-link.bin"), "../private/data.bin")] {
        let _ = fs::remove_file(&name);
        std::os::unix::fs::symlink(target, name).unwrap();
    }
    println!("cargo:rustc-env=VIZE_PROBE_ENV=environment:${pkg}");
    println!("cargo:rustc-link-search=native={}", linked.display());
    println!("cargo:rerun-if-changed=build.rs");
}
`,
  );
  write(
    cwd,
    `${directory}/tests/resources.rs`,
    `use std::{env, fs, path::{Path, PathBuf}, process::Command};
#[test]
fn archive_preserves_actual_runtime_resources() {
    assert_eq!(env!("VIZE_PROBE_ENV"), "environment:${pkg}");
    let out = PathBuf::from(env!("OUT_DIR"));
    assert_eq!(fs::read(out.join("generated.txt")).unwrap(), b"generated:${pkg}");
    assert_eq!(fs::read(out.join("linked/linked-resource.bin")).unwrap(), b"linked:${pkg}");
    for source in [out.join("selected-link.bin"), out.join("linked/selected-link.bin")] {
        assert!(fs::symlink_metadata(&source).unwrap().is_file());
        assert_eq!(fs::read(source).unwrap(), b"referent:${pkg}");
    }
    let linked = out.join("linked");
    assert!(env::split_paths(&env::var_os("LD_LIBRARY_PATH").unwrap()).any(|item| item == linked));
    let output = Command::new(env!("CARGO_BIN_EXE_${pkg}_helper")).output().unwrap();
    assert!(output.status.success());
    assert_eq!(output.stdout, b"helper:${pkg}\\n");
    let workspace = Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap().parent().unwrap();
    assert_eq!(fs::read(workspace.join("target/fixture/required-resource.bin")).unwrap(), b"archive.include:required");
    let included = workspace.join("target/fixture/selected-link.bin");
    assert!(fs::symlink_metadata(&included).unwrap().is_file());
    assert_eq!(fs::read(included).unwrap(), b"archive.include:symlink-target");
    let dylib = ["target/ci/libvize_l0.so", "target/ci/deps/libvize_l0.so"].into_iter()
        .map(|item| workspace.join(item)).find(|item| item.is_file()).expect("shared dylib missing");
    assert!(fs::read(dylib).unwrap().starts_with(b"\\x7fELF"));
    let host = workspace.join("target/nextest/libdirs/host");
    assert!(fs::read_dir(host).unwrap().any(|entry| {
        let entry = entry.unwrap();
        entry.file_name().to_string_lossy().starts_with("libstd-") && entry.path().extension().is_some_and(|ext| ext == "so")
    }));
}
`,
  );
}

test(
  "pinned nextest cohort archives preserve the complete unified build and runtime resources",
  {
    skip: enabled ? false : "requires VIZE_TEST_REAL_COHORT_ARCHIVES=1 on prepared Linux Actions",
    timeout: 240_000,
  },
  async (t) => {
    assert.equal(process.platform, "linux", "the native archive contract is Linux-only");
    assert.match(process.env.GITHUB_RUN_ID ?? "", /^[1-9]\d*$/, "Actions run identity required");
    assert.match(process.env.GITHUB_RUN_ATTEMPT ?? "", /^[1-9]\d*$/, "Actions attempt required");
    assert(process.env.RUNNER_TEMP, "Actions runner evidence directory required");
    const cwd = realpathSync(mkdtempSync(path.join(tmpdir(), "vize-real-cohort-archive-")));
    const output = path.join(cwd, "artifacts/cohorts");
    const evidence = path.join(cwd, "evidence");
    mkdirSync(evidence);
    const save = (relative: string, value: unknown) =>
      write(evidence, relative, JSON.stringify(value, null, 2) + "\n");
    let complete = false;
    t.after(() => {
      let retained = false;
      // Copy only these bounded, known probe outputs. Never serialize the process
      // environment or arbitrary runner files, including when an assertion fails.
      try {
        for (const [source, destination] of [
          ["receipt.json", "receipts/common.json"],
          ["workspace-tests.json", "inventories/producer.raw.json"],
          ...RUST_TEST_COHORTS.map(({ id }) => [`${id}/receipt.json`, `receipts/${id}.json`]),
        ]) {
          const original = path.join(output, source);
          if (existsSync(original)) {
            mkdirSync(path.dirname(path.join(evidence, destination)), { recursive: true });
            copyFileSync(original, path.join(evidence, destination));
          }
        }
        save("outcome.json", { complete });
        const retainedDirectory = path.join(
          process.env.RUNNER_TEMP!,
          "rust-test-timings/cohort-probe",
          path.basename(cwd),
        );
        mkdirSync(retainedDirectory, { recursive: true });
        cpSync(evidence, retainedDirectory, { recursive: true });
        retained = true;
      } finally {
        // Preserve the sole original if copying evidence itself fails.
        if (retained) rmSync(cwd, { recursive: true, force: true });
      }
    });
    const env = {
      ...process.env,
      PATH: `${path.dirname(process.execPath)}:${process.env.PATH ?? ""}`,
      RUSTUP_TOOLCHAIN: "1.99.1",
      CARGO_NET_OFFLINE: "true",
      VIZE_TEST_REQUIRE_TSGO: "1",
      VIZE_NUXT_CONFIG_ITERATIONS: "100",
    };
    delete (env as NodeJS.ProcessEnv).VIZE_TEST_DISABLE_TSGO;
    // Prevent a runner's unrelated target override from hiding source resources.
    delete (env as NodeJS.ProcessEnv).CARGO_TARGET_DIR;
    delete (env as NodeJS.ProcessEnv).CARGO_BUILD_BUILD_DIR;
    let commandNumber = 0;
    const command = (executable: string, args: string[]) => {
      const result = spawnSync(executable, args, {
        cwd,
        env,
        encoding: "utf8",
        maxBuffer: 32 * 1024 * 1024,
        stdio: ["ignore", "pipe", "pipe"],
      });
      const prefix = `commands/${String(++commandNumber).padStart(3, "0")}-${executable}`;
      save(`${prefix}.json`, { executable, args, status: result.status, signal: result.signal });
      write(evidence, `${prefix}.stdout`, result.stdout ?? "");
      write(evidence, `${prefix}.stderr`, result.stderr ?? "");
      assert.ifError(result.error);
      assert.equal(result.signal, null, `${executable} terminated by signal`);
      assert.equal(result.status, 0, `${executable} failed: ${result.stderr}`);
      return result.stdout;
    };
    const cargo = (args: string[]) => command("cargo", args);
    const nextestVersion = cargo(["nextest", "--version"]).trim();
    const rustcVersion = command("rustc", ["-Vv"]).trim();
    assert.match(nextestVersion, /^cargo-nextest 0\.9\.146(?:\s|$)/);
    assert.match(rustcVersion, /^rustc 1\.99\.1 /);
    write(
      cwd,
      "Cargo.toml",
      `[workspace]\nresolver = "2"\nmembers = [${packages.map((pkg) => JSON.stringify(`crates/${pkg}`)).join(", ")}]\n\n[profile.ci]\ninherits = "dev"\n`,
    );
    write(cwd, "rust-toolchain.toml", '[toolchain]\nchannel = "1.99.1"\n');
    write(
      cwd,
      ".config/nextest.toml",
      `nextest-version = "0.9.146"
[profile.default.archive]
include = [{ path = "fixture/required-resource.bin", relative-to = "target", depth = 1, on-missing = "error" }, { path = "fixture/selected-link.bin", relative-to = "target", on-missing = "error" }]
[profile.full]
fail-fast = false
retries = 0
test-threads = 16
[profile.full.junit]
path = "junit.xml"
store-success-output = true
store-failure-output = true
`,
    );
    packages.forEach((pkg, index) => packageSources(cwd, pkg, index));
    write(cwd, "target/fixture/required-resource.bin", "archive.include:required");
    write(cwd, "target/probe-only/include-source.bin", "archive.include:symlink-target");
    symlinkSync(
      "../probe-only/include-source.bin",
      path.join(cwd, "target/fixture/selected-link.bin"),
    );
    write(cwd, ".gitignore", "/target/\n/artifacts/\n/evidence/\n");
    const runner = "tools/support/compat/github/run-affected-rust.ts";
    mkdirSync(path.dirname(path.join(cwd, runner)), { recursive: true });
    copyFileSync(path.join(root, runner), path.join(cwd, runner));
    command("git", ["init", "-q"]);
    command("git", ["config", "user.name", "Cohort Integration"]);
    command("git", ["config", "user.email", "cohort@example.invalid"]);
    command("git", ["add", "."]);
    command("git", ["commit", "-qm", "fixture"]);
    const plan = path.join(cwd, "artifacts/plan.json");
    write(
      cwd,
      "artifacts/plan.json",
      JSON.stringify({
        schemaVersion: 1,
        scope: "workspace",
        packages,
        cargoArgs: cargoPackages,
      }),
    );
    const context = { cwd, env, nextestVersion, rustcVersion };
    const common = await buildCohortArchives(plan, output, context);
    const commonBytes = readFileSync(path.join(output, "receipt.json"));
    const fullArchive = path.join(cwd, "artifacts/full.tar.zst");
    // The comparison archive is built from the identical complete Cargo package
    // arguments. It is a probe oracle, not an extra production artifact/build.
    cargo([
      "nextest",
      "archive",
      ...cargoPackages,
      "--cargo-profile",
      "ci",
      "--archive-file",
      fullArchive,
    ]);
    const entries = (archive: string, label: string) => {
      const files = command("tar", ["--zstd", "-tf", archive]).trim().split("\n");
      save(`files/${label}.entries.json`, files);
      assert.equal(new Set(files).size, files.length, "duplicate archive entry");
      for (const name of metadataFiles)
        assert(files.includes(name), `missing nextest metadata: ${name}`);
      assert(
        files.every(
          (file) => !file.endsWith("/private/data.bin") && !file.startsWith("target/probe-only/"),
        ),
        "selected links must not rely on a separately archived referent",
      );
      return files.filter((file) => !metadataFiles.has(file)).sort();
    };
    const extractAndList = (archive: string, label: string) => {
      rmSync(path.join(cwd, "target"), { recursive: true, force: true });
      assert.throws(() => statSync(path.join(cwd, "target")), /ENOENT/);
      const raw = cargo([
        "nextest",
        "list",
        "--archive-file",
        archive,
        "--extract-to",
        cwd,
        "--extract-overwrite",
        "--workspace-remap",
        cwd,
        "--profile",
        "full",
        "--run-ignored",
        "all",
        "--message-format",
        "json",
      ]);
      write(evidence, `inventories/${label}.raw.json`, raw);
      return JSON.parse(raw);
    };
    const fileManifest = (archive: string, label: string) => {
      const manifest = entries(archive, label).map((file) => {
        assert(file.startsWith("target/") && !file.split("/").includes(".."));
        assert(
          lstatSync(path.join(cwd, file)).isFile(),
          `archive member must materialize regular bytes: ${file}`,
        );
        const contents = readFileSync(path.join(cwd, file));
        return [file, sha256(contents)] as const;
      });
      save(`files/${label}.manifest.json`, manifest);
      return manifest;
    };
    const run = (archive: string, label: string, filter?: string) => {
      const junit = path.join(cwd, "target/nextest/full/junit.xml");
      try {
        cargo([
          "nextest",
          "run",
          "--archive-file",
          archive,
          "--extract-to",
          cwd,
          "--extract-overwrite",
          "--workspace-remap",
          cwd,
          "--profile",
          "full",
          ...(filter ? ["-E", filter] : []),
          "--no-tests=fail",
        ]);
      } finally {
        if (existsSync(junit)) write(evidence, `junit/${label}.xml`, readFileSync(junit, "utf8"));
      }
      return readFileSync(junit, "utf8");
    };
    const fullInventory = normalizeWorkspaceInventory(extractAndList(fullArchive, "full"));
    save("inventories/full.normalized.json", fullInventory);
    assert.deepEqual(fullInventory, common.inventory);
    assert.equal(
      fullInventory.filter((binary: { package: string }) => binary.package === "vize_l0").length >
        0,
      true,
    );
    assert.equal(
      fullInventory
        .flatMap((binary: { cases: { ignored: boolean }[] }) => binary.cases)
        .filter((entry: { ignored: boolean }) => entry.ignored).length,
      packages.length,
    );
    const fullFiles = new Map(fileManifest(fullArchive, "full"));
    verifyInventoryJUnit(fullInventory, run(fullArchive, "full"));
    const unionFiles = new Map<string, string>();
    const unionInventory = [];
    const workerJUnits: string[] = [];
    for (const { id, filter } of RUST_TEST_COHORTS) {
      const archive = path.join(output, id, "tests.tar.zst");
      assert.deepEqual(readFileSync(path.join(output, id, "receipt.json")), commonBytes);
      await verifyCohortArchive(common, archive, id, context);
      const inventory = normalizeWorkspaceInventory(extractAndList(archive, id));
      save(`inventories/${id}.normalized.json`, inventory);
      assert.deepEqual(
        inventory.map((binary: { id: string }) => binary.id),
        common.payloads.find((payload) => payload.cohort === id)!.binaryIds,
      );
      unionInventory.push(...inventory);
      verifyCohortFiles(common, id, cwd);
      const materializedLink = path.join(cwd, "target/fixture/selected-link.bin");
      const referentBytes = readFileSync(materializedLink);
      assert.equal(referentBytes.toString(), "archive.include:symlink-target");
      writeFileSync(materializedLink, "changed extracted referent");
      assert.throws(() => verifyCohortFiles(common, id, cwd), /extracted binary\/resource changed/);
      writeFileSync(materializedLink, referentBytes);
      verifyCohortFiles(common, id, cwd);
      for (const [file, digest] of fileManifest(archive, id)) {
        assert.equal(digest, fullFiles.get(file), `foreign or changed archive file: ${id}/${file}`);
        if (unionFiles.has(file)) assert.equal(unionFiles.get(file), digest);
        unionFiles.set(file, digest);
      }
      save(
        "files/union.manifest.json",
        [...unionFiles].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
      );
      save("files/union.entries.json", [...unionFiles.keys()].sort());
      save("inventories/union.normalized.json", unionInventory);
      const junit = run(archive, id, filter);
      verifyCohortExecution(common, id, junit);
      workerJUnits.push(junit);
    }
    unionInventory.sort((a, b) => a.id.localeCompare(b.id, "en"));
    assert.deepEqual(
      unionInventory,
      fullInventory,
      "five payload inventories must cover all original identities exactly once",
    );
    assert.deepEqual(
      [...unionFiles].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
      [...fullFiles].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
      "payload file union must match full archive except its two nextest metadata files",
    );
    verifyInventoryJUnit(fullInventory, workerJUnits.join("\n"));
    complete = true;
  },
);
