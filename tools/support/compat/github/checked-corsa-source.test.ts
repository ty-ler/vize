/** Offline refusal laws. No Cargo or native child process is launched. */
import assert from "node:assert/strict";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { test, type TestContext } from "node:test";
import {
  ALIASES,
  OWNED,
  REGISTRY,
  RUNTIME_VERSION,
  digest,
  toml,
} from "./checked-corsa-contract.ts";
import { Acceptance, type Executor } from "./checked-corsa-package-consumer.ts";
import {
  MINIMAL_STORY_TEST,
  packageFeatures,
  qualifySourceConsumers,
  sourceManifest,
  verifyMinimalStoryTest,
} from "./checked-corsa-source-consumers.ts";
import { verifySource, ownedCorsaReader } from "./checked-corsa-source.ts";
import {
  root,
  VERSION,
  SHA,
  temporary,
  write,
  tarArchive,
  frozenPackageCommands,
  defaultRefusalPackets,
  runtimeLockText,
} from "./checked-corsa-test-fixtures.ts";
await test("Canon actual defaults and six independent source roots reach library builds", () => {
  assert.deepEqual(toml(sourceManifest("vize_canon", "/source/canon")).dependencies, {
    vize_canon: { path: "/source/canon" },
  });
  const records = new Map<string, { manifest: any; source: Buffer }>(),
    builds: [string, string][] = [];
  let testCommand: string[] = [];
  const runner = {
    root,
    consumer(name: string, manifest: string, source: Buffer) {
      const directory = `/external/${name}`;
      records.set(directory, { manifest: toml(manifest), source });
      return directory;
    },
    metadata(_label: string, directory: string) {
      const requested = records.get(directory)!.manifest.dependencies.vize ?? {},
        features = new Set<string>(requested.features ?? []);
      if (requested["default-features"] !== false) features.add("default");
      if (features.has("default")) {
        features.add("glyph");
        features.add("maestro");
      }
      return {
        packages: ["vize", "vize_canon"].map((name) => ({
          id: name,
          name,
          source: null,
          manifest_path: path.join(root, "crates", name, "Cargo.toml"),
        })),
        resolve: {
          nodes: [
            { id: "vize", features: [...features].sort() },
            { id: "vize_canon", features: ["default", "native"] },
          ],
        },
      };
    },
    buildOnce(provider: string, mode: string) {
      builds.push([provider, mode]);
    },
    command(_label: string, args: string[]) {
      testCommand = args;
      return `test ${MINIMAL_STORY_TEST} ... ok\ntest result: ok. 1 passed; 0 failed; 0 ignored;\n`;
    },
  };
  const result = qualifySourceConsumers(runner, VERSION, {}, () => []);
  assert.deepEqual(builds, [
    ["canon-source", "default-native"],
    ...["default", "minimal", "glyph", "maestro", "all"].map((name) => ["cli-source", name]),
  ]);
  assert.ok(
    testCommand.includes("--no-default-features") && testCommand.includes(MINIMAL_STORY_TEST),
  );
  assert.equal(result.minimalStoryCollectionTestPassed, true);
  for (const [index, record] of [...records.values()].slice(1).entries()) {
    assert.deepEqual(Object.keys(record.manifest.dependencies), ["vize"]);
    assert.ok(!record.manifest.patch);
    assert.ok(record.source.includes("vize::cli::run_from_args"));
    assert.equal(
      record.source.includes("vize::glyph::FormatOptions"),
      result.cli[index].features.includes("glyph"),
    );
    assert.equal(
      record.source.includes("vize::maestro::serve_blocking"),
      result.cli[index].features.includes("maestro"),
    );
  }
});
await test("source provider and filtered/unrelated minimal test output are refused", () => {
  assert.throws(
    () =>
      packageFeatures(
        {
          packages: [
            {
              id: "canon",
              name: "vize_canon",
              source: REGISTRY,
              manifest_path: "/source/Cargo.toml",
            },
          ],
          resolve: { nodes: [] },
        },
        "vize_canon",
        "/source/Cargo.toml",
      ),
    /unexpected vize_canon/u,
  );
  for (const output of [
    "",
    "test result: ok. 0 passed; 0 failed;",
    "test unrelated ... ok\ntest result: ok. 1 passed; 0 failed;",
  ])
    assert.throws(() => verifyMinimalStoryTest(output), /one exact regression/u);
});
function sourceRepository(t: TestContext) {
  const directory = temporary(t);
  const git = (args: string[]) =>
    execFileSync("git", ["--no-replace-objects", ...args], {
      cwd: directory,
      stdio: ["ignore", "pipe", "pipe"],
    });
  git(["init", "--quiet"]);
  const commit = () => {
    git(["add", "."]);
    git([
      "-c",
      "user.name=Source Fixture",
      "-c",
      "user.email=source-fixture@example.invalid",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "--quiet",
      "-m",
      "fixture",
    ]);
    return git(["rev-parse", "HEAD"]).toString().trim();
  };
  return { directory, git, commit };
}
await test("real Git reader preserves raw bodies and refuses fresh physical, HEAD and replacement drift", (t) => {
  const { directory, git, commit } = sourceRepository(t);
  const relative = "nested/member.rs",
    file = path.join(directory, relative);
  const first = "pub const VALUE: u8 = 1;\n",
    second = "pub const VALUE: u8 = 2;\n";
  write(directory, relative, first);
  const before = commit();
  write(directory, relative, second);
  const head = commit(),
    reader = ownedCorsaReader(directory, before, head);
  const body = (side: string, name = relative) => {
    const value = reader(side, name);
    assert.ok(value);
    return value;
  };
  assert.equal(body("before").body.toString(), first);
  assert.equal(body("after").body.toString(), second);
  const changed = body("after");
  changed.body.fill(0);
  changed.mode = "100755";
  assert.equal(body("after").body.toString(), second);
  assert.equal(reader("before", "absent.rs"), null);
  for (const bad of ["../member.rs", "/member.rs", "a//b", "./member.rs", "nested\\member.rs"])
    assert.throws(() => reader("after", bad));
  assert.throws(() => reader("foreign", relative));
  write(directory, relative, "foreign bytes\n");
  assert.throws(() => body("after"));
  write(directory, relative, second);
  for (const mode of [0o755, 0o600, 0o4644]) {
    fs.chmodSync(file, mode);
    assert.throws(() => body("after"));
  }
  fs.chmodSync(file, 0o644);
  const foreign = path.join(directory, "foreign.rs");
  fs.writeFileSync(foreign, "foreign\n");
  fs.unlinkSync(file);
  fs.symlinkSync(foreign, file);
  assert.throws(() => body("after"));
  fs.unlinkSync(file);
  fs.mkdirSync(file);
  assert.throws(() => body("after"));
  fs.rmdirSync(file);
  assert.throws(() => body("after"));
  write(directory, relative, second);
  const ancestor = path.dirname(file),
    moved = path.join(directory, "moved");
  fs.renameSync(ancestor, moved);
  fs.symlinkSync(moved, ancestor, "dir");
  assert.throws(() => body("after"));
  fs.unlinkSync(ancestor);
  fs.renameSync(moved, ancestor);
  git(["replace", head, before]);
  assert.equal(git(["show", `${head}:${relative}`]).toString(), second);
  assert.equal(
    execFileSync("git", ["show", `${head}:${relative}`], { cwd: directory }).toString(),
    first,
  );
  assert.throws(() => body("after"), /replacement refs/u);
  assert.throws(() => ownedCorsaReader(directory, before, head), /replacement refs/u);
  git(["replace", "-d", head]);
  fs.chmodSync(file, 0o755);
  const executable = commit();
  assert.throws(() => body("after"), /HEAD changed/u);
  fs.chmodSync(file, 0o644);
  assert.throws(
    () => ownedCorsaReader(directory, before, executable)("after", relative),
    /regular raw/u,
  );
});
await test("complete six-package source census and licenses reject every substitution", (t) => {
  const { directory, commit } = sourceRepository(t);
  const rows = ["package\tpath\tbytes\tsha256"];
  for (const alias of ALIASES)
    for (const [relative, body] of [
      ["LICENSE", "MIT License\ncomplete upstream notice\n"],
      ["src/lib.rs", "pub fn original() {}\n"],
    ]) {
      write(directory, `vendor/${alias}/${relative}`, body);
      rows.push(`${alias}\t${relative}\t${Buffer.byteLength(body)}\t${digest(Buffer.from(body))}`);
    }
  const census = rows.join("\n") + "\n";
  write(directory, "vendor/corsa-source.tsv", census);
  commit();
  verifySource(directory);
  write(
    directory,
    "vendor/corsa-source.tsv",
    census.replace(
      `\t${Buffer.byteLength("MIT License\ncomplete upstream notice\n")}\t`,
      "\t9007199254740993\t",
    ),
  );
  commit();
  assert.throws(() => verifySource(directory));
  write(directory, "vendor/corsa-source.tsv", census);
  commit();
  write(directory, "vendor/corsa/src/lib.rs", "changed");
  assert.throws(() => verifySource(directory));
  write(directory, "vendor/corsa/src/lib.rs", "pub fn original() {}\n");
  write(directory, "vendor/corsa/extra", "extra");
  assert.throws(() => verifySource(directory));
  fs.unlinkSync(path.join(directory, "vendor/corsa/extra"));
  write(directory, "vendor/corsa-source.tsv", census + rows[1] + "\n");
  commit();
  assert.throws(() => verifySource(directory));
  write(
    directory,
    "vendor/corsa-source.tsv",
    census.replace("corsa_core\tLICENSE", "corsa_core\t../LICENSE"),
  );
  commit();
  assert.throws(() => verifySource(directory));
  write(directory, "vendor/corsa-source.tsv", census);
  commit();
  const target = path.join(directory, "vendor/corsa/src/lib.rs");
  fs.unlinkSync(target);
  fs.symlinkSync(path.join(directory, "vendor/corsa_core/src/lib.rs"), target);
  assert.throws(() => verifySource(directory));
  fs.unlinkSync(target);
  write(directory, "vendor/corsa/src/lib.rs", "pub fn original() {}\n");
  // Matching the census is insufficient if even one complete notice differs.
  write(directory, "vendor/corsa/LICENSE", "MIT License\nchanged notice\n");
  write(
    directory,
    "vendor/corsa-source.tsv",
    census.replace(
      `corsa\tLICENSE\t${Buffer.byteLength("MIT License\ncomplete upstream notice\n")}\t${digest(Buffer.from("MIT License\ncomplete upstream notice\n"))}`,
      `corsa\tLICENSE\t${Buffer.byteLength("MIT License\nchanged notice\n")}\t${digest(Buffer.from("MIT License\nchanged notice\n"))}`,
    ),
  );
  commit();
  assert.throws(() => verifySource(directory));
});

await test("whole package acceptance executes every frozen phase before earning its receipt", (t) => {
  const directory = temporary(t),
    release = path.join(directory, "source"),
    output = path.join(directory, "evidence");
  const workspace: string[] = [
    "[workspace]",
    'resolver = "3"',
    "[workspace.package]",
    `version = "${VERSION}"`,
    "[workspace.dependencies]",
  ];
  for (const alias of ALIASES) {
    const name = `vize_${alias}`;
    workspace.push(
      `${alias} = { package = "${name}", version = "=${VERSION}", path = "vendor/${alias}" }`,
    );
    write(
      release,
      `vendor/${alias}/Cargo.toml`,
      `[package]\nname = "${name}"\nversion.workspace = true\nresolver = "2"\nexclude = [".cargo_vcs_info.json", "Cargo.toml.orig"]\nlicense = "MIT"\n[lib]\nname = "${alias}"\n`,
    );
    write(release, `vendor/${alias}/LICENSE`, "MIT License\ncomplete notice\n");
    write(release, `vendor/${alias}/src/lib.rs`, "pub fn whole_source() {}\n");
  }
  write(release, "Cargo.toml", workspace.join("\n") + "\n");
  write(release, "Cargo.lock", runtimeLockText());
  for (const relative of [
    "checked-corsa-consumer/Cargo.toml",
    "checked-corsa-consumer/src/lib.rs",
    "checked-canon-consumer/lib.rs",
    "checked-vize-consumer/lib.rs",
  ])
    write(
      release,
      `tests/_fixtures/ci/${relative}`,
      fs.readFileSync(path.join(root, "tests/_fixtures/ci", relative)),
    );
  write(
    release,
    "crates/vize/Cargo.toml",
    '[features]\ndefault = ["glyph", "maestro"]\nglyph = []\nmaestro = []\nprofiling = []\n',
  );
  const calls: { label: string; args: string[]; cwd: string }[] = [];
  const packets: { stdout: Buffer; stderr: Buffer; status: number }[] = [];
  const executor: Executor = (args, options) => {
    let stdout = "",
      status = 0;
    // Command evidence label is derived only from the output FD's current
    // command ordering by the wrapper below; executors receive whole argv.
    if (args[0] === "git") stdout = args[1] === "rev-parse" ? SHA + "\n" : "";
    else if (args[1] === "-Vv") stdout = args[0] + " frozen version\n";
    else if (args[1] === "metadata") {
      const manifest = toml(fs.readFileSync(path.join(options.cwd, "Cargo.toml"), "utf8")),
        dependencies = manifest.dependencies;
      const sourceRoot = dependencies.vize || dependencies.vize_canon;
      const archived =
        options.cwd.endsWith("archive-consumer") ||
        options.cwd.endsWith("default-feature-negative");
      const packages = [...OWNED].map((name) => ({
        id: name,
        name,
        version: VERSION,
        source: archived ? REGISTRY : null,
        manifest_path: archived
          ? path.join(output, "archive-directory-source", `${name}-${VERSION}`, "Cargo.toml")
          : path.join(release, "vendor", name.slice(5), "Cargo.toml"),
      }));
      packages.push({
        id: "runtime",
        name: "corsa_runtime",
        version: RUNTIME_VERSION,
        source: REGISTRY,
        manifest_path: "/registry/runtime/Cargo.toml",
      });
      const nodes = packages.map((pkg) => ({
        id: pkg.id,
        features:
          args.includes("distributed") &&
          ["vize_corsa", "vize_corsa_orchestrator"].includes(pkg.name)
            ? ["experimental-distributed"]
            : [],
      }));
      if (sourceRoot) {
        const requested = dependencies.vize ?? {},
          activated = new Set<string>(requested.features ?? []);
        if (dependencies.vize && requested["default-features"] !== false) activated.add("default");
        if (activated.has("default")) {
          activated.add("glyph");
          activated.add("maestro");
        }
        for (const name of ["vize", "vize_canon"]) {
          packages.push({
            id: name,
            name,
            version: VERSION,
            source: null,
            manifest_path: path.join(release, "crates", name, "Cargo.toml"),
          });
          nodes.push({
            id: name,
            features: name === "vize_canon" ? ["default", "native"] : [...activated],
          });
        }
      }
      stdout = JSON.stringify({ packages, resolve: { nodes } }) + "\n";
    } else if (args[1] === "vendor") fs.mkdirSync(args.at(-1)!);
    else if (args[1] === "package") {
      for (const alias of ALIASES) {
        const source = path.join(release, "vendor", alias),
          prefix = `vize_${alias}-${VERSION}`,
          manifest = fs.readFileSync(path.join(source, "Cargo.toml"));
        tarArchive(path.join(output, "package-target/package", `${prefix}.crate`), [
          [
            `${prefix}/Cargo.toml`,
            Buffer.from(
              manifest
                .toString()
                .replace("version.workspace = true", `version = "${VERSION}"`)
                .replace('resolver = "2"', 'resolver = "3"'),
            ),
          ],
          [`${prefix}/Cargo.toml.orig`, manifest],
          [
            `${prefix}/.cargo_vcs_info.json`,
            Buffer.from(JSON.stringify({ git: { sha1: SHA }, path_in_vcs: `vendor/${alias}` })),
          ],
          [`${prefix}/LICENSE`, fs.readFileSync(path.join(source, "LICENSE"))],
          [`${prefix}/src/lib.rs`, fs.readFileSync(path.join(source, "src/lib.rs"))],
        ]);
      }
    } else if (args[1] === "build") {
      if (options.cwd.endsWith("default-feature-negative")) {
        status = 101;
        stdout =
          defaultRefusalPackets(options.cwd, VERSION)
            .map((row) => JSON.stringify(row))
            .join("\n") + "\n";
      } else
        stdout =
          JSON.stringify({
            reason: "compiler-artifact",
            package_id: "frozen-root",
            manifest_path: path.join(options.cwd, "Cargo.toml"),
            fresh: false,
            features: [],
            filenames: ["frozen.rlib"],
            target: {
              kind: ["lib"],
              name: toml(
                fs.readFileSync(path.join(options.cwd, "Cargo.toml"), "utf8"),
              ).package.name.replaceAll("-", "_"),
              src_path: path.join(options.cwd, "src/lib.rs"),
            },
          }) + "\n";
    } else if (args.includes(MINIMAL_STORY_TEST))
      stdout = `test ${MINIMAL_STORY_TEST} ... ok\ntest result: ok. 1 passed; 0 failed; 0 ignored;\n`;
    else requireThatFake(args[1] === "clean" || args[1] === "test");
    packets.push({
      stdout: Buffer.from(stdout),
      stderr: Buffer.from("frozen complete stderr\n"),
      status,
    });
    fs.writeSync(options.stdout, stdout);
    fs.writeSync(options.stderr, "frozen complete stderr\n");
    return { status };
  };
  const runner = new Acceptance(
    release,
    output,
    SHA,
    { CARGO_TARGET_DIR: "/shared/native-target" },
    executor,
  );
  const command = runner.command.bind(runner);
  runner.command = (label: string, args: string[], cwd?: string, status?: number) => {
    const directory = cwd ?? runner.root;
    calls.push({ label, args, cwd: directory });
    return command(label, args, directory, status);
  };
  runner.run();
  const expected = frozenPackageCommands(release, output);
  assert.deepEqual(calls, expected);
  const receipt = JSON.parse(fs.readFileSync(path.join(output, "receipt.json"), "utf8"));
  assert.equal(receipt.commands.length, expected.length);
  assert.equal(receipt.consumerBuilds.length, 10);
  assert.equal(receipt.archives.length, 6);
  assert.equal(receipt.graphs.length, 4);
  assert.equal(receipt.cliMetadata.length, 5);
  assert.equal(receipt.publicRegistryAcceptance, false);
  assert.equal(receipt.consumerPatches, false);
  assert.equal(receipt.minimalStoryCollectionTestPassed, true);
  for (const [index, record] of receipt.commands.entries()) {
    assert.deepEqual(
      fs.readFileSync(path.join(output, `${record.label}.stdout`)),
      packets[index].stdout,
    );
    assert.deepEqual(record.args, calls.find((call) => call.label === record.label)!.args);
    assert.deepEqual(
      fs.readFileSync(path.join(output, `${record.label}.stderr`)),
      Buffer.from("frozen complete stderr\n"),
    );
    assert.equal(record.exitCode, record.label === "default-experimental-import-refused" ? 101 : 0);
  }
  for (const archive of receipt.archives)
    assert.deepEqual(archive.sourceMembers, ["LICENSE", "src/lib.rs"]);
});
function requireThatFake(value: boolean) {
  assert.equal(value, true, "unexpected command in frozen acceptance transcript");
}
