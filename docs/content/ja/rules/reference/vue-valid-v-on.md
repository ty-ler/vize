---
title: "vue/valid-v-on"
---

# `vue/valid-v-on`

v-on のイベント名・式・修飾子を検査します。

[悪い例](#悪い) · [良い例](#良い)

既定の重大度: `error`  
プリセット: `essential`, `happy-path`, `nuxt`, `ecosystem`, `opinionated`  
自動修正: なし。修正内容を確認してください  
適用範囲: Vue SFC のテンプレートと各ブロック。ルールに必要な script の文脈も例に含めています。  
オプション: [型付きオプションと既定値](../options.md)を参照してください。

未対応の修飾子は名前ごとに指摘します。長い形式の `v-on:click`、動的な引数、オブジェクト形式も対象です。対応する名前は `eslint-plugin-vue` 10.9.2 と同じで、Vue 標準の修飾子、キーボードの別名、Unicode の1コードポイント、有限の10進整数で始まる名前（`Number.parseInt(name, 10)` と同じ解釈）です。たとえば `.13suffix` はこのルールでは有効です。数値キーの非推奨と `.native` の移行は別のルールで検査します。

ハンドラーを省略できるのは `.stop` と `.prevent` だけです。`.once`、`.enter`、独自の名前にはハンドラーが必要です。独自の修飾子は `vue.linter.ruleOptions` に追加します。

```ts
import { defineConfig } from "@vizejs/vite-plugin/vite-plus";

export default defineConfig({}).withVue({
  linter: {
    rules: { "vue/valid-v-on": "error" },
    ruleOptions: { "vue/valid-v-on": { modifiers: ["custom"] } },
  },
});
```

この設定では `@click.custom="handler"` が有効になります。名前は大文字と小文字を区別し、標準の一覧に追加します。オプションだけでは無効なルールは有効になりません。スコープ別の設定で一覧を置き換えたり、`[]` にリセットしたりできます。

キーボードの一覧は MIT ライセンスの [eslint-plugin-vue keyboard aliases](https://github.com/vuejs/eslint-plugin-vue/blob/v10.9.2/lib/utils/key-aliases.json) に基づき、元のソースとライセンスを実装に同梱しています。

## 設定（Vite+）

```ts
import { defineConfig } from "@vizejs/vite-plugin/vite-plus";

export default defineConfig({
  vue: {
    linter: {
      "preset": "incremental",
      "rules": {
        "vue/valid-v-on": "error"
      },
      "ruleOptions": {
        "vue/valid-v-on": {
          "modifiers": [
            "custom"
          ]
        }
      }
    },
  },
});
```

```sh
vp run lint
```

## 悪い

イベント引数または必要なハンドラー・オブジェクト式がありません。

```vue
<template>
  <div v-on></div>
  <div @></div>
  <div @click></div>
  <div @click.sync="handleClick"></div>
  <div @click.nativeish="handleClick"></div>
  <div @click.once></div>
</template>
```

## 良い

イベントとハンドラーを指定するか、引数なしの `v-on` にリスナーのオブジェクトを渡します。

```vue
<template>
  <div @click="handleClick"></div>
  <form @submit.prevent></form>
  <input @keyup.page-down="handlePageDown" />
  <input @keyup.あ="handleKey" />
  <div v-on="{ click: handleClick }"></div>
</template>
```

良い例は上記の設定でこのルールの診断が出ない例です。他のルールの診断は出る場合があります。

[実装](https://github.com/ubugeeei-prod/vize/blob/main/crates/vize_patina/src/rules/vue/valid_v_on.rs#L30) · [全ルール](../all.md)
