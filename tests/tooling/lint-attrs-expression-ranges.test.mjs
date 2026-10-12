import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { expectedBuildIdentity, validateBuildReceipt } from "../differential/build-receipt.ts";
import { sha256 } from "./lint-default-correctness-reference.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const fixture = path.join(root, "tests/_fixtures/differential/lint/attrs-expression-ranges-8090");

await test("attrs forwarding preserves all twenty five whole source CLI packets", () => {
  const bytes = fs.readFileSync(path.join(fixture, "cases.json"));
  assert.equal(sha256(bytes), "76de7272ef8f7f3f90fb50101c62a9e068af215f38014dc6f6fd41ec39555d0c");
  const corpus = JSON.parse(bytes);
  assert.equal(corpus.cases.length, 25);
  const build = expectedBuildIdentity(root);
  const receipt = JSON.parse(
    fs.readFileSync(path.join(root, build.binaryPath + ".differential-build.json"), "utf8"),
  );
  validateBuildReceipt(receipt, build);
  const artifact = path.join(root, "target/differential/lint-attrs-expression-ranges.json");
  fs.mkdirSync(path.dirname(artifact), { recursive: true });
  const evidence = {
    schema: "vize.lint.attrs-expression-ranges-source-cli",
    version: 1,
    corpusSha256: sha256(bytes),
    corpus,
    build: { expected: build, receipt },
    runs: [],
  };
  const persist = () => fs.writeFileSync(artifact, JSON.stringify(evidence, null, 2) + "\n");
  persist();
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "vize-attrs-expression-ranges-"));
  try {
    for (const entry of corpus.cases) {
      const source = fs.readFileSync(path.join(fixture, entry.sourceFile));
      assert.equal(source.toString("utf8"), entry.source);
      assert.equal(sha256(source), entry.sourceSha256);
      const filename = path.join(directory, entry.filename);
      fs.writeFileSync(filename, source);
      const config = JSON.stringify(entry.config, null, 2) + "\n";
      fs.writeFileSync(path.join(directory, "vize.config.json"), config);
      const argv = [
        "lint",
        "--config",
        "vize.config.json",
        "--format",
        "json",
        "--locale",
        "en",
        "--help-level",
        "none",
        entry.filename,
      ];
      const run = spawnSync(path.join(root, build.binaryPath), argv, {
        cwd: directory,
        env: process.env,
        timeout: 60_000,
        maxBuffer: 4 * 1024 * 1024,
      });
      const after = fs.readFileSync(filename);
      const record = {
        id: entry.id,
        filename: entry.filename,
        source: entry.source,
        sourceSha256: entry.sourceSha256,
        argv,
        cwd: directory,
        config,
        configSha256: sha256(config),
        status: run.status,
        signal: run.signal,
        error: run.error?.message ?? null,
        stdoutBase64: run.stdout.toString("base64"),
        stderrBase64: run.stderr.toString("base64"),
        expected: entry.afterCli,
        expectedStatus: entry.afterStatus,
        finalSource: after.toString("utf8"),
        finalSourceSha256: sha256(after),
      };
      evidence.runs.push(record);
      persist();
      assert.equal(run.error, undefined, entry.id);
      assert.equal(run.signal, null, entry.id);
      assert.equal(run.status, entry.afterStatus, entry.id);
      record.wholeJson = JSON.parse(run.stdout.toString("utf8"));
      persist();
      assert.deepEqual(record.wholeJson, entry.afterCli, entry.id);
      assert.deepEqual(after, source, entry.id);
    }
    assert.equal(evidence.runs.length, 25);
  } finally {
    persist();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
