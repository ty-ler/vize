import { createHash } from "node:crypto";
import { verifyPackedProducerHistory } from "./support/native-packed-config-history.ts";
import assert from "node:assert/strict";
import { spawnSync, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { parse } from "yaml";
import {
  withoutPackedConfigExtension,
  verifyPackedProducerPreflight,
} from "./support/native-packed-config-extension.ts";
import { writeFakeCommand } from "./support/fake-command.ts";
import { readPackedSourceIdentities } from "./support/native-packed-config-source.ts";

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

void test("the historical composed producer authenticates every whole source and moved test module", () => {
  verifyPackedProducerHistory(
    root,
    workflow.jobs["packed-config-acceptance"].env.PACKED_CONFIG_PRODUCER,
  );
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

// Execute the unchanged real preflight in synthetic history, without builds/installs.
void test("all reviewed producer files and deletion tombstones are bound", () => {
  const script = steps.find(
    (step: { name?: string }) => step.name === "Authenticate selected packed configuration source",
  ).run as string;
  verifyPackedProducerPreflight(script);
});

void test("immutable source batches bind every path, mode, byte and frame without cross-call reuse", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "vize-source-batch-"));
  const previousPath = process.env.PATH;
  try {
    const packetPath = path.join(directory, "packet.json");
    const callsPath = path.join(directory, "calls.jsonl");
    writeFakeCommand(
      directory,
      "git",
      `
      const fs = require('node:fs');
      const packet = JSON.parse(fs.readFileSync(${JSON.stringify(packetPath)}, 'utf8'));
      const input = fs.readFileSync(0, 'utf8');
      fs.appendFileSync(${JSON.stringify(callsPath)}, JSON.stringify({ argv: process.argv.slice(2), input }) + '\\n');
      process.stdout.write(Buffer.from(process.argv[2] === 'ls-tree' ? packet.tree : packet.batch, 'base64'));
    `,
    );
    process.env.PATH = `${directory}${path.delimiter}${previousPath ?? ""}`;
    const ref = "1".repeat(40);
    const bytes = Buffer.from([97, 0, 98, 10]);
    const oid = createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
    const hash = createHash("sha256").update(bytes).digest("hex");
    const tree = Buffer.from(`100644 blob ${oid}\ta.ts\0` + `100755 blob ${oid}\tb.ts\0`);
    const frame = Buffer.concat([
      Buffer.from(`${oid} blob ${bytes.length}\n`),
      bytes,
      Buffer.from("\n"),
    ]);
    const batch = Buffer.concat([frame, frame]);
    const save = (treeBytes: Buffer, batchBytes: Buffer) =>
      fs.writeFileSync(
        packetPath,
        JSON.stringify({
          tree: treeBytes.toString("base64"),
          batch: batchBytes.toString("base64"),
        }),
      );
    save(tree, batch);
    assert.deepEqual(
      [...readPackedSourceIdentities(directory, ref, ["a.ts", "b.ts", "missing.ts"])],
      [
        ["a.ts", { mode: "100644", blob: oid, sha256: hash }],
        ["b.ts", { mode: "100755", blob: oid, sha256: hash }],
        ["missing.ts", null],
      ],
    );
    assert.deepEqual(
      fs
        .readFileSync(callsPath, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line)),
      [
        { argv: ["ls-tree", "-rz", ref, "--", "a.ts", "b.ts", "missing.ts"], input: "" },
        { argv: ["cat-file", "--batch"], input: `${oid}\n${oid}\n` },
      ],
    );
    const wrongBody = Buffer.from(batch);
    wrongBody[frame.length - 3] ^= 1;
    const highBitHeader = Buffer.from(batch);
    highBitHeader[0] += 128;
    for (const [badTree, badBatch] of [
      [Buffer.concat([tree, tree]), batch],
      [Buffer.from(tree.toString().replace("a.ts", "unknown.ts")), batch],
      [Buffer.from(tree.toString().replace("100644", "160000")), batch],
      [tree.subarray(0, -1), batch],
      [tree, Buffer.from(batch.toString().replace(oid, "2".repeat(40)))],
      [tree, wrongBody],
      [tree, highBitHeader],
      [tree, batch.subarray(0, -1)],
      [tree, Buffer.concat([batch, Buffer.from("extra")])],
    ]) {
      save(badTree, badBatch);
      assert.throws(() =>
        readPackedSourceIdentities(directory, ref, ["a.ts", "b.ts", "missing.ts"]),
      );
    }
    // A new call must reread the immutable view, rather than return the earlier valid packet.
    save(Buffer.alloc(0), Buffer.alloc(0));
    assert.deepEqual([...readPackedSourceIdentities(directory, ref, ["a.ts"])], [["a.ts", null]]);
    assert.throws(() => readPackedSourceIdentities(directory, ref, ["../a.ts"]));
    assert.throws(() => readPackedSourceIdentities(directory, ref, ["a.ts", "a.ts"]));
  } finally {
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
