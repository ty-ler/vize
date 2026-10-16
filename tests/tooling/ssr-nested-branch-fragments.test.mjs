import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { compileFunction } from "node:vm";

const capture = process.env.VIZE_NESTED_BRANCH_CAPTURE;

await test(
  "nested conditional SSR fragments keep parent attributes on the actual root",
  { skip: !capture && "source-built SSR modules execute in the scoped SSR action" },
  async () => {
    const fromTests = createRequire(new URL("../package.json", import.meta.url));
    const vue = fromTests("vue");
    const fromVue = createRequire(fromTests.resolve("vue/package.json"));
    const server = fromVue("@vue/server-renderer");
    const compiler = fromVue("@vue/compiler-sfc");
    assert.equal(vue.version, "3.6.0-beta.10");
    assert.equal(compiler.version, vue.version);
    const modules = JSON.parse(readFileSync(capture, "utf8"));
    assert.equal(modules.length, 10);

    function load(preamble, body) {
      const imports = preamble.replace(
        /import \{([^}]+)\} from ["']([^"']+)["'];?/g,
        (_, bindings, name) => {
          assert.ok(["vue", "@vue/server-renderer", "vue/server-renderer"].includes(name));
          return `const {${bindings.replaceAll(/\bas\b/g, ":")}} = require(${JSON.stringify(name)});`;
        },
      );
      return compileFunction(
        `${imports}\n${body.replace("export function ssrRender", "function ssrRender")}\nreturn ssrRender;`,
        ["require"],
      )((name) => (name === "vue" ? vue : server));
    }

    async function render(renderFunction, outer, inner) {
      const app = vue.createSSRApp(
        { props: ["outer", "inner"], ssrRender: renderFunction },
        { outer, inner, "data-owner": "parent" },
      );
      return server.renderToString(app);
    }

    const observations = [];
    for (const entry of modules) {
      assert.equal(entry.lane, "s4");
      assert.deepEqual(entry.selected, entry.legacy);
      const reference = compiler.compileTemplate({
        source: entry.source,
        filename: "NestedBranch.vue",
        id: "nested-branch",
        ssr: true,
        ssrCssVars: [],
        isProd: true,
      });
      assert.deepEqual(reference.errors, []);
      // Official template code contains its own import declarations.
      const official = load(
        reference.code.match(/^import[^\n]+/gm)?.join("\n") ?? "",
        reference.code.replace(/^import[^\n]+\n/gm, ""),
      );
      for (const outer of [false, true]) {
        for (const inner of [false, true]) {
          const officialHtml = await render(official, outer, inner);
          const lanes = {};
          for (const lane of ["selected", "legacy"]) {
            const output = entry[lane];
            const html = await render(load(output.preamble, output.code), outer, inner);
            assert.equal(html, officialHtml, `${entry.name}: ${lane}, vapor=${entry.vapor}`);
            const fragment = entry.name === "nested-root" ? outer : !outer;
            if (entry.name.startsWith("nested-") && fragment) {
              assert.equal(html, `<!--[--><button>${inner ? "a" : "b"}</button><!--]-->`);
            }
            if (entry.name === "single-template-root" && outer) {
              assert.equal(html, '<button data-owner="parent">b</button>');
            }
            if (entry.name === "plain-root-chain") assert.ok(html.includes('data-owner="parent"'));
            if (entry.name === "loop-owns-fragment" && outer) {
              assert.equal(html, "<!--[--><button>1</button><button>2</button><!--]-->");
            }
            lanes[lane] = html;
          }
          observations.push({
            name: entry.name,
            vapor: entry.vapor,
            outer,
            inner,
            officialHtml,
            lanes,
          });
        }
      }
    }
    const destination = process.env.VIZE_NESTED_BRANCH_RUNTIME_CAPTURE;
    assert.ok(destination, "retain complete actual runtime outcomes");
    writeFileSync(
      destination,
      JSON.stringify({ vueVersion: vue.version, compilerVersion: compiler.version, observations }),
    );
  },
);
