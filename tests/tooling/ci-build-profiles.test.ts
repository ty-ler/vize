import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";
import { parse } from "yaml";
import {
  pathWith,
  readRecordedCalls,
  runToolCommand,
  writeRecordingCommand,
} from "./_helpers/tool-commands.ts";
import { readRepoFile } from "./support/github-workflows.ts";
import { assertWarmSourceLocks } from "../performance/support/warm-type-backed-source.ts";

const builder = "tools/support/github/build-vitrine-wasm.ts";

test("release pairs ignore unused CI profiles but retain dependencies and selected build settings", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vize-paired-profiles-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const [before, after] = ["before", "after"].map((side) => path.join(root, side));
  const current = readRepoFile("Cargo.toml");
  const original = current
    .replace('opt-level = 0\nlto = "off"\n', "")
    .replace(/\[profile\.ci-wasm\][\s\S]*?(?=\[profile\.)/, "");
  assert.notEqual(original, current);
  for (const directory of [before, after]) {
    fs.mkdirSync(directory);
    for (const file of ["Cargo.lock", "package.json", "pnpm-lock.yaml", "rust-toolchain.toml"])
      fs.writeFileSync(path.join(directory, file), file);
  }
  fs.writeFileSync(path.join(before, "Cargo.toml"), original);
  const check = (body: string, profile: "ci" | "release" = "release") => {
    fs.writeFileSync(path.join(after, "Cargo.toml"), body);
    assertWarmSourceLocks(before, after, profile);
  };
  check(current);
  assert.throws(() => check(current, "ci"));
  for (const changed of [
    current.replace('lto = "fat"', 'lto = "off"'),
    current.replace("opt-level = 3", "opt-level = 2"),
    current.replace('version = "=1.14.0"', 'version = "=1.14.1"'),
  ]) {
    assert.notEqual(changed, current);
    assert.throws(() => check(changed));
  }
  for (const file of ["Cargo.lock", "package.json", "pnpm-lock.yaml", "rust-toolchain.toml"]) {
    fs.writeFileSync(path.join(after, file), "changed");
    assert.throws(() => check(current));
    fs.writeFileSync(path.join(after, file), file);
  }
  const inherited = (body: string) =>
    body.replace("[profile.release]", '[profile.release]\ninherits = "bridge"') +
    '\n[profile.bridge]\ninherits = "ci"\n';
  fs.writeFileSync(path.join(before, "Cargo.toml"), inherited(original));
  assert.throws(
    () => check(inherited(current)),
    "indirect release inheritance keeps CI settings relevant",
  );
});

test("native CI installs the named repository toolchain without a second stable download", () => {
  const channel = /channel = "([^"]+)"/.exec(readRepoFile("rust-toolchain.toml"))?.[1];
  assert.ok(channel);
  const files = [
    ".github/workflows/check.yml",
    ".github/workflows/pr-js-checks.yml",
    ".github/workflows/pr-source-checks.yml",
    ".github/workflows/typechecker-native-phases.yml",
    ".github/workflows/native-smoke.yml",
    ".github/actions/setup-js-package-tests/action.yml",
    ".github/actions/setup-js-check-runtime/action.yml",
  ];
  let named = 0;
  for (const file of files) {
    const document = parse(readRepoFile(file));
    // The SemVer comparison intentionally pins both sides via RUSTUP_TOOLCHAIN.
    const jobs = document.jobs
      ? Object.entries(document.jobs)
          .filter(([name]) => name !== "semver-checks")
          .map(([, job]) => job)
      : [document.runs];
    for (const job of jobs as { steps?: { uses?: string; with?: { toolchain?: string } }[] }[]) {
      for (const step of job.steps ?? []) {
        if (!step.uses?.startsWith("dtolnay/rust-toolchain@")) continue;
        if (step.with?.toolchain === "nightly") continue;
        assert.equal(step.with?.toolchain, channel, file);
        named += 1;
      }
    }
  }
  assert.ok(named > 0);
});

function workspace(t: TestContext, cargoExit = 0, bindgenExit = 0) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vize-ci-profile-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const bin = path.join(root, "bin");
  const log = path.join(root, "calls.jsonl");
  writeRecordingCommand(bin, "cargo", log, { exitCodes: [cargoExit] });
  writeRecordingCommand(bin, "wasm-bindgen", log, { exitCodes: [bindgenExit] });
  return { root, log, env: { PATH: pathWith(bin) } };
}

test("browser checks select the cheap profile and bindgen consumes its artifact", (t) => {
  const { root, log, env } = workspace(t);
  const result = runToolCommand(builder, ["--profile", "ci-wasm", "first", "second"], {
    cwd: root,
    env,
  });
  assert.equal(result.status, 0, result.stderr);
  const calls = readRecordedCalls(log);
  assert.deepEqual(
    calls.map(({ name }) => name),
    ["cargo", "wasm-bindgen", "wasm-bindgen"],
  );
  assert.deepEqual(calls[0]!.argv, [
    "build",
    "--profile",
    "ci-wasm",
    "-p",
    "vize_vitrine",
    "--no-default-features",
    "--features",
    "wasm",
    "--target",
    "wasm32-unknown-unknown",
  ]);
  assert.deepEqual(
    calls.slice(1).map(({ argv }) => argv),
    ["first", "second"].map((out) => [
      "target/wasm32-unknown-unknown/ci-wasm/vize_vitrine.wasm",
      "--out-dir",
      out,
      "--target",
      "web",
    ]),
  );
});

test("documentation and explicit release builds keep the published profile", (t) => {
  for (const args of [["out"], ["--profile", "release", "out"]]) {
    const { root, log, env } = workspace(t);
    assert.equal(runToolCommand(builder, args, { cwd: root, env }).status, 0);
    const calls = readRecordedCalls(log);
    assert.deepEqual(calls[0]!.argv.slice(0, 2), ["build", "--release"]);
    assert.equal(calls[1]!.argv[0], "target/wasm32-unknown-unknown/release/vize_vitrine.wasm");
  }
});

test("invalid profiles fail before spawning a build and failures stop later outputs", (t) => {
  const invalid = workspace(t);
  for (const args of [
    [],
    ["--profile"],
    ["--profile", "dev", "out"],
    ["out", "--profile", "ci-wasm"],
  ]) {
    assert.equal(runToolCommand(builder, args, { cwd: invalid.root, env: invalid.env }).status, 1);
  }
  assert.deepEqual(readRecordedCalls(invalid.log), []);
  for (const [cargoExit, bindgenExit, count] of [
    [23, 0, 1],
    [0, 29, 2],
  ]) {
    const { root, log, env } = workspace(t, cargoExit, bindgenExit);
    const result = runToolCommand(builder, ["--profile", "ci-wasm", "first", "second"], {
      cwd: root,
      env,
    });
    assert.equal(result.status, cargoExit || bindgenExit);
    assert.equal(readRecordedCalls(log).length, count);
  }
});

test("browser CI selects ci-wasm while public docs and packages keep release builds", () => {
  for (const [file, job] of [
    ["check.yml", "playground-test"],
    ["pr-source-checks.yml", "pr-playground-test"],
  ]) {
    const workflow = parse(readRepoFile(".github", "workflows", file!));
    const step = workflow.jobs[job!].steps.find((candidate: { run?: string }) =>
      candidate.run?.includes(builder),
    );
    assert.equal(step.run, `node ${builder} --profile ci-wasm playground/src/wasm`);
  }
  const docs = parse(readRepoFile(".github", "workflows", "build-docs.yml"));
  const build = docs.jobs["build-playground"].steps.find((candidate: { run?: string }) =>
    candidate.run?.includes(builder),
  );
  assert.equal(build.run, `node ${builder} npm/wasm playground/src/wasm`);
  assert.match(
    readRepoFile("tools", "support", "tasks", "build-vize-wasm-package.ts"),
    /"--release"/,
  );
});
