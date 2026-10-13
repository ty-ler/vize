# Declared TypeScript in lint reference parsers

Issue: [#6830](https://github.com/ubugeeei-prod/vize/issues/6830).

The reference parser must read `<script lang="ts">` as TypeScript. Both the
canonical Rust runner's actual ESLint payload and the compatibility baseline
use one small shared parser selector. Vue ESLint Parser already selects a
parser by the declared script language; only its `ts` entry changes the existing
TypeScript parser's JSX option to false. The original JS, JSX, TSX, template
parser and unknown-language fallback retain their existing behavior.

The original Matrix at `2817a0aa13518dd46c16bc8bf56ac831f68c24dc`
([run 38331707741](https://github.com/ubugeeei-prod/vize/actions/runs/38331707741))
reported unusable baselines for Inertia, GUI for SingBox, uni-app, VitePress
and Vux. Its Rust collector counts every null-rule message, discards the
original parser message and file, and describes that message count as files.
Private baseline-only reproduction recovered all seven fatal messages with
Node 24.14.0, ESLint 10.4.1, eslint-plugin-vue 10.9.2, Vue ESLint Parser 10.4.1
and TypeScript ESLint Parser 8.65.0.

Two failures are configuration defects on valid declared TypeScript:

- Inertia revision `59bb8cbff028b9b405cf606588f1f713806f9187`,
  `packages/vue3/test-app/Pages/Events.vue:555:33`: `Identifier expected`
  on the angle assertion `<CancelToken | null>null`.
- GUI revision `1be4816dea1e8793d8e08ae4f8f016c28101672d`,
  `frontend/src/components/CustomAction/index.vue:18:46`: `Unexpected token`
  on the generic arrow `<T>(field: T): T => ...`.

With their whole pinned source bodies, changing only the JSX option removed
those fatal messages and returned 286 and 10 complete reference rule messages
respectively. These historical provider observations establish the configuration
cause. They do not qualify a new source head, its full project, or its Matrix.

The new provider laws retain both whole pinned inputs, verify their Git blob
and SHA256 identities, and select the checked-out source's entire ecosystem
rule map, including unimplemented rules. Both actual baseline entry points
must return complete results equal to the independent non-JSX TypeScript
reference. Minimal generic-arrow and assertion cases also retain real lint
findings, locations and severities. JSX, TSX, ordinary-script, template and
unknown-language controls compare whole results against the original
configuration; malformed TS and TSX still retain fatal messages. Complete
provider results are written under `target/differential/` for the existing
differential evidence uploader.

Five other messages remain unresolved reference support boundaries:

- Three uni-app iOS `<script lang="uts">` inputs use the Swift-style named
  argument `for = UIControl.State.normal`. The TypeScript reference rejects
  it at hello-component `35:38`, test-props `80:38` and uts-button `71:38`.
- VitePress `template/.vitepress/theme/Layout.vue:1:45` is an unrendered
  EJS generator input containing `<script setup<%= ... %>>`.
- Vux `packages/loader/test/fixtures/pre.vue:18:6` declares CoffeeScript,
  Pug and Stylus; the TypeScript reference rejects CoffeeScript `data: ->`.

These inputs belong to the pinned upstream fixture repositories. Their
preprocessing or reference language support needs separate qualification;
they are not evidence of malformed Vue. This change neither removes inputs
nor suppresses these original refusals. It preserves native invocations,
rule selection, inline directives, comparison identities, and zero ceilings.
The stable source pair must retain each checkout's authentic provider
configuration and complete rule map; this historical head supplies no credit
to another source. Fresh Actions and protected delivery remain required.
