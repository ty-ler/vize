import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";

import {
  baselineConfig,
  resolveBaselineRuntime,
  retainEnabledFindings,
  runBaseline,
  selectComparableRules,
} from "../../tools/support/compat/fixtures/lint-divergence-baseline.mjs";

const root = path.resolve(import.meta.dirname, "../..");
const runtime = resolveBaselineRuntime();
const map = JSON.parse(
  fs.readFileSync(path.join(root, "tests/_fixtures/patina-eslint-vue-rule-map.json"), "utf8"),
);
const { rules } = selectComparableRules(map, "ecosystem", { includeUnimplemented: true });
assert.equal(runtime.version, map.upstream.version);
const source = fs.readFileSync(
  path.join(root, "tools/commands/fixtures/lint-divergence-report.rs"),
  "utf8",
);
const script = source.match(/let script = r#"([\s\S]*?)"#;/u)?.[1];
assert.ok(script, "the actual Rust baseline payload must exist");
const evidence: unknown[] = [];

after(() => {
  const directory = path.join(root, "target/differential/lint-declared-typescript-parser");
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(
    path.join(directory, "whole-provider-results.json"),
    JSON.stringify({ version: runtime.version, rules, evidence }, null, 2) + "\n",
  );
});

async function fixture(
  name: string,
  files: Record<string, string>,
  verify: (cwd: string) => Promise<void>,
) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), `vize-lint-${name}-`));
  try {
    for (const [file, body] of Object.entries(files)) {
      const target = path.join(cwd, file);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, body);
    }
    await verify(cwd);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
}

async function reference(cwd: string, files: string[], jsx: boolean) {
  const config = baselineConfig(runtime, rules);
  config[0].languageOptions.parserOptions.parser = runtime.scriptParser;
  config[0].languageOptions.parserOptions.ecmaFeatures.jsx = jsx;
  const eslint = new runtime.ESLint({
    cwd,
    overrideConfigFile: true,
    overrideConfig: config,
    errorOnUnmatchedPattern: false,
  });
  return JSON.parse(JSON.stringify(retainEnabledFindings(await eslint.lintFiles(files), rules)));
}

function canonical(cwd: string, files: string[]) {
  const result = spawnSync(process.execPath, ["--input-type=module", "--eval", script!], {
    cwd: root,
    encoding: "utf8",
    input: JSON.stringify({
      benchPackageJson: path.join(root, "tools/benchmarks/scripts/package.json"),
      cwd,
      files,
      rules,
    }),
  });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const { version, ...findings } = JSON.parse(result.stdout);
  assert.equal(version, runtime.version);
  return findings;
}

async function both(cwd: string, files: string[]) {
  // Match the Rust payload's existing whole JSON transport, including all
  // messages; in-process ESLint also carries non-JSON `info: undefined` fields.
  const compatible = JSON.parse(JSON.stringify(await runBaseline(runtime, cwd, files, rules)));
  const actual = canonical(cwd, files);
  assert.deepEqual(
    actual,
    compatible,
    "both real baseline entry points must return whole equal results",
  );
  return { compatible, canonical: actual };
}

function fatals(result: {
  results: {
    messages: { ruleId: string | null; fatal?: boolean; line: number; column: number }[];
  }[];
}) {
  return result.results.flatMap((entry) =>
    entry.messages.filter((message) => message.ruleId == null),
  );
}

test("whole pinned TypeScript sources retain every provider finding after the parser correction", async () => {
  const inputs = JSON.parse(
    fs.readFileSync(
      path.join(root, "tests/_fixtures/lint-declared-typescript-pinned-sources.json"),
      "utf8",
    ),
  );
  for (const input of inputs) {
    const body = Buffer.from(input.source);
    assert.equal(createHash("sha256").update(body).digest("hex"), input.sha256);
    assert.equal(
      createHash("sha1").update(`blob ${body.length}\0`).update(body).digest("hex"),
      input.gitBlob,
    );
    await fixture(input.project, { [input.path]: input.source }, async (cwd) => {
      const original = await reference(cwd, [input.path], true);
      const expected = await reference(cwd, [input.path], false);
      const candidate = await both(cwd, [input.path]);
      evidence.push({ input, original, expected, candidate });
      assert.equal(fatals(original).length, 1);
      assert.equal(fatals(original)[0].fatal, true);
      assert.equal(fatals(original)[0].line, input.originalFatal.line);
      assert.equal(fatals(original)[0].column, input.originalFatal.column);
      assert.equal(fatals(expected).length, 0);
      assert.ok(expected.results[0].messages.length > 0, "real rule findings must survive parsing");
      assert.deepEqual(candidate.compatible, expected);
    });
  }
});

test("minimal TypeScript generic arrows and angle assertions retain rule spans and severities", async () => {
  await fixture(
    "minimal-ts",
    {
      "Generic.vue":
        '<script setup lang="ts">\nconst id = <T>(value: T): T => value\n</script>\n<template><div v-html="id(\'text\')" /></template>\n',
      "Assertion.vue":
        '<script setup lang="ts">\nconst value = <string | null>null\n</script>\n<template><div v-html="value" /></template>\n',
    },
    async (cwd) => {
      const files = ["Generic.vue", "Assertion.vue"];
      const expected = await reference(cwd, files, false);
      const candidate = await both(cwd, files);
      evidence.push({ files, expected, candidate });
      assert.equal(fatals(candidate.compatible).length, 0);
      assert.deepEqual(candidate.compatible, expected);
      for (const entry of candidate.compatible.results) {
        assert.ok(
          entry.messages.some((message: { ruleId: string }) => message.ruleId === "vue/no-v-html"),
        );
      }
    },
  );
});

test("JSX, TSX, ordinary scripts, templates and unknown language fallback retain whole original results", async () => {
  const files = {
    "Tsx.vue":
      '<script setup lang="tsx">\nconst render = () => <div />\n</script>\n<template><div v-html="render" /></template>\n',
    "Jsx.vue":
      '<script setup lang="jsx">\nconst render = () => <div />\n</script>\n<template><div v-html="render" /></template>\n',
    "Plain.vue":
      '<script setup>\nconst render = () => <div />\n</script>\n<template><div v-html="render" /></template>\n',
    "DeclaredJs.vue":
      '<script setup lang="js">\nconst render = () => <div />\n</script>\n<template><div v-html="render" /></template>\n',
    "Template.vue":
      '<script setup lang="ts">\nconst value = 1 as number\n</script>\n<template><div v-html="value" /></template>\n',
    "TemplateJsx.vue":
      '<script setup lang="ts">\nconst value = 1 as number\n</script>\n<template><div v-html="(() => <span />)()" /></template>\n',
    "Unknown.vue":
      '<script lang="uts">\nsetTitle(value, for = State.normal)\n</script>\n<template><div /></template>\n',
  };
  await fixture("unaffected", files, async (cwd) => {
    const names = Object.keys(files);
    const original = await reference(cwd, names, true);
    const candidate = await both(cwd, names);
    evidence.push({ files, original, candidate });
    assert.deepEqual(candidate.compatible, original);
    assert.equal(fatals(original).length, 1, "unknown UTS grammar must remain an honest refusal");
    for (const entry of original.results.filter(
      (entry: { filePath: string }) => !entry.filePath.endsWith("Unknown.vue"),
    )) {
      assert.ok(
        entry.messages.some((message: { ruleId: string }) => message.ruleId === "vue/no-v-html"),
      );
    }
  });
});

test("malformed TS and TSX still retain fatal provider messages", async () => {
  const files = {
    "BrokenTs.vue": '<script setup lang="ts">\nconst =\n</script>\n<template><div /></template>\n',
    "BrokenTsx.vue":
      '<script setup lang="tsx">\nconst render = () => <div\n</script>\n<template><div /></template>\n',
  };
  await fixture("malformed", files, async (cwd) => {
    const names = Object.keys(files);
    const original = await reference(cwd, names, true);
    const candidate = await both(cwd, names);
    evidence.push({ files, original, candidate });
    assert.deepEqual(candidate.compatible, original);
    assert.equal(fatals(candidate.compatible).length, 2);
    assert.ok(fatals(candidate.compatible).every((message) => message.fatal));
  });
});
