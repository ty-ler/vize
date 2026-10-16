---
title: 共有設定リファレンス
---

<!-- Reviewed translation; source: guide/configuration-reference.md -->

<span id="standalone-configuration-reference"></span>

# 共有設定リファレンス

既存の Vite 設定の `vue:` と、TypeScript プロジェクトの `vueCompilerOptions` を
使います。最小の例は[設定ガイド](./configuration.md)を参照してください。

## 設定ファイル

CLI とエディタは、最も近いプロジェクトの `vite.config.ts`、`.mts`、`.cts`、
`.js`、`.mjs`、`.cjs` を探索します。`package.json`、`tsconfig.json`、`jsconfig.json`
がプロジェクトの境界です。CLI では `--config` で Vite 設定を明示できます。
`vize.config.*` は廃止しました。Vite 設定と同じ場所に残った専用ファイルは読みません。
専用設定しかないプロジェクトでは、移行エラーになります。

Vite 内の相対パスは、選択された Vite の `root` を基準にします。相対指定の `root`
自体は設定ファイルのディレクトリから解決します。CLI に直接渡した入力と `--tsconfig`
はコマンドの作業ディレクトリを基準にします。直接渡したプラグインのオプションと
明示的なエディタの機能スイッチは、共有設定を上書きします。

## TypeScript の設定

```ts
// vite.config.ts
import { defineConfig } from "@vizejs/vite-plugin/vite-plus";

export default defineConfig({
  server: { port: 3000 },
}).withVue({
  compiler: { sourceMap: true, vapor: false, templateSyntax: "standard" },
  linter: { preset: "happy-path" },
  formatter: { printWidth: 100 },
  languageServer: { hover: true },
});
```

`vue` は `version`、`compiler`、`typeChecker`、`linter`、`formatter`、
`languageServer`、`globalTypes`、`files`、`ignores`、`basePath`、`lib`、`vite`、
`musea`、`experimentals`、`dialect`、`name`、`entries` を受け付けます。ネイティブのオプション名を使い、未知のキーは
エラーになります。コンパイルモードは[コンパイラのリファレンス](./compiler-configuration-reference.md)、
Lint の型付きオプションは[ルールオプション](../rules/options.md)を参照してください。

## Vue の型解決

`vize check` と言語サーバーは、解析対象プロジェクトから Vue の型を解決します。
使う Vue のバージョンを対象プロジェクトで宣言し、`vue`、`@vue/compiler-sfc`、
フレームワーク連携のバージョンを揃えてください。Vize 自体のビルド依存で利用者の
Vue のバージョンが決まることはありません。

ambient 宣言、自動 import の生成ファイル、パスエイリアス、Vue の
`ComponentCustomProperties` はプロジェクトの `tsconfig.json` に置きます。
TypeScript 標準の `extends`（パッケージと配列の形式を含む）と `references` を使えます。

```json
{
  "extends": "./tsconfig.base.json",
  "compilerOptions": { "strict": true, "noEmit": true },
  "vueCompilerOptions": {
    "target": 3.5,
    "strictTemplates": true,
    "checkUnknownComponents": true
  },
  "include": ["src/**/*"]
}
```

対応する Vue オプションは `target`、`strictTemplates`、`checkUnknownProps`、
`checkUnknownComponents`、`checkUnknownEvents`、`checkUnknownDirectives`、
`strictVModel`、`strictCssModules`、`jsxSlots`、`inferComponentDollarEl`、
`inferComponentDollarRefs`、`inferTemplateDollarEl`、`inferTemplateDollarRefs`、
`inferTemplateDollarSlots`、`inferTemplateDollarAttrs`、`fallthroughAttributes`、
`checkRequiredFallthroughAttributes`、`resolveStyleImports`、`resolveStyleClassNames`、
`vapor` です。`vue-tsc` の全オプションに対応するという意味ではありません。

`target` は 2.7 までの Vue 2.x、Vue 3.x、`99`、`"auto"` を受け付けます。
自動選択はプロジェクトにインストールされた Vue に従い、Vite の明示的な `vue.version`
を優先します。未対応の値は設定エラーになります。TypeScript の厳密さは
`compilerOptions` で指定し、Vize の明示的な型チェック設定は対応する既定値を上書きします。

### TypeScript プロジェクトの所有関係と対応範囲

設定はソースファイルを所有する TypeScript プロジェクトから読みます。継承した JSONC、標準のパッケージ・配列形式の `extends`、プロジェクトの `references` も保持します。`target: "auto"` はそのプロジェクトにインストールされた Vue を解決し、見つからない場合や未対応のバージョンでは設定エラーになります。2.7 未満の数値の Vue 2 ターゲットは Vue 2、2.7 は Vue 2.7、Vue 3.x と `99` は現在の Vue 3 系列を選びます。Vite に `vue.version` を明示した場合は、`"3"` も含めて `target` より優先します。

| Vue compiler option | 対応する動作 |
| --- | --- |
| `target` | 上記の規則でプロジェクトの Vue ターゲットを選択します。 |
| `strictTemplates` | 対応する厳密なテンプレート検査の既定値を設定します。明示した個別の設定が優先します。 |
| `checkUnknownProps`, `checkUnknownComponents`, `checkUnknownEvents`, `checkUnknownDirectives` | 対応する未知のテンプレート要素の検査を設定します。 |
| `strictVModel`, `strictCssModules`, `strictComponentAttrs` | 各項目の検査を設定します。`strictComponentAttrs` は明示指定が必要で、`strictTemplates` だけでは有効になりません。 |
| `jsxSlots` | JSX のスロット検査を設定します。 |
| `inferComponentDollarEl`, `inferComponentDollarRefs`, `inferTemplateDollarEl`, `inferTemplateDollarRefs`, `inferTemplateDollarSlots`, `inferTemplateDollarAttrs` | 対応するコンポーネント・テンプレートの型推論を設定します。 |
| `fallthroughAttributes`, `checkRequiredFallthroughAttributes` | fallthrough 属性の扱いと検査を設定します。 |
| `resolveStyleImports`, `resolveStyleClassNames` | 対応するスタイルの import・クラス解決を設定します。 |
| `vapor` | 対応する Vapor のプロジェクト設定です。 |
| `plugins` | `vue-router/volar/sfc-typed-router` を認識します。任意の Vue 言語プラグインを読み込む機能ではありません。 |

`optionsWrapper` は未対応です。Vue ツールではコードを前後から包む prefix/suffix を指定するもので、Options API のスイッチではありません。Vize の既存の Options API 検査は別の `vue.typeChecker.optionsApi` で設定します。ここに挙げた対応は限定的なマッピングで、すべての `vue-tsc` オプションとの同等性を示すものではありません。

## 実験的なフラットエントリ

モノレポの型チェックには対象パッケージの TypeScript プロジェクトを使います。
スコープごとの Vue Lint は `vue.entries` に置けます。

```ts
export default defineConfig({
  root: "apps/web",
  vue: {
    entries: [
      {
        files: ["src/trusted/**/*.vue"],
        linter: { rules: { "vue/no-v-html": "off" } },
      },
    ],
  },
});
```

entry には `basePath`、`files`、`ignores`、`linter` を指定できます。
その他はプロジェクト全体の設定です。TypeScript のプロジェクト参照は移さないでください。

## 共有設定と extends

Vize 独自の `extends` はありません。通常の JavaScript オブジェクトを共有します。

```ts
import { defineConfig } from "@vizejs/vite-plugin/vite-plus";
import vpConfig from "./build-options.ts";
import vueConfig from "./vue-options.ts";

export default defineConfig(vpConfig).withVue(vueConfig);
```

TypeScript 標準の `extends` と Vite の設定関数は引き続き利用できます。

## 静的解析のオプション

Vue Lint は `vue.linter`、言語サーバーは `vue.languageServer` に設定します。
Vue のルールは `vue.linter.rules`、Oxlint のルールは従来どおり `lint.rules` に置きます。
クロスファイル解析と型付き Lint は[Lint の実行](./lint-execution.md)、
型付きルールオプションは[ルールオプション](../rules/options.md)を参照してください。
未知のルールオプションはエラーになります。

`vue.typeChecker.tsconfig` で別の TypeScript プロジェクトを選べます。
`vue.typeChecker.corsaPath` は型チェッカーの実行ファイルを選ぶためだけに使います。
`vue.typeChecker.servers` は並列プロセス数の上限（`1`〜`32`）です。省略時は
プロジェクトと CPU に応じて並列度を調整します。

## Musea の共有設定

探索、ルート、VRT は `vue.musea` にまとめます。`musea()` に直接渡すオプションは
対応する共有値を上書きします。

```ts
import { defineConfig } from "@vizejs/vite-plugin/vite-plus";
import { musea } from "@vizejs/vite-plugin-musea";

export default defineConfig({
  plugins: [musea()],
  vue: {
    musea: {
      include: ["src/**/*.art.vue"],
      exclude: ["node_modules/**", "dist/**"],
      basePath: "/__musea__",
      inlineArt: false,
    },
  },
});
```

`previewCss`、`previewSetup`、`tokensPath`、`theme`、`storybookOutDir` などの表示用設定は
`musea()` のオプションに置きます。`musea-vrt` も同じ Vite 設定の `include`、`exclude`、
`vrt` を読みます。`vize musea new` は専用設定を作らず、ストーリーの例を生成します。
