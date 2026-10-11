# Prepare Nuxt types in the checked fixture

**Issue:** [#6830](https://github.com/ubugeeei-prod/vize/issues/6830)

## Cause and authority

The original five-project App check at `da43c7cc` retained complete packets and
immutable source witnesses. VueFes reported eleven additional SFC errors for
`import.meta.vfFeatures`. Its pinned module actually generates the augmentation
in `types/feature-flags.d.ts` and `types/nitro-feature-flags.d.ts`, then registers
both with Nuxt's `prepare:types` hook. Neither was in the checked program.

The visual fixture setup already runs `npx -y pnpm@10 exec nuxt prepare`, but it
patches a separate worktree. The check uses the original Git fixture. A prepared
visual app cannot supply type authority for that different root.

Nuxt's [type-template implementation](https://github.com/nuxt/nuxt/blob/main/packages/kit/src/template.ts)
registers provider references through this hook. The regression fixture is the
complete [VueFes module at the original pin](https://github.com/vuejs-jp/vuefes-2025/blob/8eff3cd7dd79a7f47bbf2b78202b9aa2070ec5a6/modules/00.feature-flags.ts),
Git blob `dfccb61058aba2ade312fb667fc7b02183de9f7d`, retained without edits.

## Decision

Prepare the literal program root before its original check. Authenticate its
Gitlink and every authored file, and keep all source, module, config, package and
lock bytes unchanged when preparation finishes. Elk retains its existing clean
archive root. npmx, NuxtUI and VueFes retain their existing Git roots. Reka has no
Nuxt provider and receives no Nuxt preparation.

Install fixture-owned dependencies using the existing pnpm command and its
`--ignore-scripts` option, then run the original real Nuxt preparation command.
NuxtUI retains its `dev:prepare` command. No configuration fields, modules or
package-manager constraints are stripped. Lifecycle scripts unrelated to Nuxt
preparation do not get to rewrite authored source. A provider that changes such
source fails; the exact original bytes are restored and the mutation retained.

`--no-frozen-lockfile` remains explicit. Retain the complete original lock and
actual resolved counterpart before restoring authored lock bytes. This is an
unlocked installation. The preparation receipt also retains full physical Nuxt
outputs, observed package manifests and declaration candidates, workspace/virtual
store lock bytes and authored dependency requests. Lockfile SRI records are
retained data, not proof of matching installed tarball bytes. Native configuration
and dependency selection still require the checker's execution descriptor.

All existing checker argv, patterns, deadlines, captured whole packets, diagnostic
expectations and snapshot laws remain intact. No global guessed `test`,
`vfFeatures` or `RouteNamedMap` declarations are added.

## Validation and remaining delivery

Tooling tests cover exact checked-root command execution, unlocked-lock retention,
source restoration with failure preserved, and refusal of plain Vue projects.
The immutable VueFes module's actual hook callbacks produce both reference files;
TypeScript accepts their boolean properties and still rejects wrong types,
undeclared flags and `import.meta.test`. The hook host is a unit-test substitute,
not evidence that the full Nuxt CLI succeeded.

The helper will be published as a dependent child after the existing descriptor
and Reka producer changes. The sole App publisher must run one original full App
qualifier at the composed head, retaining actual provider outputs and complete
diagnostics before any proposed expectation change. Unit tests alone do not
qualify the real Nuxt installations, resolve remaining diagnostics or unblock a
release.
