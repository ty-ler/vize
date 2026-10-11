# Cold native graph CPU attribution for #3952

Issue: [#3952](https://github.com/ubugeeei-prod/vize/issues/3952).
Companion to the [current-main qualification](./2026-10-11-3952-current-main-qualification.md).
The complete original attribution and parser boundaries below are moved without
changing their packets, timing labels, thresholds or acceptance limits.

Diagnostic [run 38152025888](https://github.com/ubugeeei-prod/vize/actions/runs/38152025888)
keeps the preceding native performance producer unchanged and runs the original
campaign before a separate CPU-only observer. Artifact `11707726205`, archive SHA
`70d055e9d4be2fc0ee9a80cc3e9a53b0eef1740e3b9dce422daec3a0ce43b720`, retains
the actual owned PID 91738/birth stat/source executable, both lock and binary
digests, 421.665 MB raw perf data, complete scripts/report and 26,541 samples.
The header confirms CLOCK_MONOTONIC, 16 KiB user stacks and zero lost samples;
one out-of-order event is reported. Both bracketed UTC/monotonic receipts and
perf's reference clock agree within a 1.504 ms offset envelope. Map the profiled
second process's UTC phase boundaries into this measured envelope, count only samples inside
every endpoint offset, and compare logged monotonic elapsed values with their
UTC spans. This mapping assumes no intervening wall-clock jump; the first cold
build's elapsed and UTC span differ by about 20 μs. The observer step succeeds;
the original campaign still fails. Perf exits 130 after the collector requests
SIGINT and flushes readable data. Its current stop label does not independently
retain the kill command's status, so this archive is diagnostic attribution,
never performance or authored acceptance.

The profiled second process's first cold build with 1,391 files (id 48) spans
80.307 s and 4,019 samples: 3,932 native bridge,
55 main thread and 32 TypeScript descendant. The reachability interval id 50
has 1,459 native samples over 29.783 s; package routing id 51 has 2,042 over 41.731 s.
Count self samples only when their first resolved frame contains explicit
`DefaultHasher` or `core::hash::sip`; exclude generic rotate_left because other
hashers also use it. Those strict hash samples are 942/3,932 (23.957%) for the
cold build, 175/1,459 (11.995%) for reachability and 762/2,042 (37.316%) for package
routing. Oxc self samples are 524/1,459 (35.92%) in reachability and 151/2,042 (7.39%)
in routing. Allocation/copy self samples are 542/3,932 (13.78%). Canonicalization,
realpath or readlink occurs in 60/3,932 (1.53%) cold-build stacks and 3/2,042 (0.15%)
routing stacks. These categories can overlap in inclusive counts. Caller tails
still include unresolved/truncated frames even with larger stacks: visible
`current_consumed_fact` and `dependency_scan::resolution::canonical_key_inner`
calls do not prove complete callsite attribution. The simultaneous strace
archive's large syscall totals cannot establish the dominant unprofiled cause.
Do not introduce Carton/O_PATH changes or an observation cache on that evidence.

Exact [authored run 38152993522](https://github.com/ubugeeei-prod/vize/actions/runs/38152993522)
at `aaf051206778b1f189dcc51386e992eb342ee8b0` passes all 2,055 Canon tests
(one ignored), both literal original DefaultHasher collision/retirement controls,
the deterministic full first/secondary error regression and Clippy. Its original
editor campaign remains red with DELETE typecheck timeout. Artifact 11707498701
has archive SHA `5d9bcc252051b02ebaf210a650f295485f5babf504ac8e9865050ce8b86e02f2`.
Against the unprofiled original first campaign in run 38152025888, the complete
originalInputs and oracle objects are equal and the n8n revision remains
`e882e8a483f433facb47bab9b407d0ec00a81172`.

The unprofiled phase packets are
`n8n-cli-config/38152025888-1/authored-registry/stderr.txt` and
`n8n-cli-config/38152993522-1/authored-registry/stderr.txt`; the 80.307 s
profiled packet is separately retained at
`n8n-cli-config/38152025888-1/profile-authored-registry/consumer/stderr.txt`.
Actual source-build observations at
`differential/lsp-sessions/90763-1-kydSxJ/observation.json` and
`differential/lsp-sessions/93364-1-O3b7lo/observation.json` identify the same
`cargo build --profile ci -p vize` recipe and distinct exact binaries:
`ca1f9383ec3706c261e86043d2fa3069b9a99e39f1e4f638cebb46cc187a5163`
before and `c11537925b411ceb2c3dd7e73667899906b8f5b394161574f84e22ab3989889c`
after. Each complete captured `stderr.bin` equals its original unprofiled
phase packet, with SHA-256
`70d6069d3cfefb0413f3f0f234852be81be1d0e2a7d1639313b1bd1ba18103b0`
before and `4f0166e0d2e8223a3bdf8b6b5332e6b245def30d8601be4cebafd058ede824b6`
after. Source-origin reconciliation remains pending; these identities do not
grant authored acceptance.

| First 1,391-file build, unchanged native CI recipe | Preceding source | Private Fx bucket successor |
| -------------------------------------------------- | ---------------: | --------------------------: |
| Reachable dependencies                             |      28.958903 s |                 29.013039 s |
| Package routing                                    |      41.621513 s |                 35.865924 s |
| Complete cold graph                                |      79.168158 s |                 73.162841 s |

The observed first cold build is 7.59% shorter and package routing 13.83% shorter;
these are separate unprofiled before/after runs, not alternating-pair acceptance
or the 10x target. Later 1,391-file successor builds take 70.343/70.561/70.619 s. All graph
takeover/guard counters remain zero, and unchanged 10 s request retirement still
prevents publication. Continue investigating immutable computation cost while
preserving every original filesystem/config/declaration/overlay/retirement
observation and literal full-value control. The original 400-request shipping-release
paired run 38152993658 passes. Type-snapshot parity passes, but its separate
actual-CLI paired run 38152993582 fails with the complete degraded API warning
and `error handling method 'exit': EOF`; coordinate the existing Canon close/
semantic-handoff repair instead of suppressing stderr. No merge, release or
issue-completion credit follows from these partial receipts.

The read-only parser audit finds an existing operation-local
`ParsedDependencySources` packet, created in `context/build.rs` and dropped after
dependency registration. It keys the complete virtual path, source bytes and
`SourceType`, and its current hits skip only Oxc parsing; original observations
and callbacks still run. The host prepass, frontier collection and route
registration can share syntax only when their complete content and syntax equal
the walk's projected module. This equality is not guaranteed by a common path.
An exploratory exact-hit frontier projection could retain first-seen specifiers
from the existing complete occurrence packet and use the original collector on
every mismatch. No new cache variant or observation bypass is approved.

The final editor import rewrite needs complete ordered source spans, duplicates
and callback modes; a deduplicated occurrence packet cannot replace it. JS/JSX
syntax can also differ from the walk's TS default. Package reachability has its
own supplied/read source identity, and authored `TypeSourceSnapshot` entries
already have immutable singleflight; neither supports a path-only cross-owner
shortcut. Actual duplicate-parse counts remain unmeasured. These are bounded
pure-computation candidates for later measurement, not performance results.
