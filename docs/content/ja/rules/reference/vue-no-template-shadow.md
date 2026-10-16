---
title: "vue/no-template-shadow"
---

# `vue/no-template-shadow`

テンプレート変数が外側の名前を隠す箇所を検出します。

[悪い例](#悪い) · [良い例](#良い)

既定の重大度: `warning`  
プリセット: `happy-path`, `nuxt`, `ecosystem`, `opinionated`  
自動修正: なし。修正内容を確認してください  
適用範囲: Vue SFC のテンプレートと各ブロック。ルールに必要な script の文脈も例に含めています。  
オプション: ルール固有のオプションはありません。重大度とプリセットは設定できます。

テンプレート内の `v-for`、`v-slot`（`#name` を含む）、旧形式のスコープ付きスロットの変数を比較します。先行する変数を隠す識別子を報告し、同じ要素の宣言も属性順に検査します。兄弟要素のスコープは独立しています。プロパティのキーや既定値内の参照は宣言ではなく、`v-pre` の配下は検査しません。

現在の検査は script やコンポーネントのプロパティ名を対象にしません。script の変数と同名という理由だけで単独のテンプレート変数を警告することはありません。診断範囲は、エスケープ表記や HTML エンティティを含む、実際に記述された識別子を示します。

## 設定（Vite+）

```ts
import { defineConfig } from "@vizejs/vite-plugin/vite-plus";

export default defineConfig({
  lint: {
    vize: {
      "preset": "incremental",
      "rules": {
        "vue/no-template-shadow": "warn"
      }
    },
  },
});
```

```sh
vp run lint
```

## 悪い

内側の v-for でも item を宣言し、外側の item を隠しています。

```vue
<template>
<div v-for="item in items" :key="item.id"><span v-for="item in item.children" :key="item.id">{{ item.name }}</span></div>
</template>
```

## 良い

内側は child に変更し、外側の item と内側の child を分けます。

```vue
<template>
<div v-for="item in items" :key="item.id"><span v-for="child in item.children" :key="child.id">{{ child.name }}</span></div>
</template>
```

良い例は上記の設定でこのルールの診断が出ない例です。他のルールの診断は出る場合があります。

[実装](https://github.com/ubugeeei-prod/vize/blob/main/crates/vize_patina/src/rules/opinionated/vue/no_template_shadow.rs#L34) · [全ルール](../all.md)
