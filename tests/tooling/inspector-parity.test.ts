import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, renameSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  assertInspectorFileCoverage,
  inspectorReportDirectory,
} from "../_helpers/inspector-parity.ts";

test("inspector reports use the shared artifact directory by default", () => {
  const outputDirectory = inspectorReportDirectory("Example / Application");

  const expectedSuffix = path.join(".vize", "artifacts", "inspect", "Example-Application");
  assert.ok(
    outputDirectory.endsWith(expectedSuffix),
    `Expected path to end with "${expectedSuffix}", but got "${outputDirectory}"`,
  );
});

test("inspector reports preserve an explicit output directory", () => {
  assert.equal(
    inspectorReportDirectory("Example", "/tmp/inspection-output"),
    "/tmp/inspection-output",
  );
});

test("inspector coverage rejects omitted, duplicate or substituted original inputs", (t) => {
  const cwd = mkdtempSync(path.join(tmpdir(), "inspector-inputs-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  mkdirSync(path.join(cwd, "app", "nested"), { recursive: true });
  for (const file of ["app/App.vue", "app/nested/Child.vue", "app/ignored.ts"]) {
    writeFileSync(path.join(cwd, file), "original source\n");
  }
  const check = { cwd, patterns: ["app/**/*.vue", "app/App.vue"] };
  const report = (paths: string[], fileCount = paths.length) => ({
    summary: { fileCount },
    files: paths.map((file) => ({ path: file })),
  });
  const inputs = ["app/App.vue", "app/nested/Child.vue"];
  const identity = {
    fileCount: 2,
    pathsSha256: createHash("sha256").update("app/App.vue\napp/nested/Child.vue\n").digest("hex"),
  };
  assertInspectorFileCoverage(check, report(inputs.toReversed()), identity);
  for (const paths of [
    [inputs[0]],
    [inputs[0], inputs[0]],
    [inputs[0], "app/ignored.ts"],
    [...inputs, "app/extra.vue"],
    [],
  ]) {
    assert.throws(
      () => assertInspectorFileCoverage(check, report(paths, 2), identity),
      /every original source exactly once/,
    );
  }
  assert.throws(
    () => assertInspectorFileCoverage(check, report(inputs, 1), identity),
    /source count/,
  );
  assert.throws(
    () => assertInspectorFileCoverage({ cwd, patterns: ["absent/**/*.vue"] }, report([]), identity),
    /must contain original source inputs/,
  );
  renameSync(path.join(cwd, inputs[1]), path.join(cwd, "app/nested/Renamed.vue"));
  assert.throws(
    () =>
      assertInspectorFileCoverage(check, report([inputs[0], "app/nested/Renamed.vue"]), identity),
    /pinned original source paths/,
  );
  unlinkSync(path.join(cwd, "app/nested/Renamed.vue"));
  assert.throws(
    () => assertInspectorFileCoverage(check, report([inputs[0]]), identity),
    /pinned original source count/,
  );
});
