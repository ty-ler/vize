/** Whole inputs and authored output oracles for the installed #8371 workspace cell. */
export const CONFIG_PACKAGE_NAMES = ["app", "control"] as const;

export const CONFIG_SOURCES = {
  "BuildPanel.vue":
    "<template>\n  <div>\n    <p>  two  spaces  </p>\n    <my-widget />\n  </div>\n</template>\n",
  "ImagePanel.vue": '<template>\n  <img src="fixture.png" />\n</template>\n',
  "QuotesPanel.vue":
    '<script setup>const message="hello";</script>\n<template><p>{{ message }}</p></template>\n',
  "TypedPanel.vue":
    '<script setup lang="ts">\nconst value: string = null;\n</script>\n<template><p>{{ value }}</p></template>\n',
};

export const SINGLE_FORMATTED =
  "<script setup>\nconst message = 'hello';\n</script>\n\n<template><p>{{ message }}</p></template>\n";
export const DOUBLE_FORMATTED =
  '<script setup>\nconst message = "hello";\n</script>\n\n<template>\n  <p>{{ message }}</p>\n</template>\n';

// Complete historical compiler outputs for the identical BuildPanel source,
// retained from project_config_cli__project_settings_build_{vite,defaults}.snap.
export const PRESERVED_BUILD = `import { createElementVNode as _createElementVNode, openBlock as _openBlock, createElementBlock as _createElementBlock, createTextVNode as _createTextVNode } from "vue"

export function render(_ctx, _cache) {
  return (_openBlock(), _createElementBlock("div", null, [
    _createElementVNode("p", null, "  two  spaces  "),
    _createTextVNode(),
    _createElementVNode("my-widget")
  ]))
}
`;
export const DEFAULT_BUILD = `import { resolveComponent as _resolveComponent, createElementVNode as _createElementVNode, createVNode as _createVNode, openBlock as _openBlock, createElementBlock as _createElementBlock } from "vue"

export function render(_ctx, _cache) {
  const _component_my_widget = _resolveComponent("my-widget")
  
  return (_openBlock(), _createElementBlock("div", null, [
    _createElementVNode("p", null, " two spaces "),
    _createVNode(_component_my_widget)
  ]))
}
`;

export function vueHelper(configured: boolean): string {
  return `export default ${JSON.stringify({
    compiler: {
      whitespace: configured ? "preserve" : "condense",
      customElements: configured ? ["my-widget"] : [],
    },
    formatter: { singleQuote: configured },
    linter: {
      preset: "essential",
      rules: {
        "vue/multi-word-component-names": "off",
        "a11y/alt-text": configured ? "error" : "off",
      },
    },
    languageServer: { typecheck: true, lint: false, formatting: true },
  })};\n`;
}

export function tsconfigBase(strictNullChecks: boolean): string {
  return `${JSON.stringify({ compilerOptions: { strictNullChecks } }, null, 2)}\n`;
}

export const CANONICAL_VITE = [
  'import { defineConfig } from "vite";',
  'import vize from "@vizejs/vite-plugin";',
  'import vue from "./vue-settings";',
  "export default defineConfig({ plugins: [vize()], vue });",
  "",
].join("\n");

export function typeDiagnostics(broken: boolean) {
  return broken
    ? [
        {
          range: { start: { line: 1, character: 6 }, end: { line: 1, character: 11 } },
          severity: 1,
          code: 2322,
          source: "vize/types",
          message: "Type 'null' is not assignable to type 'string'.",
        },
      ]
    : [];
}

export function lintReport(file: string, configured: boolean) {
  return [
    {
      file,
      messages: configured
        ? [
            {
              ruleId: "a11y/alt-text",
              ruleDocsPath: "docs/content/rules/accessibility.md",
              severity: 2,
              message: "[vize:a11y/alt-text] <img> elements must have an alt attribute",
              help: 'Add an alt attribute: <img alt="Description"> or <img alt=""> for decorative images',
              line: 2,
              column: 3,
              endLine: 2,
              endColumn: 28,
            },
          ]
        : [],
      errorCount: configured ? 1 : 0,
      warningCount: 0,
    },
  ];
}
