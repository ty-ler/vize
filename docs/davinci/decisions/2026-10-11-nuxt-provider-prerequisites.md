# Authentic Nuxt fixture prerequisites

Tracking: [#6830](https://github.com/ubugeeei-prod/vize/issues/6830),
delivery through [#8615](https://github.com/ubugeeei-prod/vize/pull/8615).
The [paired issue decision](https://github.com/ubugeeei-prod/vize/issues/6830#issuecomment-6109469770)
records the same preparation boundary.

The original composed qualifier at `8170fd3e28885b0de430fd9cd8bbece666cbce18`
failed in [run 38138961313](https://github.com/ubugeeei-prod/vize/actions/runs/38138961313).
The authentic npmX `83e38d9d` Nuxt modules imported missing
`shared/types/lexicons/dev`. Vue Fes's engine-strict install observed Node
`24.14.0` even though the initial preparation receipt identified Node 22.
Keep both original failures and the unchanged diagnostic expectations.

## Decisions

The pinned npmX postinstall explicitly runs `generate:lexicons`, then
`generate:sprite`, before Nuxt. Run those same authored Vite+ generator tasks
with their existing cache-disabled argument arrays and 120-second deadlines.
Authenticate both postinstall hooks before either command executes. Preserve
every tracked source byte after each generator; a failed or source-mutating
generator stops before Nuxt. Retain authored generator scripts, lexicon inputs
and Vite configuration, plus every generated lexicon and the three sprites.
Continue to avoid the unrelated postinstall operations that rewrite source.

An initial PATH prefix cannot bind npm's descendants:
[npm exec always adds local executable directories](https://docs.npmjs.com/cli/v11/commands/npm-exec/).
Invoke the selected distribution's actual Node and npm CLI directly. A scoped
command shell prepends that runtime after npm constructs its child PATH, before
launching the original pnpm command. The caller's environment, checker runtime,
fixture package-manager contract and authored pnpm `executionEnv` remain intact.
The command shell is temporary and removed after success or failure. Retain the
same logical preparation commands and deadlines; no checker arguments change.

## Evidence and remaining work

All 14 focused preparation/runtime laws pass on actual Node `22.23.2` and
`24.14.0`. The regression executes real npm with a local test CLI and a real
copied Node binary. An ancestor `.bin/node` first intercepts the old runner;
the repaired runner authenticates both the CLI and its nested Node child.
That local distribution fixture is not a hosted Nuxt consumer result.
These executions are on macOS; Windows command-shell execution is unqualified.

Authentic local preparation succeeds for both unchanged Gitlinks: npmX
`83e38d9d40025ba45d800caf066012c0e7bef753` produces 116 prerequisite members
and 56 Nuxt provider files; Vue Fes
`8eff3cd7dd79a7f47bbf2b78202b9aa2070ec5a6` produces 66 Nuxt provider files.
Both receipts report `failed: false`, `authoredPreserved: true` and no source
mutations. Both fixture Git diffs remain clean. Installation remains unlocked,
with its resolved lock retained separately from the restored authored lock.

TODO: rerun the original complete App/native qualifier on the composed delivery
head and retain full provider and diagnostic evidence. The inherited Elk and
NuxtUI diagnostic mismatches from the failed run remain unresolved; no golden
changes are authorized by this preparation repair. Protected merge and public
release acceptance remain pending. No performance or 10x claim follows.
