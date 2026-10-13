import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { TestContext } from "node:test";
import { parse } from "yaml";

import {
  runScriptParts,
  scriptParts,
} from "../../tools/support/compat/github/run-package-check-parts.ts";
import type { PartResult } from "../../tools/support/compat/github/run-package-check-parts.ts";
import { readRepoFile, root } from "./support/github-workflows.ts";

type Step = { name?: string; run?: string };
const ui = path.join(root, "npm/ui");

function fixture(t: TestContext, scripts: Record<string, string>) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "vize-check-parts-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.writeFileSync(path.join(directory, "package.json"), JSON.stringify({ scripts }));
  return directory;
}

void test("CI runs exactly the UI check script's parts after the native build", () => {
  const check = JSON.parse(readRepoFile("npm", "ui", "package.json")).scripts.check as string;
  assert.deepEqual(
    scriptParts(ui, "check").map((part) => `pnpm ${part}`),
    check.split(" && "),
  );
  assert.deepEqual(scriptParts(ui, "check"), [
    "lint:sfc",
    "check:static",
    "check:story-testbed",
    "check:vapor-runtime",
  ]);
  const workflow = parse(readRepoFile(".github", "workflows", "pr-js-checks.yml")) as {
    jobs: Record<string, { steps: Step[] }>;
  };
  const step = workflow.jobs["pr-js-package-conformance"].steps.find(
    ({ name }) => name === "Check UI package conformance",
  );
  assert.equal(
    step?.run,
    "vp run --filter './npm/native' build:ci && node tools/support/compat/github/run-package-check-parts.ts npm/ui check",
  );
});

void test("only plain, distinct package script calls are split", (t) => {
  for (const script of [
    "pnpm a; pnpm b",
    "pnpm a && vp check src",
    "pnpm a && pnpm a",
    "pnpm a || pnpm b",
    "pnpm a && pnpm b --fix",
  ])
    assert.throws(() => scriptParts(fixture(t, { check: script }), "check"), script);
  assert.throws(() => scriptParts(fixture(t, {}), "check"), /no check script/u);
});

void test("every part runs concurrently and is awaited; output stays in script order", async (t) => {
  const directory = fixture(t, { check: "pnpm one && pnpm two && pnpm three" });
  for (const failing of [null, "two"]) {
    const started: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const run = async (part: string): Promise<PartResult> => {
      started.push(part);
      if (started.length === 3) release();
      await gate;
      // Finish in reverse order; the printed order must not follow completion.
      await new Promise((resolve) => setTimeout(resolve, part === "one" ? 30 : 0));
      return { part, status: part === failing ? 2 : 0, signal: null, output: Buffer.from(part) };
    };
    const written: string[] = [];
    const status = await runScriptParts(directory, "check", {
      run,
      write: (bytes) => written.push(String(bytes)),
    });
    assert.deepEqual(started, ["one", "two", "three"]);
    assert.equal(status, failing ? 1 : 0);
    const output = written.join("");
    assert.ok(output.indexOf("one") < output.indexOf("two"));
    assert.ok(output.indexOf("two") < output.indexOf("three"));
    if (failing) assert.match(output, /pnpm two failed in check/u);
  }
});

void test("the runner executes `pnpm <part>` in the package directory and fails on any part", async (t) => {
  const directory = fixture(t, { check: "pnpm good && pnpm bad" });
  const bin = path.join(directory, "bin");
  fs.mkdirSync(bin);
  fs.writeFileSync(
    path.join(bin, "pnpm"),
    `#!${process.execPath}\nconst fs = require("node:fs");\nfs.appendFileSync(${JSON.stringify(path.join(directory, "calls"))}, JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd() }) + "\\n");\nprocess.stdout.write("ran " + process.argv[2] + "\\n");\nprocess.exit(process.argv[2] === "bad" ? 3 : 0);\n`,
    { mode: 0o755 },
  );
  const previous = process.env.PATH;
  process.env.PATH = `${bin}${path.delimiter}${previous}`;
  t.after(() => {
    process.env.PATH = previous;
  });
  const written: string[] = [];
  const status = await runScriptParts(directory, "check", {
    write: (bytes) => written.push(String(bytes)),
  });
  assert.equal(status, 1);
  const calls = fs
    .readFileSync(path.join(directory, "calls"), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.deepEqual(
    calls.map(({ args }) => args.join(" ")).sort((a: string, b: string) => a.localeCompare(b)),
    ["bad", "good"],
  );
  for (const { cwd } of calls) assert.equal(fs.realpathSync(cwd), fs.realpathSync(directory));
  assert.match(written.join(""), /ran good\n[\s\S]*ran bad\n[\s\S]*pnpm bad failed in check/u);
});
