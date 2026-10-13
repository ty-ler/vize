# Vite+ bootstrap cold/warm diagnostic proposal

Issue: [#6830](https://github.com/ubugeeei-prod/vize/issues/6830).

Status: approved for a narrow child PR and exact-head source qualification.
The coordinator owns one manual full Check cold/warm dispatch after source
qualification. No diagnostic execution, cache seeding or measured gain has
occurred. Every original Check event, job, condition,
dependency, command and cache configuration is preserved exactly. Only
standalone YAML comments are reduced to retain the existing line budget. Optional diagnostics add jobs
alongside the full Check, never replace it.

## Baseline and attribution limit

[Check 38341424403, Rust shard 3](https://github.com/ubugeeei-prod/vize/actions/runs/38341424403/job/115119603586)
used PR head `d64adbc0085232ad11778838bfbf20dfd3bded3c` and merge checkout
`495b94521262ade06699b53b94815b229efa7c59` on Blacksmith Ubuntu 24.04 x64.
Setup-vp took 742 seconds; nextest took 109 seconds. "Preparing Node.js and
pnpm..." started at 03:49:51.2003689 UTC and "Installing dependencies..." at
04:00:24.6960687 UTC: 633.496 seconds. Later explicit Node 24.14 installation
took 1.284 seconds. Dependency restoration took about 4.2 seconds and workspace
installation about 78.45 seconds. Existing logs identify neither bootstrap
Node version/archive bytes nor which Node/pnpm operation caused the delay.
There is no Node-only or 633-second savings claim.

## Supported mechanism

The pinned [setup-vp entry point](https://github.com/voidzero-dev/setup-vp/blob/ca1c46663915d6c1042ae23bd39ab85718bfb0fa/src/index.ts#L19-L48)
installs Vite+ before restoring its dependency cache. Vite+ 1.1's
[old integration layout](https://github.com/voidzero-dev/vite-plus/blob/3aa366ee03ac162f5acfd8ee7c752a8245d904c6/packages/cli/install.sh#L580-L599)
uses `~/.vite-plus`. Its [bootstrap preparation](https://github.com/voidzero-dev/vite-plus/blob/3aa366ee03ac162f5acfd8ee7c752a8245d904c6/crates/vp_setup/src/install.rs#L221-L243)
selects latest Node LTS and pnpm 10.33.0 independently of project Node 24.14.

Node lives in `~/.vite-plus/js_runtime/node/<version>`; the
[installed-state hit](https://github.com/voidzero-dev/vite-plus/blob/3aa366ee03ac162f5acfd8ee7c752a8245d904c6/crates/vp_js_runtime/src/runtime.rs#L192-L247)
returns on executable existence before signed SHASUMS/hash checks. Misses
retain normal verification; no bypass variable is introduced. Archives are
temporary. Bootstrap pnpm lives in
`~/.vite-plus/package_manager/pnpm/10.33.0/pnpm`; its
[cached-install check](https://github.com/voidzero-dev/vite-plus/blob/3aa366ee03ac162f5acfd8ee7c752a8245d904c6/crates/vp_pm_cli/src/package_manager.rs#L1264-L1280)
does not freshly hash pnpm when no expected hash was supplied.

## Finite experiment and custody

An explicit `vp-bootstrap-diagnostic` manual request must use
`ci/vp-bootstrap-diagnostic-20261013`; the ownership guard fails another branch
instead of silently skipping. Cold and warm use identical source, setup-vp
SHA, global Vite+ 1.1.0, project Node 24.14.0 and project pnpm 12.1.0.

Cold requires no existing Vite+ installation and an exact namespace miss. It
records the official Node index, selects highest stable LTS using the SDK's
rule, and rejects any different installed LTS. The immutable snapshot contains
only that Node version, Node 24.14 and bootstrap pnpm 10.33 directories. Keys
include owned scope, run, attempt, source SHA, Linux/Ubuntu 24.04 glibc,
architecture and all SDK/runtime/package-manager/control versions. There are
no fallback keys, shared package stores, shims/configuration or sticky mounts.

Warm downloads exact cold custody with artifact digest mismatch fatal, checks
source/run/version identity, requires the exact cache hit and checks restored
entry hashes against cold records before SDK execution. This establishes
snapshot custody, not fresh Node signature/archive verification on warm hits.
Production cache policy and writer trust remain unchanged.

The pinned setup-vp dependency key has no namespace input. Both diagnostic
lanes therefore use supported `cache: false` while still executing real
`vp install`. All full Check cache settings remain exact. This differs from
the observed `cache: true` baseline: compare bootstrap preparation separately,
retain workspace install timings, and make no whole-job claim against 742
seconds. Warm restores neither installed workspace dependencies nor the
project package-manager store.

Source hashes are recorded before/after preparation and controls. The actual
installed native TypeScript 7.0.2 compiler accepts a valid project and produces
exactly TS2322 for a string assigned to a number. Existing Vue 3.5.35 whole
compile/parser/runtime tests must pass all 45 controls without skips. Complete
control outputs, installed identities/binary hashes, raw SDK job logs, actual
request URLs and phase timestamps are retained seven days. Runtime preparation
evidence does not replace full Check or installed-consumer acceptance.

## Retained Check rationale

The reduced standalone comments retain these operational rules here: daily
03:11 UTC Check stays staggered from native smoke/E2E; exact-SHA full validation
uses its existing concurrency identity. SemVer checks run before tag promotion
and release resumption, retain the published crate inventory and derive release
type from candidate versions. Source lint uses the commit-built CLI. Fixture
coverage retains Pkl; source and strict nightly coverage stay full-run trend
gates. App E2E retains the Rust native prerequisite. Final reports collect
inventory before asserting every required job succeeded. Every related command
and condition remains identical.

## Follow-up boundary

Exact-head source Actions precede the coordinator's single authorized full
Check cold/warm dispatch. Do not displace the active runner wave. Inspect actual
resolved versions, every full Check gate and exact preparation phases before
considering any production caching change. No local installation or Rust build is necessary for this proposal.

Paired issue-comment text for source qualification:

> The #6830 change adds an owned manual Vite+ cold/warm bootstrap diagnostic
> while preserving full Check. Run-scoped Node/pnpm snapshots retain normal
> cold checks and distinguish warm installed-state reuse. The 633-second
> Node+pnpm phase remains unattributed. Source qualification precedes the
> coordinator's single authorized dispatch; no measured gain is claimed.
