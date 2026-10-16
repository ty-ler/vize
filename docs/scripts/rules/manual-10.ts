import type { RuleExample } from "./types.ts";
// Authored examples retained from the previous category reference.
export const manual10: Record<string, RuleExample> = {
  "vue/no-deprecated-v-on-number-modifiers": {
    bad: {
      language: "vue",
      source:
        '<template>\n<input @keyup.13="submit" />\n<input v-on:keyup.27="cancel" />\n<input @keyup.13.stop="submit" />\n</template>',
    },
    good: {
      language: "vue",
      source:
        '<template>\n<input @keyup.enter="submit" />\n<input @keyup.esc="cancel" />\n</template>',
    },
    note: 'The first decimal-prefix numeric modifier determines the finding. `@keyup.13.27="submit"` reports only `13` and offers `@keyup.enter.27="submit"`; another fix pass can replace `27` with `escape`. `@keyup.13suffix="submit"` also becomes `@keyup.enter="submit"`. Values 0–9 are exempt, so `@keyup.0.13="submit"` is clean under this rule. Unknown values such as `999` report without a fix. The existing Vue 2 and petite-vue exemption remains in effect.',
    noteJa:
      '最初の10進整数で始まる修飾子が診断の対象になります。`@keyup.13.27="submit"` は `13` だけを指摘し、`@keyup.enter.27="submit"` への修正を提示します。次の修正で `27` を `escape` にできます。`@keyup.13suffix="submit"` も `@keyup.enter="submit"` になります。0〜9 は対象外なので、`@keyup.0.13="submit"` はこのルールでは指摘しません。`999` など対応するキー名がない値には修正を提示しません。Vue 2 と petite-vue は引き続き対象外です。',
    evidence: "crates/vize_patina/src/rules/vue/no_deprecated_v_on_number_modifiers.rs",
  },

  "vue/valid-v-if": {
    bad: {
      language: "vue",
      source:
        '<template>\n  <div v-if></div>\n  <div v-if=""></div>\n  <div v-if="ready" v-else></div>\n</template>',
    },
    good: {
      language: "vue",
      source: '<template>\n  <div v-if="ready"></div>\n  <div v-if="count > 0"></div>\n</template>',
    },
    evidence: "docs/content/rules/vue-directive-validity.md",
  },
  "vue/valid-v-memo": {
    bad: {
      language: "vue",
      source: "<template>\n  <div v-memo></div>\n</template>",
    },
    good: {
      language: "vue",
      source: '<template>\n  <div v-memo="[valueA, valueB]">{{ label }}</div>\n</template>',
    },
    evidence: "docs/content/rules/vue-directive-validity.md",
  },
  "vue/valid-v-model": {
    bad: {
      language: "vue",
      source: '<template>\n  <div v-model="value"></div>\n  <input v-model />\n</template>',
    },
    good: {
      language: "vue",
      source:
        '<template>\n  <input v-model="value" />\n  <select v-model="selected"></select>\n  <textarea v-model="text"></textarea>\n  <MyInput v-model="value" />\n</template>',
    },
    evidence: "docs/content/rules/vue-directive-validity.md",
  },
  "vue/valid-v-on": {
    bad: {
      language: "vue",
      source:
        '<template>\n  <div v-on></div>\n  <div @></div>\n  <div @click></div>\n  <div @click.sync="handleClick"></div>\n  <div @click.nativeish="handleClick"></div>\n  <div @click.once></div>\n</template>',
    },
    good: {
      language: "vue",
      source:
        '<template>\n  <div @click="handleClick"></div>\n  <form @submit.prevent></form>\n  <input @keyup.page-down="handlePageDown" />\n  <input @keyup.あ="handleKey" />\n  <div v-on="{ click: handleClick }"></div>\n</template>',
    },
    ruleOptions: { modifiers: ["custom"] },
    note: 'Unsupported modifiers are reported individually at their names, including on long-form `v-on:click`, dynamic arguments and object listener syntax. Accepted names match `eslint-plugin-vue` 10.9.2: Vue\'s built-in modifiers, the complete keyboard alias table, any single Unicode code point, and names with a finite decimal integer prefix (`Number.parseInt(name, 10)` semantics). For example, `.13suffix` is accepted. Numeric-key deprecation and `.native` migration belong to separate rules.\n\nOnly `.stop` and `.prevent` allow an omitted handler. `.once`, `.enter` and configured custom names still need a handler. Add custom names under `vue.linter.ruleOptions`:\n\n```ts\nimport { defineConfig } from "@vizejs/vite-plugin/vite-plus";\n\nexport default defineConfig({}).withVue({\n  linter: {\n    rules: { "vue/valid-v-on": "error" },\n    ruleOptions: { "vue/valid-v-on": { modifiers: ["custom"] } },\n  },\n});\n```\n\nThis permits `@click.custom="handler"`. Names are exact and case-sensitive; options supplement the built-in names and do not enable a disabled rule. Scoped entries can replace inherited names or reset them with `[]`.\n\nThe keyboard table is adapted from the MIT-licensed [eslint-plugin-vue keyboard aliases](https://github.com/vuejs/eslint-plugin-vue/blob/v10.9.2/lib/utils/key-aliases.json); its source and license are preserved alongside the implementation.',
    noteJa:
      '未対応の修飾子は名前ごとに指摘します。長い形式の `v-on:click`、動的な引数、オブジェクト形式も対象です。対応する名前は `eslint-plugin-vue` 10.9.2 と同じで、Vue 標準の修飾子、キーボードの別名、Unicode の1コードポイント、有限の10進整数で始まる名前（`Number.parseInt(name, 10)` と同じ解釈）です。たとえば `.13suffix` はこのルールでは有効です。数値キーの非推奨と `.native` の移行は別のルールで検査します。\n\nハンドラーを省略できるのは `.stop` と `.prevent` だけです。`.once`、`.enter`、独自の名前にはハンドラーが必要です。独自の修飾子は `vue.linter.ruleOptions` に追加します。\n\n```ts\nimport { defineConfig } from "@vizejs/vite-plugin/vite-plus";\n\nexport default defineConfig({}).withVue({\n  linter: {\n    rules: { "vue/valid-v-on": "error" },\n    ruleOptions: { "vue/valid-v-on": { modifiers: ["custom"] } },\n  },\n});\n```\n\nこの設定では `@click.custom="handler"` が有効になります。名前は大文字と小文字を区別し、標準の一覧に追加します。オプションだけでは無効なルールは有効になりません。スコープ別の設定で一覧を置き換えたり、`[]` にリセットしたりできます。\n\nキーボードの一覧は MIT ライセンスの [eslint-plugin-vue keyboard aliases](https://github.com/vuejs/eslint-plugin-vue/blob/v10.9.2/lib/utils/key-aliases.json) に基づき、元のソースとライセンスを実装に同梱しています。',
    evidence: "docs/content/rules/vue-directive-validity.md",
  },
  "vue/valid-v-show": {
    bad: {
      language: "vue",
      source:
        '<template>\n  <div v-show></div>\n  <template v-show="ready"><div></div></template>\n</template>',
    },
    good: {
      language: "vue",
      source:
        '<template>\n  <div v-show="ready"></div>\n  <div v-show="count > 0"></div>\n</template>',
    },
    evidence: "docs/content/rules/vue-directive-validity.md",
  },
  "vue/valid-v-slot": {
    bad: {
      language: "vue",
      source:
        "<template>\n  <div v-slot:header></div>\n  <MyComponent v-slot v-slot:header />\n  <template v-slot:header v-slot:footer />\n</template>",
    },
    good: {
      language: "vue",
      source:
        '<template>\n  <MyComponent v-slot="{ item }">{{ item }}</MyComponent>\n  <MyComponent>\n    <template #header>Header</template>\n  </MyComponent>\n</template>',
    },
    evidence: "docs/content/rules/vue-directive-validity.md",
  },
  "vue/warn-custom-block": {
    bad: {
      language: "vue",
      source:
        '<i18n>\n{ "en": { "hello": "Hello" } }\n</i18n>\n\n<template>\n  <p>{{ hello }}</p>\n</template>',
    },
    good: {
      language: "vue",
      source:
        '<template>\n  <p>{{ hello }}</p>\n</template>\n\n<script setup lang="ts">\nconst hello = "Hello";\n</script>',
    },
    evidence: "docs/content/rules/vue-sfc.md",
  },
  "vue/warn-custom-directive": {
    bad: {
      language: "vue",
      source:
        '<template>\n  <input v-focus />\n  <input v-mask="\'###-####\'" />\n  <div v-click-outside="handleClose"></div>\n</template>',
    },
    good: {
      language: "vue",
      source:
        '<template>\n  <div v-if="ready"></div>\n  <input v-model="value" />\n  <button type="button" @click="onClick">Save</button>\n</template>',
    },
    evidence: "docs/content/rules/vue-directives.md",
  },
};
