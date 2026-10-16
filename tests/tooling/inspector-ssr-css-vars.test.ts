import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const fixture = new URL(
  "../_fixtures/differential/compiler/inspector-ssr-css-vars/",
  import.meta.url,
);
const read = (name: string) => readFileSync(new URL(name, fixture), "utf8");
const source = read("StatusMedia.vue.txt");
const origin = JSON.parse(read("source.json"));
const requireVue = createRequire(new URL("../package.json", import.meta.url));
const compiler = requireVue("vue/compiler-sfc");
const rust = readFileSync(
  new URL("../../crates/vize/src/commands/inspector.rs", import.meta.url),
  "utf8",
);
const marker = 'const OFFICIAL_COMPILER_NODE_SCRIPT: &str = r#"';
assert.equal(rust.split(marker).length, 2);
const embedded = rust.slice(rust.indexOf(marker) + marker.length).split('"#;')[0];
const cwd = fileURLToPath(new URL("../", import.meta.url));

interface ComparedFile {
  path: string;
  parser: string;
  official: {
    code: string;
    formattedCode: string;
    warnings: string[];
    error: string | null;
    timeMs: number;
  };
  vizeFormattedCode: string;
}

function compare(target: "dom" | "ssr", input: string): ComparedFile {
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", embedded], {
    cwd,
    input: JSON.stringify({
      target,
      moduleRoot: cwd,
      files: [{ path: origin.path, source: input, vizeCode: "" }],
    }),
    encoding: "utf8",
    timeout: 30_000,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "", "official compiler must not warn about omitted SSR CSS vars");
  const report = JSON.parse(result.stdout) as { files: ComparedFile[] };
  assert.equal(report.files.length, 1);
  const file = report.files[0];
  assert.equal(file.path, origin.path);
  assert.equal(file.parser, "typescript");
  assert.equal(file.official.error, null);
  assert.deepEqual(file.official.warnings, []);
  assert.equal(file.vizeFormattedCode, "");
  return file;
}

void test("inspector retains the complete pinned Elk StatusMedia source and official provider", () => {
  assert.equal(Buffer.byteLength(source), origin.sourceBytes);
  assert.equal(createHash("sha256").update(source).digest("hex"), origin.sourceSha256);
  assert.equal(compiler.version, origin.officialVersion);
  assert.deepEqual(compiler.parse(source, { filename: origin.path }).descriptor.cssVars, [
    "gridColumnNumber",
  ]);
});

void test("official inspector SSR includes the authored CSS variable without changing DOM output", () => {
  for (const target of ["dom", "ssr"] as const) {
    const file = compare(target, source);
    assert.equal(file.official.code, read(`StatusMedia.${target}.expected.ts.txt`));
  }
  const original = read("StatusMedia.ssr.original.ts.txt");
  assert.doesNotMatch(original, /const _cssVars/);
  assert.notEqual(original, read("StatusMedia.ssr.expected.ts.txt"));
  const renderer = requireVue("vue/server-renderer");
  assert.equal(renderer.ssrRenderStyle({ ":--v4a184587": 2 }), "--v4a184587:2;");
});

void test("the same whole SFC with a literal CSS value emits no SSR CSS variable", () => {
  const expression = "v-bind(gridColumnNumber)";
  assert.equal(source.split(expression).length, 2);
  const control = source.replace(expression, "2");
  const file = compare("ssr", control);
  assert.doesNotMatch(file.official.code, /const _cssVars|:--v4a184587|_useCssVars/);
});
