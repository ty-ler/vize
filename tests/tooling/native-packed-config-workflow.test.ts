import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { parse } from "yaml";
import { withoutPackedConfigExtension } from "./support/native-packed-config-extension.ts";
import { writeFakeCommand } from "./support/fake-command.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const source = fs.readFileSync(path.join(root, ".github/workflows/native-smoke.yml"), "utf8");
const workflow = parse(source);
const steps = workflow.jobs["packed-config-acceptance"].steps;

void test("the actual manager version audit uses a manifest-free cwd and preserves failed probes", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "vize-manager-probe-law-"));
  try {
    const run = steps.find(
      (step: { name?: string }) =>
        step.name === "Verify packed configuration driver laws and command versions",
    ).run as string;
    const match = /<<'JS' >>[^\n]+\n([\s\S]*?)\nJS/u.exec(run);
    assert.ok(match);
    const script = match[1];
    const env = { ...process.env };
    for (const manager of ["npm", "pnpm", "yarn", "bun", "vp"]) {
      // A process control for context isolation, never installed-manager proof.
      writeFakeCommand(
        directory,
        manager,
        `
        const fs = require('node:fs'), path = require('node:path');
        let parent = process.cwd();
        for (;;) {
          const manifest = path.join(parent, 'package.json');
          if (fs.existsSync(manifest) && JSON.parse(fs.readFileSync(manifest)).packageManager) {
            process.stderr.write('project context inherited: ' + manifest + '\\n');
            process.exit(23);
          }
          const next = path.dirname(parent);
          if (next === parent) break;
          parent = next;
        }
        process.stdout.write('fixture-version\\n');
      `,
      );
      env[`${manager.toUpperCase()}_BIN`] = path.join(directory, manager);
    }
    const execute = (body: string) =>
      spawnSync(process.execPath, ["--input-type=module", "-e", body], {
        cwd: root,
        env,
        encoding: "utf8",
        timeout: 10_000,
      });
    const success = execute(script);
    assert.equal(success.status, 0, success.stderr);
    assert.equal(success.signal, null);
    const records = success.stdout
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.deepEqual(
      records.map((record) => record.manager),
      ["npm", "pnpm", "yarn", "bun", "vp"],
    );
    for (const record of records) {
      assert.notEqual(record.cwd, root);
      assert.equal(fs.existsSync(record.cwd), false, "temporary probe cwd is removed");
      assert.deepEqual(record.args, ["--version"]);
      assert.equal(record.status, 0);
      assert.equal(record.stdout, "fixture-version\n");
      assert.equal(record.stderr, "");
    }
    const inherited = script.replace("cwd: managerProbeRoot, ", "");
    assert.notEqual(inherited, script);
    const failure = execute(inherited);
    assert.notEqual(failure.status, 0);
    const failed = JSON.parse(failure.stdout.trim());
    assert.equal(failed.status, 23);
    assert.equal(failed.stderr, `project context inherited: ${path.join(root, "package.json")}\n`);
    assert.match(failure.stderr, /AssertionError/u);
    assert.equal(fs.existsSync(failed.cwd), false, "failed probes also remove their temporary cwd");
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

void test("the refrozen composed producer binds every whole source and moved test module", () => {
  const producer = "c8855589af88f3804686959377d29e85e3d7a4f4";
  const witness = JSON.parse(
    fs.readFileSync(
      path.join(
        root,
        "tests/_fixtures/differential/vite-native-image-identity/packed-config-extension.json",
      ),
      "utf8",
    ),
  );
  assert.equal(workflow.jobs["packed-config-acceptance"].env.PACKED_CONFIG_PRODUCER, producer);
  assert.equal(witness.producer.head, producer);
  assert.equal(witness.producer.composedBase, "178bbe12ea5cb939c2b43f4cc0656e45952c6d3b");
  assert.equal(witness.producer.priorProducer, "820bf6b5d688c77f8edea6ba18ff6f86f76bffae");
  assert.equal(witness.producer.previousFrozenProducer, "9654d136f504765f0dfbdb1e17cf806e0b967878");
  const script = steps.find(
    (step: { name?: string }) => step.name === "Authenticate selected packed configuration source",
  ).run as string;
  const match = /const producerFiles = (\[[\s\S]*?\]);/u.exec(script);
  assert.ok(match);
  const files = [...(runInNewContext(match[1]) as string[])];
  assert.equal(files.length, 26);
  assert.equal(new Set(files).size, files.length);
  assert.deepEqual(files, Object.keys(witness.producer.files));
  const composedFiles = execFileSync(
    "git",
    ["diff", "--name-only", witness.producer.composedBase, producer],
    { cwd: root, encoding: "utf8" },
  )
    .trim()
    .split("\n");
  assert.deepEqual(
    [...files].sort(),
    composedFiles.sort(),
    "the complete finite composition is authenticated",
  );
  execFileSync("git", ["merge-base", "--is-ancestor", producer, "HEAD"], { cwd: root });
  const digest = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
  for (const file of files) {
    const authenticated = execFileSync("git", ["show", `${producer}:${file}`], { cwd: root });
    assert.equal(digest(authenticated), witness.producer.files[file], file);
    assert.equal(
      digest(fs.readFileSync(path.join(root, file))),
      witness.producer.files[file],
      file,
    );
  }
});

void test("the bounded mode has one Linux Node24 job and reuses every fresh-install step", () => {
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

void test("the complete old and new recipes reject unknown, missing, or altered commands", () => {
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

void test("the actual source preflight refuses a wrong immutable SHA and retains its receipt", () => {
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

void test("the actual packed runtime shell retains the full packet without hiding exit17", () => {
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
void test("all sixteen reviewed producer files are bound, including a non-protocol source", () => {
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
    assert.equal(producerFiles.length, 26);
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
    const execute = (selectedProducer = producer) => {
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
          PACKED_CONFIG_PRODUCER: selectedProducer,
          GITHUB_SHA: current,
          GITHUB_WORKFLOW_SHA: current,
          GITHUB_OUTPUT: path.join(directory, "outputs"),
        },
      });
    };
    assert.equal(execute().status, 0, "unchanged complete producer passes source preflight");
    const unrelated = git(
      "commit-tree",
      git("rev-parse", "HEAD^{tree}"),
      "-m",
      "test: unrelated same-tree producer",
    );
    assert.notEqual(execute(unrelated).status, 0, "identical bytes cannot replace source ancestry");
    const moved =
      "crates/vize_maestro/src/server/state/project_contexts/config_reload_recovery_tests.rs";
    assert.ok(producerFiles.includes(moved));
    fs.writeFileSync(path.join(repository, moved), "changed complete migrated test module\n");
    git("add", moved);
    git("commit", "--quiet", "-m", "test: alter moved producer test module");
    assert.notEqual(execute().status, 0);
    const movedReceipt = JSON.parse(
      fs.readFileSync(path.join(directory, "evidence/source.json"), "utf8"),
    );
    assert.notEqual(movedReceipt.files[moved], movedReceipt.producerFiles[moved]);
    fs.writeFileSync(path.join(repository, moved), "reviewed fixture bytes\n");
    git("add", moved);
    git("commit", "--quiet", "-m", "test: restore moved producer test module");
    assert.equal(execute().status, 0, "restoring all producer bytes recovers admission");
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
