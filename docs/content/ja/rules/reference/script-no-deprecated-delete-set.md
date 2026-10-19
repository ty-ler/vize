---
title: "script/no-deprecated-delete-set"
---

# `script/no-deprecated-delete-set`

Vue 3 で削除された $set・$delete と Vue.set・Vue.delete を禁止します。

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
        "script/no-deprecated-delete-set": "error"
      }
    },
  },
});
```

```sh
vp run lint
```

## 悪い

`this.$set()` と `this.$delete()` は Vue 3 で削除され、コンポーネントのインスタンスに存在しません。

```vue
<script lang="ts">
export default {
  methods: {
    update() {
      this.$set(this.user, 'name', 'Ada')
      this.$delete(this.user, 'age')
    },
  },
}
</script>
```

## 良い

プロパティへの代入と `delete` 演算子を使います。Vue 3 のリアクティビティはどちらも追跡します。

```vue
<script lang="ts">
export default {
  methods: {
    update() {
      this.user.name = 'Ada'
      delete this.user.age
    },
  },
}
</script>
```

良い例は上記の設定でこのルールの診断が出ない例です。他のルールの診断は出る場合があります。

[実装](https://github.com/ubugeeei-prod/vize/blob/main/crates/vize_patina/src/rules/script/no_deprecated_delete_set.rs#L53) · [全ルール](../all.md)
