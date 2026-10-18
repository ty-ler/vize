import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { parse } from "yaml";
import { readRepoFile, root } from "./support/github-workflows.ts";
import { RUST_TEST_COHORTS } from "../../tools/support/compat/github/rust-test-cohorts.ts";
import { verifyCohortFiles } from "../../tools/support/compat/github/rust-test-archive.ts";

type Step = { name?: string; run?: string; env?: Record<string, string> };
type Job = { steps?: Step[]; uses?: string };
type PhaseRecord = { phase: string; elapsed_seconds: number; exit_code: number };
const source = parse(readRepoFile(".github", "workflows", "pr-source-checks.yml")) as {
  jobs: Record<string, Job>;
};
const caller = source.jobs["pr-rust-products"];
// Follow both required callers into the producer and its parallel doctest job.
assert.equal(caller.uses, "./.github/workflows/pr-rust-products.yml");
const jobs = (parse(readRepoFile(caller.uses!)) as { jobs: Record<string, Job> }).jobs;
const sourceCaller = source.jobs["pr-rust-source"];
assert.equal(sourceCaller.uses, "./.github/workflows/pr-rust-checks.yml");
const sourceJobs = (parse(readRepoFile(sourceCaller.uses!)) as { jobs: Record<string, Job> }).jobs;
const measured = jobs["merge-rust-source"];
const phase = (job: Job, name: string) => {
  const step = job.steps?.find((candidate) => candidate.name === name);
  assert.ok(step?.run, `${name} must be an executable workflow step`);
  return step;
};
const build = phase(measured, "Build Rust workspace tests");
const run = phase(sourceJobs["pr-rust-build"], "Run affected Rust doctests");
const packageNames = ["vize_l1", "vize_canon", "vize_maestro", "vize_glyph", "vize"];
const packages = packageNames.flatMap((name) => ["--package", name]);
const listArgs = [
  "nextest",
  "list",
  ...packages,
  "--cargo-profile",
  "ci",
  "--timings",
  "--profile",
  "full",
  "--run-ignored",
  "all",
  "--message-format",
  "json",
];
const buildArgs = (cwd: string) => [
  ["nextest", "--version"],
  listArgs,
  ...RUST_TEST_COHORTS.map(({ id, filter }) => [
    "nextest",
    "archive",
    ...packages,
    "--cargo-profile",
    "ci",
    "--timings",
    "-E",
    filter,
    "--archive-file",
    join(cwd, "target/rust-test-archive", id, "tests.tar.zst"),
  ]),
];
const runArgs = ["test", ...packages, "--profile", "ci", "--doc"];

function fixture() {
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), "vize-rust-phases-")));
  const bin = join(cwd, "bin");
  const temporary = join(cwd, "runner-temp");
  mkdirSync(bin);
  mkdirSync(temporary);
  const git = (...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
  git("init", "-q");
  git("config", "user.name", "CI Test");
  git("config", "user.email", "ci@example.invalid");
  const helper = "tools/support/compat/github/rust-test-archive.ts";
  mkdirSync(join(cwd, "tools/support/compat/github"), { recursive: true });
  copyFileSync(join(root, helper), join(cwd, helper));
  for (const dependency of ["rust-test-cohorts.ts", "rust-workspace-inventory.ts"])
    symlinkSync(
      join(root, "tools/support/compat/github", dependency),
      join(cwd, "tools/support/compat/github", dependency),
    );
  symlinkSync(join(root, "node_modules"), join(cwd, "node_modules"), "dir");
  copyFileSync(
    join(root, "tools/support/compat/github/run-affected-rust.ts"),
    join(cwd, "tools/support/compat/github/run-affected-rust.ts"),
  );
  writeFileSync(
    join(temporary, "rust-plan.json"),
    JSON.stringify({
      schemaVersion: 1,
      scope: "affected",
      packages: packageNames,
      cargoArgs: packages,
    }),
  );
  writeFileSync(join(cwd, "source"), "fixture\n");
  writeFileSync(join(cwd, "rust-toolchain.toml"), '[toolchain]\nchannel = "1.99.1"\n');
  git("add", "source", "rust-toolchain.toml");
  git("commit", "-qm", "fixture");
  const sha = git("rev-parse", "HEAD");
  const argv = join(cwd, "cargo-argv");
  const environments = join(cwd, "cargo-env");
  const html = join(cwd, "target/cargo-timings/cargo-timing.html");
  const generatedHtml = "<html><title>fake Cargo timing observation</title></html>\n";
  const dataFile = (relative: string, contents = `inert resource: ${relative}`) => {
    mkdirSync(dirname(join(cwd, relative)), { recursive: true });
    writeFileSync(join(cwd, relative), contents);
    return join(cwd, relative);
  };
  const suites = Object.fromEntries(
    packageNames.map((pkg) => [
      pkg,
      {
        "binary-id": pkg,
        "package-id": pkg,
        "package-name": pkg,
        "binary-name": pkg,
        "binary-path": dataFile(`target/ci/deps/${pkg}`),
        status: "listed",
        testcases: {
          "module::case": { ignored: false, "filter-match": { status: "matches" } },
          "module::ignored": { ignored: true, "filter-match": { status: "matches" } },
        },
      },
    ]),
  );
  for (const pkg of packageNames) {
    dataFile(`target/ci/helper-${pkg}`);
    dataFile(`target/ci/build/${pkg}/out/generated`);
  }
  dataFile("target/ci/deps/shared/library.so");
  symlinkSync("library.so", join(cwd, "target/ci/deps/shared/library-link.so"));
  dataFile("rustlib/libstd-fixture.so");
  dataFile("target/fixture/resource.bin");
  dataFile("target/fixture/deep/a/b/resource.bin");
  dataFile(
    ".config/nextest.toml",
    '[profile.default.archive]\ninclude = [{ path = "fixture/resource.bin", relative-to = "target", depth = 1, on-missing = "error" }, { path = "fixture/deep", relative-to = "target", depth = "infinite", on-missing = "error" }]\n',
  );
  const rawInventory = dataFile(
    "fixture-inventory.json",
    JSON.stringify({
      "rust-suites": suites,
      "rust-build-meta": {
        "target-directory": join(cwd, "target"),
        "build-directory": join(cwd, "target"),
        "non-test-binaries": Object.fromEntries(
          packageNames.map((pkg) => [pkg, [{ kind: "bin-exe", path: `ci/helper-${pkg}` }]]),
        ),
        "build-script-out-dirs": Object.fromEntries(
          packageNames.map((pkg) => [pkg, `ci/build/${pkg}/out`]),
        ),
        "linked-paths": ["ci/deps/shared"],
        platforms: {
          host: { libdir: { status: "available", path: join(cwd, "rustlib") } },
          targets: [],
        },
      },
    }),
  );
  writeFileSync(
    join(bin, "cargo"),
    `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
const env = process.env;
fs.appendFileSync(env.FAKE_CARGO_ARGV, JSON.stringify(args) + '\\n');
if (JSON.stringify(args) === JSON.stringify(['-V'])) { console.log('cargo 1.99.1 (phase-test fixture)'); process.exit(0); }
if (JSON.stringify(args) === JSON.stringify(['nextest', '--version'])) { console.log('cargo-nextest 0.9.146'); process.exit(0); }
const build = ${JSON.stringify(buildArgs(cwd).slice(1))};
const doctest = ${JSON.stringify(runArgs)};
if (![...build, doctest].some(expected => JSON.stringify(expected) === JSON.stringify(args))) {
  console.error('unexpected fake Cargo command: ' + JSON.stringify(args));
  process.exit(91);
}
fs.appendFileSync(env.FAKE_CARGO_ENV, env.VIZE_TEST_REQUIRE_TSGO + '\\n');
if (env.VIZE_TEST_REQUIRE_TSGO !== '1') process.exit(92);
const operation = args[0] === 'test' ? 'doctest' : args[1] === 'list' ? 'list' : path.basename(path.dirname(args.at(-1)));
if (operation === 'list' && fs.existsSync('target/cargo-timings/cargo-timing.html')) process.exit(90);
if (Number(env.FAKE_CARGO_EXIT) && (!env.FAKE_CARGO_FAIL_AT || operation === env.FAKE_CARGO_FAIL_AT)) process.exit(Number(env.FAKE_CARGO_EXIT));
if (operation === 'list') {
  if (env.FAKE_CARGO_HTML === 'present') {
    fs.mkdirSync('target/cargo-timings', { recursive: true });
    fs.writeFileSync('target/cargo-timings/cargo-timing.html', env.FAKE_CARGO_HTML_BYTES);
  }
  process.stdout.write(fs.readFileSync(env.FAKE_CARGO_INVENTORY));
} else if (operation !== 'doctest') fs.writeFileSync(args.at(-1), 'inert archive: ' + operation);
`,
    { mode: 0o755 },
  );
  writeFileSync(join(bin, "rustc"), "#!/bin/sh\nprintf 'rustc 1.99.1 (phase-test fixture)\\n'\n", {
    mode: 0o755,
  });
  const env: Record<string, string | undefined> = {
    ...process.env,
    PATH: `${bin}:${dirname(process.execPath)}:${process.env.PATH ?? ""}`,
    RUNNER_TEMP: temporary,
    FAKE_CARGO_ARGV: argv,
    FAKE_CARGO_ENV: environments,
    FAKE_CARGO_INVENTORY: rawInventory,
    FAKE_CARGO_HTML_BYTES: generatedHtml,
    GITHUB_STEP_SUMMARY: join(cwd, "summary.md"),
    GITHUB_ENV: join(cwd, "github-env"),
    GITHUB_EVENT_NAME: "merge_group",
    GITHUB_RUN_ID: "987654",
    GITHUB_RUN_ATTEMPT: "2",
    SOURCE_SHA: sha,
    CACHE_NAMESPACE: "phase-test-cache",
    VIZE_NUXT_CONFIG_ITERATIONS: "100",
  };
  delete env.VIZE_TEST_DISABLE_TSGO;
  delete env.VIZE_TEST_REQUIRE_TSGO;
  const execute = (step: Step, exit = 0, timingHtml = "present", failAt = "") =>
    spawnSync("/bin/bash", ["--noprofile", "--norc", "-eo", "pipefail", "-c", step.run!], {
      cwd,
      encoding: "utf8",
      env: {
        ...env,
        ...step.env,
        FAKE_CARGO_EXIT: String(exit),
        FAKE_CARGO_HTML: timingHtml,
        FAKE_CARGO_FAIL_AT: failAt,
      },
    });
  const receipt = (name: string): PhaseRecord =>
    JSON.parse(readFileSync(join(temporary, "rust-test-timings", `${name}.json`), "utf8"));
  const doctests = (exit = 0) => {
    const selected = execute(
      phase(sourceJobs["pr-rust-build"], "Select Clippy and doctest runtime envelope"),
    );
    assert.equal(selected.status, 0, selected.stderr);
    const runtime = Object.fromEntries(
      readFileSync(env.GITHUB_ENV!, "utf8")
        .trim()
        .split("\n")
        .map((line) => line.split("=")),
    );
    return execute({ ...run, env: runtime }, exit);
  };
  const calls = (): string[][] =>
    readFileSync(argv, "utf8")
      .trimEnd()
      .split("\n")
      .map((line) => JSON.parse(line));
  const summaryStep = measured.steps?.find(
    (step) => step.name === "Summarize Rust test timing evidence",
  );
  const summarize = (buildOutcome: string, runOutcome = "skipped") =>
    spawnSync(process.execPath, [join(root, "tools/support/compat/github/rust-test-timings.mjs")], {
      cwd,
      encoding: "utf8",
      env: {
        ...env,
        ...summaryStep?.env,
        BUILD_OUTCOME: buildOutcome,
        RUN_OUTCOME: runOutcome,
        SOURCE_SHA: sha,
        CACHE_NAMESPACE: "phase-test-cache",
      },
    });
  return {
    cwd,
    temporary,
    sha,
    html,
    generatedHtml,
    environments,
    execute,
    doctests,
    receipt,
    calls,
    summarize,
    cleanup: () => rmSync(cwd, { recursive: true, force: true }),
  };
}

function assertReceipt(record: PhaseRecord, expectedPhase: string, exitCode: number) {
  assert.deepEqual(Object.keys(record).sort(), ["elapsed_seconds", "exit_code", "phase"]);
  assert.equal(record.phase, expectedPhase);
  assert.equal(record.exit_code, exitCode);
  assert.ok(Number.isInteger(record.elapsed_seconds) && record.elapsed_seconds >= 0);
}

test("the actual affected archive records timing while doctests execute independently", () => {
  const f = fixture();
  try {
    mkdirSync(join(f.cwd, "target/cargo-timings"), { recursive: true });
    writeFileSync(f.html, "stale timing HTML\n");
    const compiled = f.execute(build);
    assert.equal(compiled.status, 0, compiled.stderr);
    const executed = f.doctests();
    assert.equal(executed.status, 0, executed.stderr);
    assert.deepEqual(f.calls(), [...buildArgs(f.cwd), runArgs]);
    assert.equal(readFileSync(f.environments, "utf8"), "1\n".repeat(7));
    const receiptBytes = readFileSync(join(f.cwd, "target/rust-test-archive/receipt.json"));
    const common = JSON.parse(receiptBytes.toString("utf8"));
    assert.equal(common.schemaVersion, 4);
    assert.equal(common.sha, f.sha);
    assert.equal(common.requireTsgo, "1");
    assert.equal(common.disableTsgo, null);
    assert.equal(common.nuxtIterations, "100");
    assert.deepEqual(
      common.inventory.map((binary: { id: string }) => binary.id).sort(),
      [...packageNames].sort(),
    );
    assert.deepEqual(
      common.payloads.map((payload: { cohort: string }) => payload.cohort),
      RUST_TEST_COHORTS.map(({ id }) => id),
    );
    // Fake archives do not extract; model only nextest's host-stdlib relocation.
    mkdirSync(join(f.cwd, "target/nextest/libdirs/host"), { recursive: true });
    copyFileSync(
      join(f.cwd, "rustlib/libstd-fixture.so"),
      join(f.cwd, "target/nextest/libdirs/host/libstd-fixture.so"),
    );
    const link = join(f.cwd, "target/ci/deps/shared/library-link.so");
    const referent = join(f.cwd, "target/ci/deps/shared/library.so");
    const referentHash = createHash("sha256").update(readFileSync(referent)).digest("hex");
    for (const payload of common.payloads) {
      assert.deepEqual(
        payload.files.find((file: { path: string }) => file.path.endsWith("/library-link.so")),
        { path: "target/ci/deps/shared/library-link.so", sha256: referentHash },
        "pinned tar follows file symlinks and must bind complete referent bytes",
      );
    }
    // Model the pinned tar writer's dereferenced regular-file extraction.
    rmSync(link);
    copyFileSync(referent, link);
    for (const [index, { id }] of RUST_TEST_COHORTS.entries()) {
      assert.deepEqual(
        readFileSync(join(f.cwd, "target/rust-test-archive", id, "receipt.json")),
        receiptBytes,
      );
      assert.equal(
        readFileSync(join(f.cwd, "target/rust-test-archive", id, "tests.tar.zst"), "utf8"),
        `inert archive: ${id}`,
      );
      const pkg = packageNames[index];
      assert.deepEqual(common.payloads[index].binaryIds, [pkg]);
      assert.deepEqual(
        common.payloads[index].files.map((file: { path: string }) => file.path).sort(),
        [
          `target/ci/deps/${pkg}`,
          `target/ci/helper-${pkg}`,
          `target/ci/build/${pkg}/out/generated`,
          "target/ci/deps/shared/library.so",
          "target/ci/deps/shared/library-link.so",
          "target/fixture/resource.bin",
          "target/fixture/deep/a/b/resource.bin",
          "target/nextest/libdirs/host/libstd-fixture.so",
        ].sort(),
      );
      verifyCohortFiles(common, id, f.cwd);
    }
    writeFileSync(link, "changed extracted referent bytes");
    assert.throws(() => verifyCohortFiles(common, "compiler", f.cwd));
    copyFileSync(referent, link);
    rmSync(link);
    symlinkSync("foreign.so", link);
    assert.throws(() => verifyCohortFiles(common, "compiler", f.cwd));
    rmSync(link);
    copyFileSync(referent, link);
    const buildRecord = f.receipt("build");
    assertReceipt(buildRecord, "build", 0);
    const summary = f.summarize("success");
    assert.equal(summary.status, 0, summary.stderr);
    assert.deepEqual(f.calls(), [...buildArgs(f.cwd), runArgs, ["-V"]]);
    const evidence = join(f.temporary, "rust-test-timings");
    assert.deepEqual(readFileSync(join(evidence, "archive-receipt.json")), receiptBytes);
    assert.deepEqual(
      readFileSync(join(evidence, "workspace-tests.json")),
      readFileSync(join(f.cwd, "fixture-inventory.json")),
    );
    assert.deepEqual(JSON.parse(readFileSync(join(evidence, "summary.json"), "utf8")), [
      { ...buildRecord, outcome: "success" },
      { phase: "run", outcome: "skipped", measurement: "missing" },
    ]);
    const identity = JSON.parse(readFileSync(join(evidence, "identity.json"), "utf8"));
    assert.equal(identity.event_head_sha, f.sha);
    assert.equal(identity.event, "merge_group");
    assert.equal(identity.run_id, "987654");
    assert.equal(identity.attempt, "2");
    assert.equal(identity.cache_namespace, "phase-test-cache");
    assert.equal(
      identity.build,
      measured.steps?.find((step) => step.name === "Summarize Rust test timing evidence")?.env
        ?.BUILD_COMMAND,
    );
    assert.equal(identity.run, "parallel Clippy and doctest job");
    assert.equal(readFileSync(join(evidence, "checked-out-sha.txt"), "utf8").trim(), f.sha);
    assert.equal(readFileSync(join(evidence, "cargo-timing.html"), "utf8"), f.generatedHtml);
  } finally {
    f.cleanup();
  }
});

test("a nonzero build records and propagates the actual Cargo failure status", () => {
  const f = fixture();
  try {
    const result = f.execute(build, 41);
    assert.equal(result.status, 41, result.stderr);
    assert.deepEqual(f.calls(), [["nextest", "--version"], listArgs]);
    assertReceipt(f.receipt("build"), "build", 41);
  } finally {
    f.cleanup();
  }
});

test("an archive failure preserves its status and prevents later payloads and common receipt", () => {
  const f = fixture();
  try {
    const result = f.execute(build, 42, "present", "language-server");
    assert.equal(result.status, 42, result.stderr);
    assert.deepEqual(f.calls(), buildArgs(f.cwd).slice(0, 5));
    assertReceipt(f.receipt("build"), "build", 42);
    assert.throws(
      () => readFileSync(join(f.cwd, "target/rust-test-archive/receipt.json")),
      /ENOENT/,
    );
    assert.throws(
      () => readFileSync(join(f.cwd, "target/rust-test-archive/lint-and-format/tests.tar.zst")),
      /ENOENT/,
    );
  } finally {
    f.cleanup();
  }
});

test("the parallel doctest step propagates its actual Cargo failure", () => {
  const f = fixture();
  try {
    assert.equal(f.execute(build).status, 0);
    const result = f.doctests(43);
    assert.equal(result.status, 43, result.stderr);
    assert.deepEqual(f.calls(), [...buildArgs(f.cwd), runArgs]);
    assertReceipt(f.receipt("build"), "build", 0);
  } finally {
    f.cleanup();
  }
});

test("the evidence collector rejects a successful build without fresh timing HTML", () => {
  const f = fixture();
  try {
    mkdirSync(join(f.cwd, "target/cargo-timings"), { recursive: true });
    writeFileSync(f.html, "stale timing HTML\n");
    assert.equal(f.execute(build, 0, "missing").status, 0);
    assertReceipt(f.receipt("build"), "build", 0);
    const result = f.summarize("success", "skipped");
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Missing fresh Cargo timing HTML/);
  } finally {
    f.cleanup();
  }
});

test("required aggregation includes the independently executed doctests", () => {
  const productReport = jobs["rust-product-report"] as Job & { needs: string[] };
  const sourceReport = sourceJobs["rust-source-report"] as Job & { needs: string[] };
  assert.ok(productReport.needs.includes("merge-rust-source"));
  assert.ok(productReport.needs.includes("pr-rust-shard"));
  assert.ok(sourceReport.needs.includes("pr-rust-build"));
  assert.ok(sourceReport.needs.includes("merge-rust-differential"));
  const outer = source.jobs["source-report"] as Job & { needs: string[] };
  for (const required of ["pr-rust-source", "pr-rust-products"])
    assert.ok(outer.needs.includes(required));
  for (const [report, mode] of [
    [sourceReport, "source"],
    [productReport, "products"],
  ] as const) {
    const aggregate = report.steps?.find((step) => step.name === "Require the complete Rust tier");
    assert.equal(aggregate?.env?.NEEDS_JSON, "${{ toJSON(needs) }}");
    assert.equal(aggregate?.run, `node tools/support/compat/github/require-rust-tier.ts --${mode}`);
  }
  const summary = measured.steps?.find(
    (step) => step.name === "Summarize Rust test timing evidence",
  );
  assert.equal(summary?.env?.RUN_OUTCOME, "skipped");
  assert.equal(summary?.env?.BUILD_OUTCOME, "${{ steps.rust-test-build.outcome }}");
});
