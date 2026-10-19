---
title: "script/no-deprecated-model-definition"
---

# `script/no-deprecated-model-definition`

Disallow the model component option, which Vue 3 removed

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
        "script/no-deprecated-model-definition": "error"
      }
    },
  },
});
```

```sh
vp run lint
```

## Bad

The `model` option renames the `v-model` prop and event, which Vue 3 removed; the component would no longer receive `v-model`.

```vue
<script lang="ts">
export default {
  model: { prop: 'checked', event: 'change' },
  props: { checked: Boolean },
}
</script>
```

## Good

The component declares the `modelValue` prop and the `update:modelValue` event that Vue 3's `v-model` uses.

```vue
<script lang="ts">
export default {
  props: { modelValue: Boolean },
  emits: ['update:modelValue'],
}
</script>
```

Good avoids this rule's finding under the configuration above; other rules may still report diagnostics.

[Implementation](https://github.com/ubugeeei-prod/vize/blob/main/crates/vize_patina/src/rules/script/no_deprecated_model_definition.rs#L38) · [All rules](../all.md)
