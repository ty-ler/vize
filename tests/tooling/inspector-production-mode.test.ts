import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createRequire } from "node:module";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { compileFunction } from "node:vm";
import ts from "typescript";

const fixture = new URL(
  "../_fixtures/differential/compiler/inspector-production-mode/",
  import.meta.url,
);
const read = (name: string) => readFileSync(new URL(name, fixture), "utf8");
const source = read("Mutes.vue.txt");
const origin = JSON.parse(read("source.json"));
const requireVue = createRequire(new URL("../package.json", import.meta.url));
const vue: typeof import("vue") = requireVue("vue");
const server: typeof import("vue/server-renderer") = requireVue("vue/server-renderer");
const rust = readFileSync(
  new URL("../../crates/vize/src/commands/inspector/compare.rs", import.meta.url),
  "utf8",
);
assert.ok(
  rust.includes(
    'const OFFICIAL_COMPILER_NODE_SCRIPT: &str = include_str!("official_compiler.ts");',
  ),
);
const embedded = readFileSync(
  new URL("../../crates/vize/src/commands/inspector/official_compiler.ts", import.meta.url),
  "utf8",
);
const cwd = fileURLToPath(new URL("../", import.meta.url));

function compare(target: "dom" | "ssr", parentMode: string | undefined): string {
  const env = { ...process.env };
  if (parentMode === undefined) delete env.NODE_ENV;
  else env.NODE_ENV = parentMode;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", embedded], {
    cwd,
    env,
    input: JSON.stringify({
      target,
      moduleRoot: cwd,
      files: [{ path: origin.path, source, vizeCode: "" }],
    }),
    encoding: "utf8",
    timeout: 30_000,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  const { files } = JSON.parse(result.stdout);
  assert.equal(files.length, 1);
  assert.equal(files[0].path, origin.path);
  assert.equal(files[0].official.error, null);
  assert.deepEqual(files[0].official.warnings, []);
  return files[0].official.code;
}

void test("Inspector's production reference is independent of its parent Node environment", () => {
  assert.equal(Buffer.byteLength(source), origin.sourceBytes);
  assert.equal(createHash("sha256").update(source).digest("hex"), origin.sourceSha256);
  assert.equal(requireVue("vue/compiler-sfc").version, origin.officialVersion);
  for (const target of ["dom", "ssr"] as const) {
    const expected = read(`Mutes.production.${target}.expected.ts.txt`);
    assert.notEqual(expected, read(`Mutes.development.${target}.expected.ts.txt`));
    for (const mode of [undefined, "development", "production"]) {
      assert.equal(compare(target, mode), expected, `${target}, parent NODE_ENV=${mode}`);
    }
  }
});

type Push = (html: string) => void;
type Render = (
  ctx: object,
  push: Push,
  parent: unknown,
  attrs: object,
  props: object,
  setup: object,
  data: object,
  options: object,
) => void;

function loadRender(code: string): Render {
  const ast = ts.createSourceFile("Mutes.ts", code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const imports = ast.statements.filter(ts.isImportDeclaration);
  const render = ast.statements.find(
    (node) => ts.isFunctionDeclaration(node) && node.name?.text === "ssrRender",
  );
  assert.ok(render, "retain the complete original emitted render function");
  const extracted =
    imports.map((node) => node.getFullText(ast)).join("\n") +
    "\n" +
    render.getFullText(ast).replace(/export\s+function\s+ssrRender/, "function ssrRender") +
    "\nexports.render = ssrRender;";
  const output = ts.transpileModule(extracted, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports: { render?: Render } = {};
  compileFunction(output, ["require", "exports"])((specifier: string) => {
    assert.ok(["vue", "vue/server-renderer"].includes(specifier));
    return specifier === "vue" ? vue : server;
  }, exports);
  assert.ok(exports.render);
  return exports.render;
}

async function renderOriginal(
  code: string,
  route: "push" | "vnode",
  hydrated: boolean,
): Promise<string> {
  const generated = loadRender(code);
  const app = vue.createSSRApp({
    ssrRender(_ctx: unknown, push: Push, parent: unknown, attrs: object) {
      generated(
        { isHydrated: hydrated, $t: (key: string) => key },
        push,
        parent,
        attrs,
        {},
        {},
        {},
        {},
      );
    },
  });
  const host =
    route === "vnode"
      ? vue.defineComponent({
          inheritAttrs: false,
          render() {
            return vue.h("main", null, [
              vue.h("header", null, this.$slots.title?.()),
              vue.h("section", null, this.$slots.default?.()),
            ]);
          },
        })
      : vue.defineComponent({
          inheritAttrs: false,
          ssrRender(ctx: { $slots: import("vue").Slots }, push: Push, parent: unknown) {
            push("<main><header>");
            ctx.$slots.title?.({}, push, parent, "");
            push("</header><section>");
            ctx.$slots.default?.({}, push, parent, "");
            push("</section></main>");
          },
        });
  app.component("MainContent", host);
  app.component(
    "MainTitle",
    vue.defineComponent({
      render() {
        return vue.h("h1", null, this.$slots.default?.());
      },
    }),
  );
  app.component("TimelineMutes", {
    render() {
      return vue.h("p", null, "hydrated list");
    },
  });
  return server.renderToString(app);
}

void test("the complete original SSR render preserves production comments in both slot routes", async () => {
  assert.equal(vue.version, origin.officialVersion);
  const actual = compare("ssr", "development");
  const previous = read("Mutes.development.ssr.expected.ts.txt");
  for (const route of ["push", "vnode"] as const) {
    for (const hydrated of [false, true]) {
      const content = hydrated ? "<p>hydrated list</p>" : "<!---->";
      const expected = `<main><header><h1>nav.muted_users</h1></header><section>${content}</section></main>`;
      assert.equal(await renderOriginal(actual, route, hydrated), expected);
      const oldHtml = await renderOriginal(previous, route, hydrated);
      if (route === "vnode" && !hydrated) {
        assert.equal(oldHtml, expected.replace("<!---->", "<!--v-if-->"));
        assert.notEqual(
          oldHtml,
          expected,
          "the previous development oracle must fail the original false branch",
        );
      } else
        assert.equal(oldHtml, expected, "true branch and direct SSR push are unchanged controls");
    }
  }
});

// These synthetic JavaScript subprocess laws check evidence custody, not native
// compiler correctness. The original authored Vue/SSR laws above remain intact.
void test("optional same-child custody preserves reference output and records real fallback identities", () => {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "vize-inspector-child-")));
  const first = path.join(root, "first"),
    second = path.join(root, "second");
  mkdirSync(first);
  mkdirSync(second);
  function module(file: string, body: string) {
    const destination = path.join(second, "node_modules", file);
    mkdirSync(path.dirname(destination), { recursive: true });
    writeFileSync(destination, body);
  }
  module(
    "vue/package.json",
    JSON.stringify({
      name: "vue",
      version: "9.9.9",
      type: "module",
      exports: { "./compiler-sfc": "./compiler-sfc/index.mjs" },
    }),
  );
  const compiler = `export const version = "9.9.9";
export function parse() { return { descriptor: { scriptSetup: {lang: "ts"}, template: {content: "x"}, styles: [], slotted: true }, errors: [] }; }
export function compileScript() { return {content: "const value = 1", bindings: {}}; }
export function compileTemplate() { return {code: "render()", errors: [], tips: []}; }`;
  module("vue/compiler.mjs", compiler);
  module("vue/compiler-sfc/package.json", JSON.stringify({ main: "index.mjs" }));
  const wrapper =
    'export { version, parse, compileScript, compileTemplate } from "../compiler.mjs";\n';
  module("vue/compiler-sfc/index.mjs", wrapper);
  module(
    "prettier/package.json",
    JSON.stringify({
      name: "prettier",
      version: "8.8.8",
      type: "module",
      exports: {
        "./standalone": "./standalone.mjs",
        "./plugins/babel": "./babel.mjs",
        "./plugins/estree": "./estree.mjs",
        "./plugins/typescript": "./typescript.mjs",
      },
    }),
  );
  module(
    "prettier/standalone.mjs",
    'export function format(source) { if (source === "FAIL_FORMAT") throw new Error("synthetic format refusal"); return "pretty:" + source; }',
  );
  for (const parser of ["babel", "estree", "typescript"])
    module(`prettier/${parser}.mjs`, "export default {};\n");
  const input = JSON.stringify({
    target: "dom",
    moduleRoot: second,
    files: [{ path: "Original.vue", source: "<template/>", vizeCode: "FAIL_FORMAT" }],
  });
  function invoke(capture?: string) {
    const env = { ...process.env };
    delete env.VIZE_INSPECTOR_CAPTURE_DIR;
    if (capture) env.VIZE_INSPECTOR_CAPTURE_DIR = capture;
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", embedded], {
      cwd: first,
      env,
      input,
      encoding: "utf8",
      timeout: 30_000,
    });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    for (const file of report.files) delete file.official.timeMs;
    return report;
  }
  try {
    const plain = invoke(),
      directory = path.join(root, "captured");
    assert.deepEqual(invoke(directory), plain);
    assert.equal(readFileSync(path.join(directory, "input.json"), "utf8"), input);
    const receipt = JSON.parse(readFileSync(path.join(directory, "receipt.json"), "utf8"));
    const loaded = receipt.imports.find(
      (entry: any) => entry.specifier === "vue/compiler-sfc" && entry.image,
    );
    assert.equal(loaded.root, second);
    assert.equal(loaded.package.version, "9.9.9");
    assert.equal(loaded.moduleVersion, "9.9.9");
    assert.equal(loaded.manifests.length, 2);
    assert.equal(
      loaded.manifests[0].file,
      path.join(second, "node_modules/vue/compiler-sfc/package.json"),
    );
    assert.equal(
      loaded.image.physical,
      path.join(second, "node_modules/vue/compiler-sfc/index.mjs"),
    );
    assert.equal(loaded.image.sha256, createHash("sha256").update(wrapper).digest("hex"));
    assert.equal(readFileSync(path.join(directory, loaded.image.retainedBytes), "utf8"), wrapper);
    assert.ok(receipt.imports.some((entry: any) => entry.root === first && entry.error));
    assert.ok(
      receipt.formatEvents.some(
        (entry: any) =>
          entry.role === "vize" &&
          entry.status === "raw-fallback" &&
          entry.error === "synthetic format refusal",
      ),
    );
    assert.equal(receipt.node.physical, realpathSync(process.execPath));
    assert.equal(receipt.nodeEnv, "production");
    rmSync(path.join(second, "node_modules/prettier"), { recursive: true });
    const missing = path.join(root, "missing-formatter");
    const without = invoke(missing);
    assert.deepEqual(without, invoke());
    assert.equal(without.files[0].official.formattedCode, "const value = 1");
    assert.equal(without.files[0].vizeFormattedCode, "FAIL_FORMAT");
    const fallback = JSON.parse(readFileSync(path.join(missing, "receipt.json"), "utf8"));
    assert.ok(
      fallback.formatEvents.every((entry: any) => entry.status === "formatter-unavailable"),
    );
    assert.ok(
      fallback.imports.some(
        (entry: any) =>
          entry.specifier === "prettier/standalone" && entry.root === null && entry.error,
      ),
    );
    module(
      "prettier/package.json",
      JSON.stringify({
        name: "prettier",
        version: "8.8.8",
        type: "module",
        exports: {
          "./standalone": "./absent.mjs",
          "./plugins/babel": "./delayed.mjs",
          "./plugins/estree": "./absent.mjs",
          "./plugins/typescript": "./absent.mjs",
        },
      }),
    );
    module(
      "prettier/delayed.mjs",
      "await new Promise(resolve => setTimeout(resolve, 150)); export default {};\n",
    );
    const pendingDirectory = path.join(root, "pending-formatter");
    invoke(pendingDirectory);
    const pending = JSON.parse(readFileSync(path.join(pendingDirectory, "receipt.json"), "utf8"));
    assert.ok(
      pending.pendingImports.some(
        (entry: any) => entry.specifier === "prettier/plugins/babel" && entry.root === second,
      ),
    );
    assert.ok(
      pending.imports.some(
        (entry: any) => entry.specifier === "prettier/plugins/babel" && entry.status === "pending",
      ),
    );
    rmSync(path.join(second, "node_modules/vue"), { recursive: true });
    const fatalDirectory = path.join(root, "missing-compiler");
    const fatal = spawnSync(process.execPath, ["--input-type=module", "-e", embedded], {
      cwd: first,
      env: { ...process.env, VIZE_INSPECTOR_CAPTURE_DIR: fatalDirectory },
      input,
      encoding: "utf8",
      timeout: 30_000,
    });
    assert.equal(fatal.status, 1);
    assert.equal(fatal.stdout, "");
    assert.match(fatal.stderr, /Cannot find package 'vue'/);
    const refused = JSON.parse(readFileSync(path.join(fatalDirectory, "receipt.json"), "utf8"));
    assert.equal(refused.imports.length, 3);
    assert.ok(refused.imports.every((entry: any) => entry.error));
    assert.equal(readFileSync(path.join(fatalDirectory, "input.json"), "utf8"), input);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

void test("Inspector packets survive malformed, failed and signalled children before every original assertion", async () => {
  const readPacket = (file: string) => JSON.parse(readFileSync(file, "utf8"));
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "vize-inspector-parent-")));
  const executable = path.join(root, "synthetic-inspector");
  writeFileSync(
    executable,
    `#!${process.execPath}\nconst {writeSync}=require("node:fs");
const mode=process.env.VIZE_INSPECT_TEST_MODE;
if(mode==="malformed") { writeSync(1,"not JSON"); }
else if(mode==="invalid-utf8") { writeSync(1,Buffer.from([255,254])); }
else if(mode==="exit") { writeSync(1,"partial JSON"); writeSync(2,"original failure"); process.exit(7); }
else if(mode==="signal") { writeSync(1,"before signal"); process.kill(process.pid,"SIGTERM"); }
else { process.stdout.write(JSON.stringify({schema:"vize.inspector.compare",target:process.argv[process.argv.indexOf("--target")+1],summary:{fileCount:1,officialErrors:0,vizeErrors:0,changedFiles:0,additions:0,removals:0},files:[]})); }\n`,
  );
  chmodSync(executable, 0o700);
  const keys = [
    "VIZE_BIN",
    "VIZE_APP_CHECK_CAPTURE_DIR",
    "VIZE_INSPECT_OUTPUT_DIR",
    "VIZE_INSPECTOR_NODE",
    "VIZE_INSPECT_TEST_MODE",
    "VIZE_INSPECTOR_COLLECT_ALL_TARGETS",
  ];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  delete process.env.VIZE_INSPECTOR_COLLECT_ALL_TARGETS;
  process.env.VIZE_BIN = executable;
  process.env.VIZE_APP_CHECK_CAPTURE_DIR = path.join(root, "capture");
  process.env.VIZE_INSPECT_OUTPUT_DIR = path.join(root, "explicit-report");
  process.env.VIZE_INSPECTOR_NODE = process.execPath;
  try {
    const { assertInspectorCompareBudgets, inspectorReportDirectory } =
      await import("../_helpers/inspector-parity.ts");
    const { rekaUiApp } = await import("../_helpers/apps.ts");
    assert.equal(inspectorReportDirectory("application", "explicit"), "explicit");
    const budget = {
      target: "dom" as const,
      officialErrors: 0,
      vizeErrors: 0,
      changedFiles: 0,
      additions: 0,
      removals: 0,
    };
    function app(name: string) {
      return { ...rekaUiApp, name, check: { cwd: root, patterns: ["*.vue"] } };
    }
    for (const mode of ["malformed", "invalid-utf8", "exit", "signal"]) {
      process.env.VIZE_INSPECT_TEST_MODE = mode;
      assert.throws(() => assertInspectorCompareBudgets(app(mode), [budget]));
      const directory = path.join(root, "capture/inspector", mode);
      const [entry] = readdirSync(directory);
      const invocation = path.join(directory, entry);
      const packet = readPacket(path.join(invocation, "process.json"));
      assert.equal(packet.cwd, root);
      assert.equal(packet.command, executable);
      assert.deepEqual(packet.args, [
        "inspector",
        "*.vue",
        "--format",
        "compare",
        "--target",
        "dom",
        "--template-syntax",
        "quirks",
      ]);
      assert.deepEqual(packet.afterImage, packet.beforeImage);
      assert.equal(
        packet.beforeImage.sha256,
        createHash("sha256").update(readFileSync(executable)).digest("hex"),
      );
      assert.equal(packet.officialNodeOverride, process.execPath);
      const stdout = readFileSync(path.join(invocation, "stdout.txt"));
      if (mode === "invalid-utf8") assert.deepEqual(stdout, Buffer.from([255, 254]));
      else
        assert.equal(
          stdout.toString("utf8"),
          mode === "malformed" ? "not JSON" : mode === "exit" ? "partial JSON" : "before signal",
        );
      if (mode === "exit") {
        assert.equal(packet.status, 7);
        assert.equal(readFileSync(path.join(invocation, "stderr.txt"), "utf8"), "original failure");
      }
      if (mode === "signal") assert.equal(packet.signal, "SIGTERM");
    }
    process.env.VIZE_INSPECT_TEST_MODE = "budget";
    const wrongCount = { ...budget, officialErrors: 1 };
    const refused = [wrongCount, { ...wrongCount, target: "ssr" as const }];
    assert.throws(() => assertInspectorCompareBudgets(app("budget"), refused), /official errors/);
    assert.equal(readdirSync(path.join(root, "capture/inspector/budget")).length, 1);
    assert.equal(readPacket(path.join(root, "explicit-report/dom.json")).summary.officialErrors, 0);
    delete process.env.VIZE_INSPECT_OUTPUT_DIR;
    for (const mode of ["invalid", "1"]) {
      process.env.VIZE_INSPECTOR_COLLECT_ALL_TARGETS = mode;
      if (mode === "1") delete process.env.VIZE_APP_CHECK_CAPTURE_DIR;
      const reason = mode === "1" ? /requires capture/ : /invalid Inspector/;
      assert.throws(() => assertInspectorCompareBudgets(app(mode), refused), reason);
    }
    process.env.VIZE_APP_CHECK_CAPTURE_DIR = path.join(root, "capture");
    assert.throws(
      () => assertInspectorCompareBudgets(app("collected"), refused),
      (error) =>
        error instanceof AggregateError &&
        error.errors.length === 2 &&
        error.errors.every((entry) => /official errors/.test(entry.message)),
    );
    const collected = path.join(root, "capture/inspector/collected");
    for (const target of ["dom", "ssr"])
      assert.equal(readPacket(path.join(collected, `${target}.json`)).target, target);
    delete process.env.VIZE_INSPECTOR_COLLECT_ALL_TARGETS;
    for (const name of ["first-app", "second-app"]) {
      assertInspectorCompareBudgets(app(name), [budget, { ...budget, target: "ssr" }]);
      for (const target of ["dom", "ssr"]) {
        const report = readPacket(path.join(root, "capture/inspector", name, `${target}.json`));
        assert.equal(report.target, target);
      }
    }
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
    rmSync(root, { recursive: true, force: true });
  }
});
