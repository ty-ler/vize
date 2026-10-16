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

## 修飾子の検証

未対応の修飾子は、その名前の位置で個別に報告します。長い形式・動的引数・オブジェクト形式のリスナーも対象です。`eslint-plugin-vue` 10.9.2 と同じく、Vue のイベント修飾子、キーの別名、単一の Unicode コードポイント、十進整数として有限の値を読み取れる接頭辞（`Number.parseInt(name, 10)`）を許可します。そのため `.13suffix` も有効です。数値キーと `.native` の移行は別のルールで検査します。ハンドラーなしで動作するのは `.stop` と `.prevent` だけで、`.once`・`.enter`・独自の名前には式が必要です。

`modifiers` は大文字と小文字を区別する完全一致の名前を追加します。ルールは別に有効にしてください。以下の Vite+ 設定は `@click.custom="handler"` を許可します。単独の設定では `linter.ruleOptions` を使います。スコープ付きの設定はリストを置き換え、`[]` でリセットできます。キーの表は MIT ライセンスの [eslint-plugin-vue の別名一覧](https://github.com/vuejs/eslint-plugin-vue/blob/v10.9.2/lib/utils/key-aliases.json)に由来し、実装とともに元のソースとライセンスを保持しています。

## 設定（Vite+）

```ts
import { defineConfig } from "@vizejs/vite-plugin/vite-plus";

export default defineConfig({
  lint: {
    vize: {
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

必要なイベントや式がないか、.sync や .nativeish など未対応の修飾子を使っています。

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

ハンドラー、式を省略できる動作修飾子、対応するキー修飾子、または引数なしの `v-on` に渡すリスナーのオブジェクトを使います。

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
