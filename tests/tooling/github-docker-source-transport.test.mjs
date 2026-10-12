import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { writeBuildReceipt } from "../differential/build-receipt.ts";
import {
  packSourceCli,
  restoreSourceCli,
} from "../../tools/support/compat/github/source-cli-artifact.ts";
import {
  CLI_MEMBERS,
  command,
  digest,
} from "../../tools/support/compat/github/source-cli-identity.ts";

const root = fileURLToPath(new URL("../../", import.meta.url));
const observation = `
import json, sys
from pathlib import Path
sys.dont_write_bytecode = True
sys.path.insert(0, sys.argv[2])
from docker_phase_packets import checkout_identity, source_identity
root = Path(sys.argv[1]).resolve()
print(json.dumps(source_identity(root, checkout_identity(root))))
`;

void test("Docker custody consumes the actual pack/restore envelope and every original member", () => {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "docker-source-law-")));
  try {
    const producer = path.join(base, "producer");
    const consumer = path.join(base, "consumer");
    fs.mkdirSync(path.join(producer, "npm/native"), { recursive: true });
    fs.writeFileSync(path.join(producer, "Cargo.toml"), '[workspace.package]\nversion = "0.1.0"\n');
    fs.writeFileSync(path.join(producer, "npm/native/index.d.ts"), "original declaration\n");
    for (const helper of [
      "tools/support/compat/github/source-cli-artifact.ts",
      "tools/support/compat/github/source-cli-identity.ts",
      "tests/differential/build-receipt.ts",
      "tests/differential/sha256.ts",
    ]) {
      fs.mkdirSync(path.dirname(path.join(producer, helper)), { recursive: true });
      fs.copyFileSync(path.join(root, helper), path.join(producer, helper));
    }
    command(producer, "git", ["init", "--quiet"]);
    command(producer, "git", ["add", "Cargo.toml", "npm/native/index.d.ts", "tools", "tests"]);
    command(producer, "git", [
      "-c",
      "user.name=Law",
      "-c",
      "user.email=law@example.invalid",
      "commit",
      "--quiet",
      "-m",
      "law",
    ]);
    command(base, "git", ["clone", "--quiet", producer, consumer]);
    for (const member of [CLI_MEMBERS[0], CLI_MEMBERS[2]]) {
      fs.mkdirSync(path.dirname(path.join(producer, member)), { recursive: true });
      fs.writeFileSync(path.join(producer, member), `inert transport ${member}\n`, { mode: 0o755 });
    }
    writeBuildReceipt(producer);
    fs.chmodSync(path.join(producer, CLI_MEMBERS[1]), 0o644);
    /** @type {Parameters<typeof packSourceCli>[2]} */
    const identity = {
      sourceRevision: command(producer, "git", ["rev-parse", "HEAD"]),
      sourceTree: command(producer, "git", ["rev-parse", "HEAD^{tree}"]),
      runId: "123",
      runAttempt: "2",
      platform: "linux",
      arch: "x64",
      rustc: "fixture rustc",
      cargo: "fixture cargo",
      linker: "fixture wild",
      linkerSha256: "1".repeat(64),
      driver: "fixture clang",
      cargoConfig: 'linker = "clang"\n',
      flags: {},
    };
    const archive = path.join(base, "source-cli.tar.gz");
    const hashes = packSourceCli(producer, archive, identity);
    restoreSourceCli(consumer, archive, hashes.sha256, identity);
    const tools = path.join(base, "configured-node");
    fs.mkdirSync(tools);
    fs.symlinkSync(process.execPath, path.join(tools, "node"));
    fs.writeFileSync(path.join(tools, "vp"), "#!/bin/sh\nexit 71\n", { mode: 0o755 });
    const env = {
      ...process.env,
      PATH: `${tools}${path.delimiter}${process.env.PATH ?? ""}`,
      GITHUB_SHA: identity.sourceRevision,
      GITHUB_RUN_ID: "123",
      GITHUB_RUN_ATTEMPT: "2",
      VIZE_SOURCE_CLI_RECEIPT_SHA256: hashes.receiptSha256,
    };
    delete env.VIZE_SOURCE_CLI_USE_RECEIPT_SHA256;
    assert.equal(
      execFileSync("node", ["-p", "process.execPath"], { env, encoding: "utf8" }).trim(),
      fs.realpathSync(process.execPath),
    );
    assert.throws(() => execFileSync("vp", ["node", "--version"], { env }));
    const observe = (extra = {}) =>
      JSON.parse(
        execFileSync(
          "python3",
          ["-c", observation, consumer, path.join(root, "tools/support/compat/github")],
          {
            cwd: consumer,
            env: { ...env, ...extra },
            encoding: "utf8",
            stdio: ["ignore", "pipe", "pipe"],
          },
        ),
      );
    assert.notEqual(
      digest(fs.readFileSync(path.join(consumer, CLI_MEMBERS[1]))),
      hashes.receiptSha256,
    );
    const actual = observe();
    assert.equal(actual.cliReceiptSha256, hashes.receiptSha256);
    assert.equal(actual.cliConsumerUse, null);
    assert.deepEqual(actual.cliMembers, actual.cliReceipt.members);
    assert.equal(actual.differentialReceipt.sourceRevision, identity.sourceRevision);
    assert.throws(() => observe({ GITHUB_RUN_ATTEMPT: "3" }));
    assert.throws(() =>
      observe({
        VIZE_SOURCE_CLI_RECEIPT_SHA256: digest(
          fs.readFileSync(path.join(consumer, CLI_MEMBERS[1])),
        ),
      }),
    );
    for (const member of CLI_MEMBERS) {
      const filename = path.join(consumer, member);
      const bytes = fs.readFileSync(filename);
      const stat = fs.statSync(filename);
      const changed = Buffer.from(bytes);
      changed[0] ^= 1;
      fs.writeFileSync(filename, changed);
      fs.utimesSync(filename, stat.atime, stat.mtime);
      assert.throws(observe);
      fs.writeFileSync(filename, bytes);
      fs.chmodSync(filename, stat.mode & 0o7777);
      fs.chmodSync(filename, 0o600);
      assert.throws(observe);
      fs.chmodSync(filename, stat.mode & 0o7777);
      const moved = filename + ".saved";
      fs.renameSync(filename, moved);
      fs.symlinkSync(moved, filename);
      assert.throws(observe);
      fs.unlinkSync(filename);
      fs.renameSync(moved, filename);
    }
    assert.deepEqual(observe().cliMembers, actual.cliMembers);
    const immutableProducer = fs.readFileSync(
      path.join(consumer, "target/ci/vize.source-build.json"),
    );
    const useSha256 = restoreSourceCli(
      consumer,
      archive,
      hashes.sha256,
      { ...identity, runAttempt: "3" },
      "2",
      hashes.receiptSha256,
    );
    const retryEnv = {
      GITHUB_RUN_ATTEMPT: "3",
      VIZE_SOURCE_CLI_USE_RECEIPT_SHA256: useSha256,
    };
    const retried = observe(retryEnv);
    assert.deepEqual(retried.cliConsumerUse, {
      useReceiptSha256: useSha256,
      producerAttempt: "2",
      consumerAttempt: "3",
    });
    assert.deepEqual(retried.cliMembers, actual.cliMembers);
    assert.deepEqual(retried.cliReceipt, actual.cliReceipt);
    assert.deepEqual(
      fs.readFileSync(path.join(consumer, "target/ci/vize.source-build.json")),
      immutableProducer,
    );
    assert.throws(() => observe({ GITHUB_RUN_ATTEMPT: "3" }));
    for (const foreign of [
      { GITHUB_RUN_ATTEMPT: "1" },
      { GITHUB_RUN_ATTEMPT: "4" },
      { GITHUB_RUN_ID: "124" },
      { GITHUB_SHA: "a".repeat(40) },
      { VIZE_SOURCE_CLI_USE_RECEIPT_SHA256: "a".repeat(64) },
      { VIZE_SOURCE_CLI_USE_RECEIPT_SHA256: "" },
    ]) {
      assert.throws(() => observe({ ...retryEnv, ...foreign }));
    }
    const usePath = path.join(consumer, "target/ci/vize.source-use.json");
    fs.chmodSync(usePath, 0o600);
    assert.throws(() => observe(retryEnv));
    fs.chmodSync(usePath, 0o644);
    fs.renameSync(usePath, usePath + ".saved");
    fs.symlinkSync(usePath + ".saved", usePath);
    assert.throws(() => observe(retryEnv));
    fs.unlinkSync(usePath);
    fs.renameSync(usePath + ".saved", usePath);
    for (const member of CLI_MEMBERS) {
      const filename = path.join(consumer, member);
      const bytes = fs.readFileSync(filename);
      const changed = Buffer.from(bytes);
      changed[0] ^= 1;
      fs.writeFileSync(filename, changed);
      assert.throws(() => observe(retryEnv));
      fs.writeFileSync(filename, bytes);
    }
    assert.deepEqual(observe(retryEnv).cliMembers, actual.cliMembers);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});
