---
title: "script/no-deprecated-vue-config-keycodes"
---

# `script/no-deprecated-vue-config-keycodes`

Disallow Vue.config.keyCodes, which Vue 3 removed

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
        "script/no-deprecated-vue-config-keycodes": "error"
      }
    },
  },
});
```

```sh
vp run lint
```

## Bad

`Vue.config.keyCodes` registers key-code aliases for `v-on` modifiers, which Vue 3 removed.

```vue
<script setup lang="ts">
import Vue from 'vue'
Vue.config.keyCodes = { f1: 112 }
</script>
```

## Good

The app is created with `createApp()` and registers no key-code aliases; templates use `KeyboardEvent.key` names as modifiers.

```vue
<script setup lang="ts">
import { createApp } from 'vue'
import App from './App.vue'
createApp(App).mount('#app')
</script>
```

Good avoids this rule's finding under the configuration above; other rules may still report diagnostics.

[Implementation](https://github.com/ubugeeei-prod/vize/blob/main/crates/vize_patina/src/rules/script/no_deprecated_vue_config_keycodes.rs#L31) · [All rules](../all.md)
