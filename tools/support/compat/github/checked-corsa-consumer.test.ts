/** Offline refusal laws. No Cargo or native child process is launched. */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { gzipSync } from "node:zlib";
import {
  parseJson,
  stringifyJson,
  jsonDuration,
  jsonLines,
  OWNED,
  REGISTRY,
  RUNTIME_VERSION,
  GENERATED,
  archiveMembers,
  isolatedManifest,
  toml,
  verifyConsumerBuild,
  verifyGraph,
  verifyPackagedSource,
  verifyNormalizedManifest,
  verifyRegistryLock,
  type Bodies,
  type Metadata,
  type Providers,
} from "./checked-corsa-contract.ts";
import {
  Acceptance,
  verifyDefaultRefusal,
  type Executor,
} from "./checked-corsa-package-consumer.ts";
import {
  VERSION,
  SHA,
  clone,
  temporary,
  write,
  tarArchive,
  defaultRefusalPackets,
  defaultRefusalCounterexamples,
  runtimeLockFixture,
  runtimeLockText,
} from "./checked-corsa-test-fixtures.ts";
function graph() {
  const providers: Providers = Object.fromEntries(
    [...OWNED].map((name) => [name, [`/consumer/${name}/Cargo.toml`, null]]),
  );
  const metadata: Metadata = {
    packages: [...OWNED].sort().map((name) => ({
      id: name,
      name,
      version: VERSION,
      source: null,
      manifest_path: providers[name][0],
    })),
    resolve: { nodes: [...OWNED].sort().map((id) => ({ id, features: [] })) },
  };
  metadata.packages.push({
    id: "runtime",
    name: "corsa_runtime",
    version: RUNTIME_VERSION,
    source: REGISTRY,
  });
  return { providers, metadata };
}
await test("archive regular members, GNU and PAX names preserve complete bytes", (t) => {
  const directory = temporary(t),
    archive = path.join(directory, "fixture.crate"),
    body = Buffer.from("body\0\xff", "latin1");
  tarArchive(archive, [["crate-1/src/lib.rs", body]]);
  assert.deepEqual({ ...archiveMembers(archive, "crate-1") }, { "src/lib.rs": body });
  const long = `crate-1/${"a".repeat(120)}`;
  tarArchive(archive, [
    ["././@LongLink", Buffer.from(long + "\0"), "L"],
    ["placeholder", body],
  ]);
  assert.deepEqual({ ...archiveMembers(archive, "crate-1") }, { [long.slice(8)]: body });
  const record = `path=${long}\n`;
  let length = Buffer.byteLength(record) + 2;
  while (String(length).length + 1 + Buffer.byteLength(record) !== length)
    length = String(length).length + 1 + Buffer.byteLength(record);
  tarArchive(archive, [
    ["pax", Buffer.from(`${length} ${record}`), "x"],
    ["placeholder", body],
  ]);
  assert.deepEqual({ ...archiveMembers(archive, "crate-1") }, { [long.slice(8)]: body });
});
await test("archive traversal, links, aliases, duplicate and malformed TAR are refused", (t) => {
  const archive = path.join(temporary(t), "fixture.crate");
  const controls: [string, Buffer, string?][][] = [
    [["crate-1/../escape", Buffer.from("body")]],
    [["foreign/src/lib.rs", Buffer.from("body")]],
    [["crate-1/src/link", Buffer.alloc(0), "2"]],
    [["crate-1/src/link", Buffer.alloc(0), "1"]],
    [
      ["crate-1/src/lib.rs", Buffer.from("body")],
      ["crate-1/src/lib.rs", Buffer.from("body")],
    ],
    [["crate-1/src/./lib.rs", Buffer.from("body")]],
    [["crate-1/src//lib.rs", Buffer.from("body")]],
    [["crate-1/src\\escape", Buffer.from("body")]],
    [["././@LongLink", Buffer.from("crate-1/x\0"), "L"]],
    [["pax", Buffer.from("99 path=escape\n"), "x"]],
    [["crate-1", Buffer.alloc(0), "5"]],
  ];
  for (const members of controls) {
    tarArchive(archive, members);
    assert.throws(() => archiveMembers(archive, "crate-1"));
  }
  fs.writeFileSync(archive, gzipSync(Buffer.alloc(511)));
  assert.throws(() => archiveMembers(archive, "crate-1"));
});
await test("six-package graph and requested distributed activation", () => {
  const { metadata, providers } = graph();
  assert.equal(verifyGraph(metadata, VERSION, providers, false).length, 6);
  for (const node of metadata.resolve.nodes)
    if (["vize_corsa", "vize_corsa_orchestrator"].includes(node.id))
      node.features = ["experimental-distributed"];
  assert.equal(verifyGraph(metadata, VERSION, providers, true).length, 6);
  assert.throws(() => verifyGraph(metadata, VERSION, providers, false), /experimental feature/u);
});
await test("upstream, duplicate, wrong path/version and runtime provider spoof controls", () => {
  const { metadata, providers } = graph();
  const mutations = [
    (data: Metadata) => data.packages.push({ name: "corsa_core" }),
    (data: Metadata) => data.packages.push(clone(data.packages[0])),
    (data: Metadata) => (data.packages[0].manifest_path = "/unexpected/Cargo.toml"),
    (data: Metadata) => (data.packages[0].version = "0.998.0"),
    (data: Metadata) => (data.packages.at(-1).version = "1.14.0"),
    (data: Metadata) => (data.packages.at(-1).source = null),
    (data: Metadata) => data.packages.push(clone(data.packages.at(-1))),
  ];
  for (const mutate of mutations) {
    const changed = clone(metadata);
    mutate(changed);
    assert.throws(() => verifyGraph(changed, VERSION, providers, false));
  }
});
function sourceFixture(t: any) {
  const directory = temporary(t);
  const original: Bodies = Object.fromEntries(
    Object.entries({
      "Cargo.toml":
        '[package]\nname="package"\nexclude=["Cargo.toml.orig", ".cargo_vcs_info.json"]\n',
      "Cargo.toml.orig": "upstream manifest",
      ".cargo_vcs_info.json": "upstream receipt",
      "Cargo.lock": "source lock",
      LICENSE: "MIT license text\n",
      "README.md": "docs\n",
      "src/lib.rs": "pub fn api() {}\n",
      "tests/fixture.txt": "retained fixture\n",
    }).map(([name, value]) => [name, Buffer.from(value)]),
  );
  for (const [name, body] of Object.entries(original)) write(directory, name, body);
  const bodies: Bodies = {
    ...Object.fromEntries(Object.entries(original).filter(([name]) => !GENERATED.has(name))),
    "Cargo.toml": Buffer.from("normalized manifest"),
    "Cargo.toml.orig": original["Cargo.toml"],
    ".cargo_vcs_info.json": Buffer.from("current receipt"),
  };
  return { directory, bodies };
}
await test("complete packaged source permits only reserved regenerated members", (t) => {
  const { directory, bodies } = sourceFixture(t);
  assert.deepEqual(verifyPackagedSource(directory, bodies), [
    "LICENSE",
    "README.md",
    "src/lib.rs",
    "tests/fixture.txt",
  ]);
  for (const missing of ["src/lib.rs", "tests/fixture.txt", "README.md", "Cargo.toml.orig"]) {
    const changed = { ...bodies };
    delete changed[missing];
    assert.throws(() => verifyPackagedSource(directory, changed), /inventory differs/u);
  }
  assert.throws(
    () => verifyPackagedSource(directory, { ...bodies, "Cargo.lock": Buffer.from("unexpected") }),
    /inventory differs/u,
  );
  const missing = { ...bodies };
  delete missing.LICENSE;
  assert.throws(() => verifyPackagedSource(directory, missing), /preserve LICENSE/u);
  assert.throws(
    () => verifyPackagedSource(directory, { ...bodies, LICENSE: Buffer.from("different") }),
    /LICENSE bytes changed/u,
  );
  write(directory, "Cargo.toml", '[package]\nexclude=["src/lib.rs"]\n');
  assert.throws(() => verifyPackagedSource(directory, bodies), /reserved Cargo/u);
});
function consumerFixture(t: any) {
  const directory = temporary(t),
    manifest = '[package]\nname = "checked-corsa-consumer"\nversion = "0.0.0"\n[workspace]\n';
  write(directory, "Cargo.toml", isolatedManifest(manifest, "archive-consumer"));
  const artifact = {
    reason: "compiler-artifact",
    manifest_path: path.join(directory, "Cargo.toml"),
    package_id: "generated-root",
    fresh: false,
    features: [],
    filenames: ["consumer.rlib"],
    target: {
      kind: ["lib"],
      name: "checked_corsa_consumer_archive_consumer",
      src_path: path.join(directory, "src/lib.rs"),
    },
  };
  return { directory, manifest, artifact };
}
await test("consumer identity and fresh exact-root compilation cannot be shared", (t) => {
  const { directory, manifest, artifact } = consumerFixture(t);
  assert.equal(
    new Set(
      ["path-consumer", "archive-consumer", "default-feature-negative"].map(
        (name) => toml(isolatedManifest(manifest, name)).package.name,
      ),
    ).size,
    3,
  );
  assert.equal(verifyConsumerBuild(JSON.stringify(artifact), directory).fresh, false);
  const numericPacket = JSON.stringify(artifact).replace(
    '"kind":',
    '"inode":9007199254740993,"mtime_ns":18446744073709551615,"kind":',
  );
  const numericArtifact = verifyConsumerBuild(numericPacket, directory);
  assert.equal(numericArtifact.target.inode, 9007199254740993n);
  assert.equal(numericArtifact.target.mtime_ns, 18446744073709551615n);
  assert.match(
    stringifyJson(numericArtifact),
    /"inode": 9007199254740993, "mtime_ns": 18446744073709551615/u,
  );
  for (const fields of [
    { fresh: true },
    { target: { ...artifact.target, src_path: "/sibling/src/lib.rs" } },
    { manifest_path: "/sibling/Cargo.toml" },
    { target: { ...artifact.target, name: "sibling" } },
  ])
    assert.throws(() => verifyConsumerBuild(JSON.stringify({ ...artifact, ...fields }), directory));
  assert.throws(() =>
    verifyConsumerBuild(
      [artifact, artifact].map((row) => JSON.stringify(row)).join("\n"),
      directory,
    ),
  );
});
await test("each mode cleans only its own generated root then builds/tests", (t) => {
  const { directory, artifact } = consumerFixture(t),
    runner = Object.create(Acceptance.prototype) as Acceptance,
    commands: string[][] = [];
  runner.consumerBuilds = [];
  runner.command = (_label, args) => {
    commands.push(args);
    return args[1] === "build" ? JSON.stringify(artifact) : "";
  };
  runner.builds("archive", directory);
  assert.deepEqual(
    commands.map((args) => args[1]),
    ["clean", "build", "test", "clean", "build", "test"],
  );
  for (const args of [commands[0], commands[3]]) {
    assert.equal(args[args.indexOf("--package") + 1], "checked-corsa-consumer-archive-consumer");
    assert.ok(!args.includes("--workspace"));
  }
  assert.equal(runner.consumerBuilds.length, 2);
});
await test("whole command stdout/stderr, explicit expected exit and failed spawn/signal evidence", (t) => {
  const directory = temporary(t),
    stdout = Buffer.from([0, 97, 10, 98]),
    stderr = Buffer.from([98, 0, 254]);
  for (const [label, result, expected, accepted] of [
    ["success", { status: 0 }, 0, true],
    ["expected-refusal", { status: 101 }, 101, true],
    ["wrong-status", { status: 7 }, 0, false],
    ["signal", { status: null, signal: "SIGKILL" }, 0, false],
    ["timeout", { status: null, error: { message: "ETIMEDOUT" } }, 0, false],
    ["spawn-error", { status: null, error: { message: "ENOENT" } }, 0, false],
    ["signal-expected", { status: null, signal: "SIGTERM" }, -15, true],
    ["invalid-utf8", { status: 0 }, 0, false],
  ] as const) {
    const executor: Executor = (args, options) => {
      assert.deepEqual(args, ["frozen", "whole-argv"]);
      assert.equal(options.timeout, 1800000);
      fs.writeSync(
        options.stdout,
        label === "invalid-utf8" ? Buffer.from([0, 255, 10, 97]) : stdout,
      );
      fs.writeSync(options.stderr, stderr);
      return result;
    };
    const runner = new Acceptance(
      directory,
      path.join(directory, label),
      SHA,
      { CARGO_TARGET_DIR: "/shared/target" },
      executor,
    );
    if (accepted) runner.command(label, ["frozen", "whole-argv"], directory, expected);
    else assert.throws(() => runner.command(label, ["frozen", "whole-argv"], directory, expected));
    assert.deepEqual(
      fs.readFileSync(path.join(runner.output, `${label}.stdout`)),
      label === "invalid-utf8" ? Buffer.from([0, 255, 10, 97]) : stdout,
    );
    assert.deepEqual(fs.readFileSync(path.join(runner.output, `${label}.stderr`)), stderr);
    const receipt = JSON.parse(
      fs.readFileSync(path.join(runner.output, `${label}.command.json`), "utf8"),
    );
    assert.deepEqual(receipt.args, ["frozen", "whole-argv"]);
    assert.equal(
      receipt.exitCode,
      label === "signal" ? -9 : label === "signal-expected" ? -15 : result.status,
    );
    if ("signal" in result) assert.equal(receipt.signal, result.signal);
    if ("error" in result) assert.equal(receipt.error, result.error.message);
  }
});
await test("default refusal must be the one exact E0432 from the independent root", () => {
  const message = {
    reason: "compiler-message",
    message: {
      level: "error",
      code: { code: "E0432" },
      message: "unresolved corsa::orchestrator::RaftConfig",
      spans: [{ is_primary: true, file_name: "src/lib.rs" }],
    },
  };
  assert.throws(() => verifyDefaultRefusal(JSON.stringify(message), "/negative", VERSION));
  for (const change of [
    { ...message, message: { ...message.message, code: { code: "E0308" } } },
    {
      ...message,
      message: { ...message.message, spans: [{ is_primary: true, file_name: "/foreign/lib.rs" }] },
    },
    { ...message, message: { ...message.message, message: "unrelated" } },
  ])
    assert.throws(() => verifyDefaultRefusal(JSON.stringify(change), "/negative", VERSION));
  assert.throws(() => verifyDefaultRefusal("", "/negative", VERSION));
  const packets = defaultRefusalPackets("/negative", VERSION),
    encode = (rows: unknown[]) => rows.map((row) => JSON.stringify(row)).join("\n");
  verifyDefaultRefusal(encode(packets), "/negative", VERSION);
  for (const changed of defaultRefusalCounterexamples("/negative", VERSION))
    assert.throws(() => verifyDefaultRefusal(encode(changed), "/negative", VERSION));
});

await test("Python integer JSON stays exact and unsafe TOML integers fail closed", () => {
  const packet =
    '{"inode": 9007199254740993, "mtime_ns": 18446744073709551615, "negative": -9007199254740993, "bounded": 512}';
  const parsed = parseJson(packet);
  assert.equal(parsed.inode, 9007199254740993n);
  assert.equal(parsed.mtime_ns, 18446744073709551615n);
  assert.equal(stringifyJson(parsed), packet);
  for (const integer of ["9007199254740993", "9223372036854775807", "18446744073709551615"])
    assert.throws(
      () => toml(`[package.metadata]\nidentity = ${integer}\n`),
      /unsafe TOML integer refused/u,
    );
  assert.equal(
    stringifyJson(toml("[package.metadata]\nidentity = 9007199254740991\n")),
    '{"package": {"metadata": {"identity": 9007199254740991}}}',
  );
  assert.throws(() => parseJson('{"unsafe":1e400}'), /nonfinite/u);
});

await test("original Python ASCII pretty bytes and newline are retained", (t) => {
  const directory = temporary(t);
  const packet = parseJson('{"text":"é😀\\ud800\\udfff\\u007f\\u2028","inode":9007199254740993}');
  const expected =
    '{\n  "text": "\\u00e9\\ud83d\\ude00\\ud800\\udfff\\u007f\\u2028",\n  "inode": 9007199254740993\n}\n';
  const file = path.join(directory, "pretty.json");
  fs.writeFileSync(file, stringifyJson(packet, 2) + "\n");
  assert.deepEqual(fs.readFileSync(file), Buffer.from(expected));
  assert.equal(stringifyJson({ elapsedSeconds: jsonDuration(0) }), '{"elapsedSeconds": 0.0}');
  assert.equal(
    stringifyJson({ elapsedSeconds: jsonDuration(1), count: 1 }),
    '{"elapsedSeconds": 1.0, "count": 1}',
  );
  for (const separator of ["\u2028", "\u2029", "\u0085", "\v", "\f"])
    assert.throws(() => jsonLines(`{"value":"before${separator}after"}`));
});

await test("logical regular TAR members retain0644 after GNU/PAX processing", (t) => {
  const archive = path.join(temporary(t), "mode.crate");
  for (const mode of [0o755, 0o600, 0o4644]) {
    tarArchive(archive, [["crate-1/src/lib.rs", Buffer.from("whole"), "0", mode]]);
    assert.throws(() => archiveMembers(archive, "crate-1"), /mode/u);
  }
  tarArchive(archive, [
    ["long", Buffer.from("crate-1/src/lib.rs\0"), "L", 0o755],
    ["placeholder", Buffer.from("whole")],
  ]);
  assert.deepEqual(
    { ...archiveMembers(archive, "crate-1") },
    { "src/lib.rs": Buffer.from("whole") },
  );
});
await test("complete normalized manifests preserve every field beyond the finite Cargo inheritance", (t) => {
  const directory = temporary(t),
    file = path.join(directory, "vendor/corsa/Cargo.toml"),
    workspace = path.join(directory, "Cargo.toml");
  write(
    directory,
    "Cargo.toml",
    `[workspace]\nresolver="3"\n[workspace.package]\nversion="${VERSION}"\n[workspace.dependencies]\ncorsa_core={package="vize_corsa_core",version="=${VERSION}",path="vendor/corsa_core"}\ncorsa={package="vize_corsa",version="=${VERSION}",path="vendor/corsa"}\n`,
  );
  const source =
    '[package]\nname="vize_corsa"\nversion.workspace=true\nresolver="2"\nexclude=[".cargo_vcs_info.json","Cargo.toml.orig"]\nlicense="MIT"\n[lib]\nname="corsa"\n[dependencies]\ncorsa_core={workspace=true}\n[features]\ndefault=[]\n';
  write(directory, "vendor/corsa/Cargo.toml", source);
  const normalized = toml(
    `[package]\nname="vize_corsa"\nversion="${VERSION}"\nresolver="3"\nexclude=[".cargo_vcs_info.json","Cargo.toml.orig"]\nlicense="MIT"\n[lib]\nname="corsa"\n[dependencies]\ncorsa_core={package="vize_corsa_core",version="=${VERSION}"}\n[features]\ndefault=[]\n`,
  );
  verifyNormalizedManifest(file, workspace, "corsa", normalized);
  for (const mutate of [
    (value: typeof normalized) => {
      value.features.default = ["unexpected"];
    },
    (value: typeof normalized) => {
      value.package.publish = false;
    },
    (value: typeof normalized) => {
      value.dependencies.corsa_core.optional = true;
    },
    (value: typeof normalized) => {
      delete value.package.exclude;
    },
  ]) {
    const changed = clone(normalized);
    mutate(changed);
    assert.throws(() => verifyNormalizedManifest(file, workspace, "corsa", changed));
  }
  write(
    directory,
    "vendor/corsa/Cargo.toml",
    source.replace("version.workspace=true", `version="${VERSION}"`),
  );
  assert.throws(() => verifyNormalizedManifest(file, workspace, "corsa", normalized));
});
await test("metadata verifies the actual post-command consumer lock and retains it before refusal", (t) => {
  const directory = temporary(t),
    metadata = graph().metadata,
    lock = runtimeLockFixture();
  assert.equal(verifyRegistryLock(metadata, lock, lock), 1);
  for (const mutate of [
    (value: typeof lock) => {
      value.package[0].checksum = "a".repeat(64);
    },
    (value: typeof lock) => {
      value.package[0].version = "1.14.0";
    },
    (value: typeof lock) => {
      value.package.push(clone(value.package[0]));
    },
    (value: typeof lock) => {
      value.package = [];
    },
  ]) {
    const changed = clone(lock);
    mutate(changed);
    assert.throws(() => verifyRegistryLock(metadata, lock, changed));
  }
  assert.throws(() => verifyRegistryLock(metadata, toml("# frozen source lock\n"), lock));
  write(directory, "Cargo.lock", runtimeLockText());
  const consumer = path.join(directory, "consumer");
  write(directory, "consumer/Cargo.lock", runtimeLockText());
  const corrupted = runtimeLockText().replace(lock.package[0].checksum, "a".repeat(64));
  const runner = new Acceptance(
    directory,
    path.join(directory, "evidence"),
    SHA,
    { CARGO_TARGET_DIR: "/shared/target" },
    (_args, options) => {
      fs.writeSync(options.stdout, JSON.stringify(metadata));
      fs.writeSync(options.stderr, "whole metadata stderr\n");
      write(consumer, "Cargo.lock", corrupted);
      return { status: 0 };
    },
  );
  assert.throws(() => runner.metadata("post-metadata", consumer), /checksum/u);
  assert.deepEqual(
    fs.readFileSync(path.join(runner.output, "post-metadata.stdout")),
    Buffer.from(JSON.stringify(metadata)),
  );
  const captured = JSON.parse(
    fs.readFileSync(path.join(runner.output, "post-metadata.lock.json"), "utf8"),
  );
  assert.deepEqual(Buffer.from(captured.base64, "base64"), Buffer.from(corrupted));
});
