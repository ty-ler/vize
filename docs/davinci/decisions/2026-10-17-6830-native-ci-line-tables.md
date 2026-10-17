# Native CI builds retain line tables

Issue: #6830. The Linux Actions JS package tests build the source addon once
through `build-local.mjs --no-js`, then retain and authenticate the complete
artifact throughout the original CLI and NAPI formatter observations.

The two observed builders jobs in runs [38935551261](https://github.com/ubugeeei-prod/vize/actions/runs/38935551261/job/117090136978)
and [38936385902](https://github.com/ubugeeei-prod/vize/actions/runs/38936385902/job/117092960110)
used dev opt0 with full debug information. Each frozen addon was 991,546,723
bytes; its compressed ZIP member was about 196 MB. Cargo took 62 and 47.38
seconds, respectively, and each formatter artifact upload took 13 seconds.
The 90–95 second CLI and 70–74 second NAPI cases are whole-test durations,
not measurements of hash CPU time.

The existing Linux Actions/non-release gate now passes
`--config 'profile.dev.debug="line-tables-only"'` directly to Cargo. This keeps
debug assertions, overflow checks, opt0, incremental settings, features,
fresh build tokens and the committed JS/type entrypoints. Local builds and
the release profile are unchanged. The existing separate `build:ci` route
still owns its generated-entrypoint custody and debug0 profile contract.

[Cargo documents line tables](https://doc.rust-lang.org/cargo/reference/profiles.html#debug)
as retaining filename/line backtraces without variable/parameter data.
The existing fault collector requests backtraces, shared libraries and
registers while suppressing frame arguments. Complete artifact hashes,
source/toolchain identity, raw output and failure evidence remain mandatory.
Capture and replay both reject a changed command or an optimized,
assertion-disabled, overflow-unchecked or unexpected debug profile.

The `test-js-packages` cache namespace and trusted-write policy stay the same.
Cargo fingerprints profile settings; the new setting initially rebuilds
incompatible objects until the trusted native seed includes it. Cache
freshness and toolchain changes must be reported alongside timing results.

The controlled Actions comparison and hosted source-line debugger check are
pending. No reduction in walltime or artifact size is claimed before that
measurement. Temporary comparison workflow and controls are excluded from
the landing change.
