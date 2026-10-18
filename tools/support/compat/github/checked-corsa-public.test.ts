/** Offline refusal laws. No Cargo or native child process is launched. */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import {
  REGISTRY,
  RUNTIME_VERSION,
  digest,
  toml,
  type Bodies,
  type Metadata,
} from "./checked-corsa-contract.ts";
import {
  PUBLIC,
  PublicAcceptance,
  archiveEvidence,
  checkOutsideWorkspace,
  publicEnvironment,
  validateIdentity,
  verifyPublicGraph,
} from "./checked-corsa-public-consumer.ts";
import {
  root,
  VERSION,
  SHA,
  clone,
  temporary,
  write,
  tarArchive,
} from "./checked-corsa-test-fixtures.ts";
function publicGraph() {
  const home = "/fresh/cargo-home",
    directory = "/fresh/consumer";
  const metadata: Metadata = {
    packages: [...PUBLIC, "corsa_runtime"].sort().map((name) => {
      const version = name === "corsa_runtime" ? RUNTIME_VERSION : VERSION;
      return {
        id: name,
        name,
        version,
        source: REGISTRY,
        manifest_path: `${home}/registry/src/index.crates.io-fixture/${name}-${version}/Cargo.toml`,
      };
    }),
    resolve: {
      root: "consumer",
      nodes: [...PUBLIC, "corsa_runtime"]
        .sort()
        .map((id) => ({ id, features: id === "vize_canon" ? ["default", "native"] : [] })),
    },
  };
  metadata.packages.push({
    id: "consumer",
    name: "consumer",
    version: "0.0.0",
    source: null,
    manifest_path: `${directory}/Cargo.toml`,
  });
  return { metadata, home, directory };
}
test("public registry graph, exact Canon and requested distribution", () => {
  const { metadata, home, directory } = publicGraph();
  assert.equal(
    verifyPublicGraph(metadata, VERSION, home, directory, false, true).ownedPackages.length,
    6,
  );
  for (const node of metadata.resolve.nodes)
    if (["vize_corsa", "vize_corsa_orchestrator"].includes(node.id))
      node.features = ["experimental-distributed"];
  verifyPublicGraph(metadata, VERSION, home, directory, true, true);
  assert.throws(() => verifyPublicGraph(metadata, VERSION, home, directory, false, true));
});
test("public source, version, runtime, root and native-feature spoofs refused", () => {
  const { metadata, home, directory } = publicGraph();
  const mutations = [
    (data: Metadata) => (data.packages[0].source = null),
    (data: Metadata) => (data.packages[0].source = "registry+https://foreign.invalid/index"),
    (data: Metadata) => (data.packages[0].manifest_path = "/source/vendor/Cargo.toml"),
    (data: Metadata) => (data.packages[0].version = "1.14.0"),
    (data: Metadata) => (data.resolve.nodes.find((node) => node.id === "vize_canon").features = []),
    (data: Metadata) => (data.packages.at(-1).source = REGISTRY),
    (data: Metadata) =>
      (data.packages.find((pkg) => pkg.name === "vize_corsa").version = "0.998.0"),
  ];
  for (const mutate of mutations) {
    const changed = clone(metadata);
    mutate(changed);
    assert.throws(() => verifyPublicGraph(changed, VERSION, home, directory, false, true));
  }
});
test("public consumer strips source/compiler environment and refuses config/ranges", (t) => {
  const environment = publicEnvironment(
    {
      PATH: "/bin",
      CARGO_REGISTRIES_CRATES_IO_INDEX: "foreign",
      CARGO_SOURCE_CRATES_IO_REPLACE_WITH: "local",
      CARGO_HOME: "/existing",
      RUSTC_WRAPPER: "fake",
      RUSTFLAGS: "--cfg fake",
      CARGO_NET_OFFLINE: "true",
    },
    "/fresh/home",
    "/fresh/target",
  );
  assert.deepEqual(environment, {
    PATH: "/bin",
    CARGO_HOME: "/fresh/home",
    CARGO_TARGET_DIR: "/fresh/target",
    CARGO_TERM_COLOR: "never",
    CARGO_INCREMENTAL: "0",
  });
  const directory = temporary(t);
  checkOutsideWorkspace(path.join(directory, "outside"), path.join(directory, "source"));
  assert.throws(() =>
    checkOutsideWorkspace(path.join(directory, "source/output"), path.join(directory, "source")),
  );
  write(directory, ".cargo/config.toml", '[source.crates-io]\nreplace-with="local"\n');
  assert.throws(() =>
    checkOutsideWorkspace(path.join(directory, "outside"), path.join(directory, "source")),
  );
  for (const version of ["*", "^0.999", ">=0.999.0", "v0.999.0", "0.999.0\n"])
    assert.throws(() => validateIdentity(version, SHA));
  for (const sha of ["HEAD", "b".repeat(39), "g".repeat(40), SHA + "\n"])
    assert.throws(() => validateIdentity(VERSION, sha));
  const runner = Object.create(PublicAcceptance.prototype) as PublicAcceptance;
  runner.version = VERSION;
  for (const [dependency, suffix] of [
    [`version = "=${VERSION}", path = "/vendor"`, ""],
    [`version = "=${VERSION}"`, "\n[patch.crates-io]\n"],
    ['version = "*"', ""],
    [`version = "=${VERSION}"`, "\n[replace]\n"],
  ])
    assert.throws(() =>
      runner.consumer(
        "rejected",
        '[package]\nname = "consumer"\nversion = "0.0.0"\n[dependencies]\nvize_canon = { ' +
          dependency +
          " }\n" +
          suffix,
        Buffer.from("// never written"),
      ),
    );
});
function publicArchive(
  t: any,
  change: (bodies: Bodies) => void = () => {},
  name = "vize_corsa_core",
) {
  const directory = temporary(t),
    source = path.join(directory, "release-source"),
    home = path.join(directory, "cargo-home"),
    prefix = `${name}-${VERSION}`;
  const bodies: Bodies = {
    "Cargo.toml": Buffer.from(`[package]\nname="${name}"\nversion="${VERSION}"\nlicense="MIT"\n`),
    "Cargo.toml.orig": Buffer.from("[package]\nversion.workspace=true\n"),
    "src/lib.rs": Buffer.from("pub fn actual() {}\n"),
    LICENSE: fs.readFileSync(path.join(root, "LICENSE")),
    "tests/control.txt": Buffer.from("retained\n"),
    ".cargo_vcs_info.json": Buffer.from(
      JSON.stringify({
        git: { sha1: SHA, dirty: true },
        path_in_vcs: name === "vize_canon" ? "crates/vize_canon" : "vendor/corsa_core",
      }),
    ),
  };
  for (const [relative, body] of Object.entries(bodies)) write(source, relative, body);
  change(bodies);
  const archive = path.join(home, "registry/cache/index.crates.io-fixture", `${prefix}.crate`),
    extracted = path.join(home, "registry/src/index.crates.io-fixture", prefix);
  tarArchive(
    archive,
    Object.entries(bodies).map(([relative, body]) => [`${prefix}/${relative}`, body]),
  );
  for (const [relative, body] of Object.entries(bodies)) write(extracted, relative, body);
  const pkg = {
      name,
      version: VERSION,
      source: REGISTRY,
      manifest_path: path.join(extracted, "Cargo.toml"),
    },
    lock = {
      package: [
        { name, version: VERSION, source: REGISTRY, checksum: digest(fs.readFileSync(archive)) },
      ],
    };
  return { pkg, home, lock, source, archive };
}
test("complete public archive checksum/source and truthful dirty receipt", (t) => {
  const { pkg, home, lock, source } = publicArchive(t),
    evidence = archiveEvidence(pkg, home, lock, SHA, source);
  assert.equal(evidence.vcs.git.dirty, true);
  assert.ok(evidence.members["tests/control.txt"]);
  assert.equal(evidence.checksum, lock.package[0].checksum);
});
test("public license/source/VCS/checksum and compiled-input mutations refused", (t) => {
  for (const change of [
    (bodies: Bodies) => {
      delete bodies.LICENSE;
    },
    (bodies: Bodies) => {
      delete bodies["tests/control.txt"];
    },
    (bodies: Bodies) => {
      bodies[".cargo_vcs_info.json"] = Buffer.from(
        JSON.stringify({ git: { sha1: "c".repeat(40) }, path_in_vcs: "vendor/corsa_core" }),
      );
    },
  ]) {
    const { pkg, home, lock, source } = publicArchive(t, change);
    assert.throws(() => archiveEvidence(pkg, home, lock, SHA, source));
  }
  const canon = publicArchive(t, undefined, "vize_canon");
  archiveEvidence(canon.pkg, canon.home, canon.lock, SHA, canon.source);
  const badCanon = publicArchive(
    t,
    (bodies) => {
      bodies.LICENSE = Buffer.from("MIT");
    },
    "vize_canon",
  );
  assert.throws(
    () => archiveEvidence(badCanon.pkg, badCanon.home, badCanon.lock, SHA, badCanon.source),
    /complete expected MIT notice/u,
  );
  const { pkg, home, lock, source, archive } = publicArchive(t);
  lock.package[0].checksum = "0".repeat(64);
  assert.throws(() => archiveEvidence(pkg, home, lock, SHA, source));
  lock.package[0].checksum = digest(fs.readFileSync(archive));
  write(path.dirname(pkg.manifest_path), "src/lib.rs", "changed compiler input");
  assert.throws(() => archiveEvidence(pkg, home, lock, SHA, source));
});
