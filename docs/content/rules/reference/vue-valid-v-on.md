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

## Modifier validation

Unsupported modifiers are reported individually at their names, including on long-form, dynamic and object listeners. Accepted names follow `eslint-plugin-vue` 10.9.2: Vue event modifiers, keyboard aliases, single Unicode code points, and finite decimal integer prefixes (`Number.parseInt(name, 10)`). Thus `.13suffix` is accepted; numeric-key and `.native` migrations use separate rules. Only `.stop` and `.prevent` work without handlers; `.once`, `.enter`, and custom names require one.

`modifiers` adds exact, case-sensitive names without enabling the rule. The Vite+ configuration below accepts `@click.custom="handler"`; standalone config uses `linter.ruleOptions`. Scoped entries replace the list; `[]` resets it. The keyboard table comes from the MIT-licensed [eslint-plugin-vue aliases](https://github.com/vuejs/eslint-plugin-vue/blob/v10.9.2/lib/utils/key-aliases.json); source and license are retained beside the implementation.

## Configuration (Vite+)

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

## Bad

The listeners omit a required event or expression, or use unsupported modifiers such as .sync and .nativeish.

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

Use a handler, a handler-free action modifier, a supported keyboard modifier, or a listener object for argument-free `v-on`.

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
