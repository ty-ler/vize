---
title: "script/no-deprecated-delete-set"
---

# `script/no-deprecated-delete-set`

Disallow $set and $delete, which Vue 3 removed

[Bad](#bad) · [Good](#good)

Default severity: `error`  
Presets: `essential`, `happy-path`, `ecosystem`, `nuxt`, `opinionated`  
Automatic fix: None; review the suggested change  
Applies to: JS/TS scripts in Vue SFCs; examples show the relevant Options API or script setup form  
Options: No rule-specific options. Severity and preset selection are configurable.

## Configuration (Vite+)

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

## Bad

`this.$set()` and `this.$delete()` were removed in Vue 3; the methods do not exist on the component instance.

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

## Good

The method assigns the property and uses the `delete` operator; Vue 3 reactivity tracks both.

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

Good avoids this rule's finding under the configuration above; other rules may still report diagnostics.

[Implementation](https://github.com/ubugeeei-prod/vize/blob/main/crates/vize_patina/src/rules/script/no_deprecated_delete_set.rs#L53) · [All rules](../all.md)
