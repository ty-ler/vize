---
title: "script/no-deprecated-model-definition"
---

# `script/no-deprecated-model-definition`

Vue 3 で削除された model オプションを禁止します。

[悪い例](#悪い) · [良い例](#良い)

既定の重大度: `error`  
プリセット: `essential`, `happy-path`, `ecosystem`, `nuxt`, `opinionated`  
自動修正: なし。修正内容を確認してください  
適用範囲: Vue SFC の JavaScript / TypeScript の script ブロック。対象となる Options API または script setup の形式は例を参照してください。  
オプション: ルール固有のオプションはありません。重大度とプリセットは設定できます。

## 設定（Vite+）

```ts
import { defineConfig } from "@vizejs/vite-plugin/vite-plus";

export default defineConfig({
  vue: {
    linter: {
      "preset": "incremental",
      "rules": {
        "script/no-deprecated-model-definition": "error"
      }
    },
  },
});
```

```sh
vp run lint
```

## 悪い

`model` オプションで `v-model` の prop とイベントを変更していますが、Vue 3 では削除されたため `v-model` を受け取れません。

```vue
<script lang="ts">
export default {
  model: { prop: 'checked', event: 'change' },
  props: { checked: Boolean },
}
</script>
```

## 良い

Vue 3 の `v-model` が使う `modelValue` prop と `update:modelValue` イベントを宣言します。

```vue
<script lang="ts">
export default {
  props: { modelValue: Boolean },
  emits: ['update:modelValue'],
}
</script>
```

良い例は上記の設定でこのルールの診断が出ない例です。他のルールの診断は出る場合があります。

[実装](https://github.com/ubugeeei-prod/vize/blob/main/crates/vize_patina/src/rules/script/no_deprecated_model_definition.rs#L38) · [全ルール](../all.md)
