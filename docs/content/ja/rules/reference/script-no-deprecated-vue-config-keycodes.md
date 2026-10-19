---
title: "script/no-deprecated-vue-config-keycodes"
---

# `script/no-deprecated-vue-config-keycodes`

Vue 3 で削除された Vue.config.keyCodes を禁止します。

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
        "script/no-deprecated-vue-config-keycodes": "error"
      }
    },
  },
});
```

```sh
vp run lint
```

## 悪い

`Vue.config.keyCodes` で `v-on` 修飾子のキーコード別名を登録していますが、Vue 3 で削除されました。

```vue
<script setup lang="ts">
import Vue from 'vue'
Vue.config.keyCodes = { f1: 112 }
</script>
```

## 良い

`createApp()` でアプリを作成し、キーコードの別名は登録しません。テンプレートでは `KeyboardEvent.key` の名前を修飾子に使います。

```vue
<script setup lang="ts">
import { createApp } from 'vue'
import App from './App.vue'
createApp(App).mount('#app')
</script>
```

良い例は上記の設定でこのルールの診断が出ない例です。他のルールの診断は出る場合があります。

[実装](https://github.com/ubugeeei-prod/vize/blob/main/crates/vize_patina/src/rules/script/no_deprecated_vue_config_keycodes.rs#L31) · [全ルール](../all.md)
