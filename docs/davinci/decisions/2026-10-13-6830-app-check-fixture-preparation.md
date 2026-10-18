# Prepare Nuxt and ReKa fixtures before the App check

**Issue:** [#6830](https://github.com/ubugeeei-prod/vize/issues/6830)

## Decision

The App E2E `check` suite prepares a fixture the way its own project does
before Vize checks it:

- Elk, Nuxt UI and VueFes run their authored Nuxt preparation, so the types
  that modules register through Nuxt's `prepare:types` hook are part of the
  checked program. The preparation uses the Node 22 runtime those projects
  declare, scoped to the child process; the checker keeps its own runtime.
- ReKa resolves its pinned `tsconfig` providers (TypeScript 5.8.3, Vue 3.5.17
  and `@vue/tsconfig` 0.7.0) from `tests/_fixtures/reka-tsconfig-provider`.

## Reason

Without preparation the checked program was missing generated declarations.
VueFes reported eleven extra SFC errors for `import.meta.vfFeatures`, whose
augmentation is generated into `types/feature-flags.d.ts` and
`types/nitro-feature-flags.d.ts` during `nuxt prepare`. Those diagnostics came
from the test setup, not from the type checker.

## Scope

This change carries the preparation helpers, their tests, the three check
snapshots and the workflow step from
[#8615](https://github.com/ubugeeei-prod/vize/pull/8615). It does not carry:

- **npmX.** Its pinned commit depends on a `pkg.pr.new` tarball that now
  returns 404, so it cannot be installed. Preparing it needs the fixture pin
  to move, and that pin is referenced by other frozen lint fixtures. npmX
  keeps its current check until the pin moves in its own change.
- **Canonical corpus input epochs.** They existed only to authenticate the
  changed corpus file count after the npmX pin moved.
- **Test-only native reference receipts** for ReKa and VueFes and the
  matching entries in the changed-file allow-list. They bind hashes and byte
  lengths of provider files rather than checking type checker behaviour.

Golden diagnostics, budgets and the injected-error controls are unchanged.

## Separate current npmX App check input

The historical npmX Gitlink remains at
`c9e8be91e61eeeae956e2068722caa09e293cc68`. Its authored Lunaria preview
returned HTTP 404 again in [App run 39117259493](https://github.com/ubugeeei-prod/vize/actions/runs/39117259493).
The compact same-commit URL also returned 404; the stable package with the
same version has different archive integrity. No replacement reconstructs
that original frozen graph. Its old diagnostics and unavailable archive
remain historical, unqualified evidence.

The separate `npmx-check` Gitlink selects the real upstream program at
[`dc0319f8cb61e79e504a8d542b44badcb1384676`](https://github.com/npmx-dev/npmx.dev/commit/dc0319f8cb61e79e504a8d542b44badcb1384676).
Only App typecheck and its unchanged injected-error controls select it.
The original Gitlink, lint dependency migration, differential corpus,
Inspector inputs and all diagnostic snapshots and budgets stay intact.
This is a new upstream program, with 238 changed files including 48 Vue
files, rather than a dependency substitution for the old program.

Its whole authored graph declares Node 24, pnpm 11.22.0 with a SHA512 pin,
and Lunaria 0.2.0. The CLI workspace requires Node >=24.4.0. The full frozen
lock, root/CLI/docs manifests, workspace policies, patches and source hooks
are upstream inputs. The existing producer runs the same source-preserving
lexicon/sprite and root/docs Nuxt preparations, once per fresh campaign.
It does not run `vp config`, which may rewrite authored source. The original
source guards and installed/generated provider inventory remain mandatory.

Qualification must compare both authorized native CLI subjects against this
same physical prepared program and provider graph. Resolve Naive once per
campaign; neither subject resolves, installs or reruns generation. Hold the
harness, options and Corsa binary fixed, seal the complete graph before and
after each subject, and retain whole raw diagnostics. Keep the original
CLEAN, genuine TS2322 and repair assertions. The original Misskey source
and its mutable visual snapshot remain separate authorities; complete
Misskey and ReKa comparisons must name their actual input graphs.

This source preparation earns no runtime or snapshot acceptance. A future
matched B/H campaign and independent whole-output review are required.
