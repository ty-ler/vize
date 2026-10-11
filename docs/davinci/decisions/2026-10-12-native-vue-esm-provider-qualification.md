# Native Vue ESM provider qualification

This decision pairs with [#6879](https://github.com/ubugeeei-prod/vize/issues/6879#issuecomment-6110443311).
It changes only test observers and their finite source-pair enrollment.
Production, original App goldens, native workloads, diagnostic vectors and budgets stay fixed.

## Authenticated failures

[Run 38158172287](https://github.com/ubugeeei-prod/vize/actions/runs/38158172287)
executed the seven original generic laws at `d8796ab02c7a07e89f123e680f0bb4a338daf47c`:
five passed; ReKa and Vue Fes failed their complete provider qualification.
Artifact `11709424805` is 179,180,728 bytes, SHA256
`098a9bf8fdf5cb2320bace6c5085155cc485a95d0bda1291a6782b2e3e466653`.
All ZIP CRCs and the complete source index match that exact source.
All 3,271 blob references / 2,925 distinct members / 330,488,287 decoded bytes
match their full hashes and sizes; the original packets remain retained intact.

Both refusals have exactly one failed condition: required `/vue/dist/vue.d.ts`
is absent, while the actual native programs load `/vue/dist/vue.d.mts`.
Both full diagnosing descriptors and source vectors agree; all four metadata
refusal controls, both absent/foreign source controls, and all queried physical
text comparisons pass. Vue Fes retains the original production singleton
`ProjectIdentity` refusal over two projects; ReKa has one admitted project.
ReKa's pinned binding proves runtime-core and refuses aggregate qualification
because its Vue selector also excludes the genuinely loaded ESM declaration.

The preserved `3407da4f4efa502f82624c483938af857ccba07f` artifact `11708083504`
is 178,537,511 bytes, SHA256
`485ec11fa310d43f81a30fb3c52dbb153d5f720cc04fad4f29a8527a333b4b7a`.
Its 3,259 references / 2,921 members / 329,143,332 bytes also verify completely.
All original authored sources/maps match; both full mapped vectors are unchanged
(Vue Fes 290, ReKa 3,464), and raw vectors/request/source membership agree after
comparison-only isolated-root substitution. Nine Vue Fes generated code blobs
differ only in isolated temporary paths; its config also carries a new generated
`#app-manifest` UUID. Whole originals are preserved, without normalization of an oracle.

## Separate public App source membership

The fixture authenticates the clean tracked tree and complete archive at Vue Fes
`8eff3cd7dd79a7f47bbf2b78202b9aa2070ec5a6`, and its exact 71 authored Vue roots.
The retained original public golden has 81 files / 47 errors; the actual public
CLI packet has 99 files / 21 errors, with no removed files. Its unchanged argv is
`check app/**/*.vue --format json --quiet --corsa-path <authenticated-native>`.
The complete parsed packet is SHA256
`964685180e43be13c0ead16cb8877de70311ebbd8208ca57bcec909ef97f38ae`.
All 18 additional physical-source receipts verify their full SHA256 and size;
the nine tracked additions also match the exact Git blob at that pinned tree.
This census is attribution, without permission to replace the 81-file golden.

| Additional public source                 | Pinned tracked Git blob or generated scope   |
| ---------------------------------------- | -------------------------------------------- |
| `.nuxt/typed-router/__definePageMeta.ts` | Nuxt preparation, untracked generated source |
| `.nuxt/typed-router/__helpers.ts`        | Nuxt preparation, untracked generated source |
| `.nuxt/typed-router/__i18n-router.ts`    | Nuxt preparation, untracked generated source |
| `.nuxt/typed-router/__navigateTo.ts`     | Nuxt preparation, untracked generated source |
| `.nuxt/typed-router/__routes.ts`         | Nuxt preparation, untracked generated source |
| `.nuxt/typed-router/__useTypedLink.ts`   | Nuxt preparation, untracked generated source |
| `.nuxt/typed-router/__useTypedRoute.ts`  | Nuxt preparation, untracked generated source |
| `.nuxt/typed-router/__useTypedRouter.ts` | Nuxt preparation, untracked generated source |
| `.nuxt/typed-router/index.ts`            | Nuxt preparation, untracked generated source |
| `app/components/form/index.ts`           | `da5fd35b6f28b84da4467aa2ab2df8ed057ed56e`   |
| `app/constant.ts`                        | `90f3d4fea3a595afe7387ef70d4c0ea6c68bbdfe`   |
| `i18n/en/sponsors.ts`                    | `abd1fa01df41d4cc0c3c51c296324461f038dee2`   |
| `i18n/ja/sponsors.ts`                    | `5c5290bae5f9f091866e76e7469f87bafa8ac8cf`   |
| `i18n/photo.ts`                          | `a8318911c78059992d525b91b6db92e6268ff1bf`   |
| `i18n/sponsor.ts`                        | `f613ab972ae025b59d677bbb6d1722056f93609f`   |
| `i18n/timetable.ts`                      | `0581b8b73f285e6eb911eb9bbd4adb09a9103cad`   |
| `server/api/staffs/index.get.ts`         | `ead8266073a26e2ceda23c986375bd5ad28084bf`   |
| `server/static-data/staffs.ts`           | `5e683d3b4d2358143adea0d94c81531ef3953292`   |

The public vector still reports complete TS2307 diagnostics in tracked
`app/components/form/index.ts` for `./VFTextarea.vue`, `./VFInput.vue` and
`./VFForm.vue`. Source/golden/provider correctness needs its own full App review.
The reference-factory nine generated-code hash differences concern temporary
root strings only (including `__router.d.ts`, unlike the public `__routes.ts`
member); its `#app-manifest` target also has a new preparation UUID. These are
retained exact observations, not normalized acceptance or a diagnostic migration.
All five existing App RED cases continue to block Stack delivery.

## Bounded correction and remaining acceptance

Read only declarations present in the actual diagnosing native source vector.
For Vue, retain its whole physical package.json and require the selected exact
`exports["."].import.types` target `./dist/vue.d.mts`, or the genuine loaded CJS
`require.types` target `./dist/vue.d.ts`, to resolve to that same physical source.
ReKa additionally binds complete native/physical declaration and manifest hashes,
byte lengths, physical identities and the pinned Vue 3.5.17 version to preparation.
The preserved complete pinned package manifest is 2,810 bytes, SHA256
`73e12ff3bd2e2591fd5c22b3e16f19b904f78ef441cdf024ca6a685d991913cb`.

Independent ESM/CJS export and foreign/missing/changed receipt laws qualify only
local metadata/physical contracts. ReKa aggregation requires both a loaded Vue
entrypoint and runtime-core; complete ESM+CJS without core and duplicate core
without Vue both refuse while retaining every complete binding.
The locked/offline Rust 1.99 default-feature local build passes all five helper
laws; these results grant no native execution or benchmark credit.
Fresh actual native baseline/wrong/repair
execution of the original two laws remains mandatory; no broader App, original400,
10x, merge, release or migration credit follows. All five existing App failures
and original goldens remain unchanged. Two finite cfg(test) helper paths are added
without changing any prior source-pair member or unknown-source refusal.
