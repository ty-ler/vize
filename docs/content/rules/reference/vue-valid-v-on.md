---
title: "vue/valid-v-on"
---

# `vue/valid-v-on`

Enforce valid `v-on` directives

[Bad](#bad) · [Good](#good)

Default severity: `error`  
Presets: `essential`, `happy-path`, `nuxt`, `ecosystem`, `opinionated`  
Automatic fix: None; review the suggested change  
Applies to: Vue SFC templates and blocks, with script context where the rule requires it  
Options: See [typed options and defaults](../options.md).

Unsupported modifiers are reported individually at their names, including on long-form `v-on:click`, dynamic arguments and object listener syntax. Accepted names match `eslint-plugin-vue` 10.9.2: Vue's built-in modifiers, the complete keyboard alias table, any single Unicode code point, and names with a finite decimal integer prefix (`Number.parseInt(name, 10)` semantics). For example, `.13suffix` is accepted. Numeric-key deprecation and `.native` migration belong to separate rules.

Only `.stop` and `.prevent` allow an omitted handler. `.once`, `.enter` and configured custom names still need a handler. Add custom names under `vue.linter.ruleOptions`:

```ts
import { defineConfig } from "@vizejs/vite-plugin/vite-plus";

export default defineConfig({}).withVue({
  linter: {
    rules: { "vue/valid-v-on": "error" },
    ruleOptions: { "vue/valid-v-on": { modifiers: ["custom"] } },
  },
});
```

This permits `@click.custom="handler"`. Names are exact and case-sensitive; options supplement the built-in names and do not enable a disabled rule. Scoped entries can replace inherited names or reset them with `[]`.

The keyboard table is adapted from the MIT-licensed [eslint-plugin-vue keyboard aliases](https://github.com/vuejs/eslint-plugin-vue/blob/v10.9.2/lib/utils/key-aliases.json); its source and license are preserved alongside the implementation.

## Configuration (Vite+)

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

## Bad

The listener forms omit an event argument or their required handler/object expression.

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

## Good

Use an event with its handler, or pass a listener object to argument-free `v-on`.

```vue
<template>
  <div @click="handleClick"></div>
  <form @submit.prevent></form>
  <input @keyup.page-down="handlePageDown" />
  <input @keyup.あ="handleKey" />
  <div v-on="{ click: handleClick }"></div>
</template>
```

Good avoids this rule's finding under the configuration above; other rules may still report diagnostics.

[Implementation](https://github.com/ubugeeei-prod/vize/blob/main/crates/vize_patina/src/rules/vue/valid_v_on.rs#L30) · [All rules](../all.md)
