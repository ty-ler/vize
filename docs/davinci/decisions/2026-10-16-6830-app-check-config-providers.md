# Prepare original config providers for App checks

**Issue:** [#6830](https://github.com/ubugeeei-prod/vize/issues/6830)

## Failure

The main App E2E [check:all job](https://github.com/ubugeeei-prod/vize/actions/runs/38866347055/job/116860084891)
failed before checking source in seven cases: the full Naive UI, npmX and
Voicevox checks, plus the injected-error checks for those three apps and
Misskey. Their original Vite configs eagerly import providers including
`@rollup/plugin-babel`, `@nuxt/test-utils/config`, `vite-plugin-electron`
and Misskey's workspace `estree-walker`. Those fixtures had no preparation
for these imports. The full Misskey check already used its prepared worktree,
but its injected-error check ran in the unprepared source checkout.

The same job also had diagnostic snapshot differences in Elk, Misskey and
ReKa. They are separate product investigations; installing config providers
does not justify accepting those differences.

## Decision

Share the existing [pinned lint fixture preparation](2026-10-11-6830-pinned-lint-fixture-coverage.md)
with these check cases. Each check gets an isolated export of the original
pinned source and the same frozen dependency recipe already used by lint.
Voicevox runs its authored Electron installation and copies `.env.example`;
Misskey builds its i18n package and copies its example config. The package
name, version and runtime environment reach every checker invocation.

The npmX installer uses the existing, explicitly migrated dependency graph:
the unavailable Lunaria preview is replaced by its reviewed official release
only in a separate installer export. The original source manifest and lock
remain exact, and the receipt continues to say `originalFrozenClosure: false`.
This does not claim that the missing preview tarball has become available.
Naive UI retains its existing generated lock bound to the pinned source.

Check patterns, tsconfig arguments, diagnostics and timeouts stay unchanged.
The injected-error control still runs clean, broken and repaired source and
requires the repaired result to equal the clean result. Verification after
each test rejects changes to any original blob, frozen lock or generated
config input. Check provider receipts are retained under
`.vize/artifacts/check-fixtures/` by the existing App E2E artifact upload.

## Validation

- Fifteen focused tests pass for environment forwarding, clean/broken/repaired
  controls, config-load failure propagation, original source custody,
  dependency migration and runtime selection.
- Scoped formatting and lint pass without warnings.
- The native loader's actual module import and Vite config projection run
  against prepared Naive UI, npmX, Voicevox and Misskey providers on Node 24.14.0.
  All original source and lock checks pass after evaluation.
- Full checker diagnostics and the remaining snapshot investigations require
  the exact-head App E2E run; this change does not update a diagnostic golden.
