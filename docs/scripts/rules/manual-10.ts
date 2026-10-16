import type { RuleExample } from "./types.ts";
// Authored examples retained from the previous category reference.
export const manual10: Record<string, RuleExample> = {
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
    evidence: "docs/content/rules/vue-directive-validity.md",
    ruleOptions: { modifiers: ["custom"] },
    note: [
      "## Modifier validation",
      "",
      "Unsupported modifiers are reported individually at their names, including on long-form, dynamic and object listeners. Accepted names follow `eslint-plugin-vue` 10.9.2: Vue event modifiers, keyboard aliases, single Unicode code points, and finite decimal integer prefixes (`Number.parseInt(name, 10)`). Thus `.13suffix` is accepted; numeric-key and `.native` migrations use separate rules. Only `.stop` and `.prevent` work without handlers; `.once`, `.enter`, and custom names require one.",
      "",
      '`modifiers` adds exact, case-sensitive names without enabling the rule. The Vite+ configuration below accepts `@click.custom="handler"`; standalone config uses `linter.ruleOptions`. Scoped entries replace the list; `[]` resets it. The keyboard table comes from the MIT-licensed [eslint-plugin-vue aliases](https://github.com/vuejs/eslint-plugin-vue/blob/v10.9.2/lib/utils/key-aliases.json); source and license are retained beside the implementation.',
    ].join("\n"),
    noteJa: [
      "## 修飾子の検証",
      "",
      "未対応の修飾子は、その名前の位置で個別に報告します。長い形式・動的引数・オブジェクト形式のリスナーも対象です。`eslint-plugin-vue` 10.9.2 と同じく、Vue のイベント修飾子、キーの別名、単一の Unicode コードポイント、十進整数として有限の値を読み取れる接頭辞（`Number.parseInt(name, 10)`）を許可します。そのため `.13suffix` も有効です。数値キーと `.native` の移行は別のルールで検査します。ハンドラーなしで動作するのは `.stop` と `.prevent` だけで、`.once`・`.enter`・独自の名前には式が必要です。",
      "",
      '`modifiers` は大文字と小文字を区別する完全一致の名前を追加します。ルールは別に有効にしてください。以下の Vite+ 設定は `@click.custom="handler"` を許可します。単独の設定では `linter.ruleOptions` を使います。スコープ付きの設定はリストを置き換え、`[]` でリセットできます。キーの表は MIT ライセンスの [eslint-plugin-vue の別名一覧](https://github.com/vuejs/eslint-plugin-vue/blob/v10.9.2/lib/utils/key-aliases.json)に由来し、実装とともに元のソースとライセンスを保持しています。',
    ].join("\n"),
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
