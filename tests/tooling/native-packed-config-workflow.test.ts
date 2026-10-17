import assert from "node:assert/strict";
import { spawnSync, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { parse } from "yaml";
import { withoutPackedConfigExtension } from "./support/native-packed-config-extension.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const source = fs.readFileSync(path.join(root, ".github/workflows/native-smoke.yml"), "utf8");
const workflow = parse(source);
const steps = workflow.jobs["packed-config-acceptance"].steps;

test("the bounded mode has one Linux Node24 job and reuses every fresh-install step", () => {
  assert.equal(steps, workflow.jobs["fresh-install-smoke"].steps);
  const job = workflow.jobs["packed-config-acceptance"];
  assert.equal(job["runs-on"], "ubuntu-22.04");
  assert.deepEqual(job.strategy.matrix, {
    "node-version": ["24"],
    platform: [{ runner: "ubuntu-22.04", target: "linux-x64-gnu", msvc_arch: "amd64" }],
  });
  for (const event of ["push", "schedule", "workflow_dispatch"])
    for (const target of [undefined, "all", "darwin-arm64", "packed-config"])
      for (const hostOnly of [false, true]) {
        const context = { github: { event_name: event }, inputs: { target, host_only: hostOnly } };
        const selected = Object.entries(workflow.jobs)
          .filter(([, entry]) => runInNewContext((entry as { if: string }).if, context))
          .map(([name]) => name);
        if (event === "workflow_dispatch" && target === "packed-config")
          assert.deepEqual(selected, ["packed-config-acceptance"]);
        else assert.ok(!selected.includes("packed-config-acceptance"));
      }
});

test("the complete old and new recipes reject unknown, missing, or altered commands", () => {
  withoutPackedConfigExtension(source);
  for (const command of [
    "cargo build --profile ci -p vize",
    "--runtime-checks --keep-temp",
    "['diff', '--exit-code', 'HEAD']",
    "node tools/support/compat/npm/smoke-release-config-evidence.ts collect",
  ]) {
    assert.ok(source.includes(command), command);
    assert.throws(() => withoutPackedConfigExtension(source.replace(command, "removed-command")));
  }
  assert.throws(() => withoutPackedConfigExtension(source + "\n# unreviewed extension\n"));
});

test("the actual source preflight refuses a wrong immutable SHA and retains its receipt", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "vize-config-source-"));
  try {
    const current = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: root,
      encoding: "utf8",
    }).trim();
    const script = steps.find(
      (step: { name?: string }) =>
        step.name === "Authenticate selected packed configuration source",
    ).run;
    const child = spawnSync("bash", ["-e", "-o", "pipefail", "-c", script], {
      cwd: root,
      encoding: "utf8",
      timeout: 10_000,
      env: {
        ...process.env,
        PACKED_CONFIG_OUTPUT: directory,
        PACKED_CONFIG_EXPECTED_SOURCE: "b".repeat(40),
        PACKED_CONFIG_HOST_ONLY: "false",
        PACKED_CONFIG_PRODUCER:
          workflow.jobs["packed-config-acceptance"].env.PACKED_CONFIG_PRODUCER,
        GITHUB_SHA: current,
        GITHUB_WORKFLOW_SHA: current,
      },
    });
    assert.equal(child.error, undefined);
    assert.equal(child.signal, null);
    assert.notEqual(child.status, 0);
    assert.match(child.stderr, /AssertionError/u);
    assert.match(child.stderr, /'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'/u);
    const receipt = JSON.parse(fs.readFileSync(path.join(directory, "source.json"), "utf8"));
    assert.equal(receipt.expected, "b".repeat(40));
    assert.equal(receipt.source, current);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("the actual packed runtime shell retains the full packet without hiding exit17", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "vize-config-shell-"));
  try {
    const binary = path.join(directory, "rust-script");
    fs.writeFileSync(
      binary,
      '#!/bin/sh\nprintf "required-whole-packet\\n"\nprintf "%s\\n" "$@" > "$PACKED_CONFIG_OUTPUT/argv.txt"\nexit 17\n',
      { mode: 0o755 },
    );
    const script = steps.find(
      (step: { name?: string }) =>
        step.name === "Fresh install and runtime smoke published tarballs",
    ).run;
    const child = spawnSync("bash", ["-e", "-o", "pipefail", "-c", script], {
      cwd: root,
      encoding: "utf8",
      timeout: 10_000,
      env: {
        ...process.env,
        PACKED_CONFIG_OUTPUT: directory,
        PATH: `${directory}${path.delimiter}${process.env.PATH}`,
      },
    });
    assert.equal(child.error, undefined);
    assert.equal(child.signal, null);
    assert.equal(child.status, 17);
    assert.equal(
      fs.readFileSync(path.join(directory, "runtime.log"), "utf8"),
      "required-whole-packet\n",
    );
    const argv = fs.readFileSync(path.join(directory, "argv.txt"), "utf8").trim().split("\n");
    for (const expected of [
      "--force",
      "--prepare-manifests",
      "--runtime-checks",
      "--keep-temp",
      "npm/native",
      "npm/cli",
      "npm/builder/vite",
    ])
      assert.ok(argv.includes(expected), expected);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

// Execute the real preflight in a tiny isolated repository, without builds or installs.
test("all sixteen reviewed producer files are bound, including a non-protocol source", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "vize-config-producer-"));
  try {
    const repository = path.join(directory, "repo");
    fs.mkdirSync(repository);
    const script = steps.find(
      (step: { name?: string }) =>
        step.name === "Authenticate selected packed configuration source",
    ).run as string;
    const array = (name: string): string[] => {
      const match = script.match(new RegExp(`const ${name} = (\\[[\\s\\S]*?\\]);`, "u"));
      assert.ok(match);
      return runInNewContext(match[1]) as string[];
    };
    const producerFiles = array("producerFiles");
    assert.equal(producerFiles.length, 16);
    const nonProtocol = "crates/vize_canon/src/batch/virtual_project/materialize.rs";
    assert.ok(producerFiles.includes(nonProtocol));
    for (const name of [...array("files"), ...producerFiles]) {
      const file = path.join(repository, name);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, "reviewed fixture bytes\n");
    }
    fs.writeFileSync(
      path.join(repository, "rust-toolchain.toml"),
      '[toolchain]\nchannel = "1.99.1"\n',
    );
    const git = (...args: string[]) =>
      execFileSync(
        "git",
        [
          "-c",
          "core.hooksPath=/dev/null",
          "-c",
          "commit.gpgsign=false",
          "-c",
          "user.name=Config fixture",
          "-c",
          "user.email=config-fixture@example.invalid",
          ...args,
        ],
        { cwd: repository, encoding: "utf8" },
      ).trim();
    git("init", "--quiet", "--initial-branch=main");
    git("add", ".");
    git("commit", "--quiet", "-m", "test: retain producer fixture");
    const producer = git("rev-parse", "HEAD");
    const execute = () => {
      const current = git("rev-parse", "HEAD");
      return spawnSync("bash", ["-e", "-o", "pipefail", "-c", script], {
        cwd: repository,
        encoding: "utf8",
        timeout: 10_000,
        env: {
          ...process.env,
          PACKED_CONFIG_OUTPUT: path.join(directory, "evidence"),
          PACKED_CONFIG_EXPECTED_SOURCE: current,
          PACKED_CONFIG_HOST_ONLY: "false",
          PACKED_CONFIG_PRODUCER: producer,
          GITHUB_SHA: current,
          GITHUB_WORKFLOW_SHA: current,
          GITHUB_OUTPUT: path.join(directory, "outputs"),
        },
      });
    };
    assert.equal(execute().status, 0, "unchanged complete producer passes source preflight");
    fs.writeFileSync(
      path.join(repository, nonProtocol),
      "changed outside the three protocol files\n",
    );
    git("add", nonProtocol);
    git("commit", "--quiet", "-m", "test: alter non-protocol producer source");
    const changed = execute();
    assert.equal(changed.error, undefined);
    assert.equal(changed.signal, null);
    assert.notEqual(changed.status, 0);
    const changedReceipt = JSON.parse(
      fs.readFileSync(path.join(directory, "evidence/source.json"), "utf8"),
    );
    assert.equal(typeof changedReceipt.files[nonProtocol], "string");
    git("rm", "--quiet", nonProtocol);
    git("commit", "--quiet", "-m", "test: remove non-protocol producer source");
    assert.notEqual(execute().status, 0);
    const missingReceipt = JSON.parse(
      fs.readFileSync(path.join(directory, "evidence/source.json"), "utf8"),
    );
    assert.equal(
      missingReceipt.files[nonProtocol],
      null,
      "a removed file still leaves the raw failure receipt",
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
