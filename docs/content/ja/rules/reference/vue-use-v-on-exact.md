---
title: "vue/use-v-on-exact"
---

# `vue/use-v-on-exact`

修飾子付きのイベント操作と競合するハンドラーに .exact を指定します。

[悪い例](#悪い) · [良い例](#良い)

既定の重大度: `warning`  
プリセット: `essential`, `happy-path`, `nuxt`, `ecosystem`, `opinionated`  
自動修正: なし。修正内容を確認してください  
適用範囲: Vue SFC のテンプレートと各ブロック。ルールに必要な script の文脈も例に含めています。  
オプション: ルール固有のオプションはありません。重大度とプリセットは設定できます。

## ハンドラーが重なる場合

ネイティブ要素の同じイベントに対するリスナーを比較します。カスタムコンポーネントのイベントは、両方のリスナーが `.native` を使う場合だけ検査します。イベント名が違う場合や、キーの条件が重ならない場合は競合しません。

システム修飾子は押されている必要があるキーを指定するため、`@keydown.alt.shift` は Ctrl+Alt+Shift にも反応します。別のハンドラーが `@keydown.alt.ctrl.shift` を使う場合は、条件の広い方に `.exact` を追加して処理を分けます。`.exact` は指定したシステム修飾子だけを許可し、追加の Ctrl・Shift・Alt・Meta キーを拒否します。

複数のキー修飾子はいずれかのキーに対応します。`@keydown.up.down` は上下どちらの矢印キーにも反応するため、Ctrl+ArrowDown では `@keydown.ctrl.down` と重なります。診断範囲は `.exact` が必要なディレクティブのキーで、ハンドラー式は含みません。

## 設定（Vite+）

```ts
import { defineConfig } from "@vizejs/vite-plugin/vite-plus";

export default defineConfig({
  lint: {
    vize: {
      "preset": "incremental",
      "rules": {
        "vue/use-v-on-exact": "warn"
      }
    },
  },
});
```

```sh
vp run lint
```

## 悪い

通常の click ハンドラーも Ctrl キーを押しながらのクリックで動くため、別の `.ctrl` ハンドラーと重複します。

```vue
<template>
  <button type="button" @click="handleClick" @click.ctrl="handleCtrlClick">
    Save
  </button>
</template>
```

## 良い

`.exact` で通常のハンドラーを修飾キーのない click に限定し、Ctrl 専用のハンドラーと分けます。

```vue
<template>
  <button
    type="button"
    @click.exact="handleClick"
    @click.ctrl="handleCtrlClick"
  >
    Save
  </button>
</template>
```

良い例は上記の設定でこのルールの診断が出ない例です。他のルールの診断は出る場合があります。

[実装](https://github.com/ubugeeei-prod/vize/blob/main/crates/vize_patina/src/rules/opinionated/vue/use_v_on_exact.rs#L31) · [全ルール](../all.md)
