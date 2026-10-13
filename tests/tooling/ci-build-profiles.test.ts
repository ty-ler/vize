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

const builder = "tools/support/github/build-vitrine-wasm.ts";

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
