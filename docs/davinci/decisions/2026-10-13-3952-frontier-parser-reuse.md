# Exact operation-local parser reuse at the native package frontier

Issue: [#3952](https://github.com/ubugeeei-prod/vize/issues/3952).
Base: `e7ec9790a0ec5586588f97d21b8e5913ad01861c`, draft Stack #8607.
This bounded source proposal does not satisfy original n8n acceptance.

## Evidence and cause

The complete original n8n artifact `11717068412` from Actions run
[38178606898](https://github.com/ubugeeei-prod/vize/actions/runs/38178606898)
has verified ZIP SHA-256
`45d988a5184ccab24c72383f85013fad482072854ffd4db8a0f319d1782a2c31`.
Its first 1,391-file alias build takes 71,162.334053 ms; reachability takes
28,514.648095 ms and package routes 34,797.372262 ms. Original RunData
requests still retire at 10 seconds. All graph guards remain zero.

The earlier CPU-only capture `11707726205` has verified ZIP SHA-256
`70d055e9d4be2fc0ee9a80cc3e9a53b0eef1740e3b9dce422daec3a0ce43b720`.
Its original [attribution record](./2026-10-12-3952-native-graph-cpu-attribution.md)
retains Oxc self samples at 35.92% of reachability and 7.39% of package routing.
That profiled predecessor predates the Fx bucket change and cannot establish
current callsite cost or a speed result. Raw stacks retain truncated callers.

The actual source retains pure parser occurrences during this one cold build,
but frontier discovery invokes Oxc again for every newly scanned source.
The walk parses `module_source`; the frontier parses complete `file.content`.
These may differ even at the same virtual path. A shared path alone must never
permit reuse.

The separate occupancy artifact `11709776613` and allocation artifact
`11721795495` also match their complete recorded ZIP hashes. Allocation's
264 finish reports concern at most 22 facts and do not explain the large n8n
index. Both original failures remain required. This change duplicates neither
inline fact storage nor #8802's borrowed workspace symbol descriptors.

## Decision

First extract the existing frontier function into an ordinary module in its own
move commit. Then lend an existing occurrence slice only when the complete
virtual path, complete current source bytes and `SourceType` equal the retained
operation-local parser packet. The lookup is immutable: misses neither parse,
retain another source nor replace an existing source owner.

Both original collectors use the same AST visitor. Project the retained packet
into first-seen unique strings, preserving the original specifier collector's
order across different import/require modes and type-only declarations. The
complete original collector runs on every miss, changed content, syntax or path.
Cold observed builds supply the existing packet; legacy and incremental patch
callers supply no packet. No observations, resolver callbacks, budgets, stages,
source projections, features, owner retirement or request deadlines change.

The existing opt-in preparation trace reports numeric `original_calls`,
`actual_calls` and `exact_hits` at the existing frontier. `actual_calls` counts
actual fallback parser invocations. `original_calls` counts scanned files that
the literal original frontier would parse; it is not a measured earlier binary.
Their sum law is `actual_calls + exact_hits == original_calls`. No extra phase,
clock, AST owner, new flag or global parser cache is added.

## Qualification and remaining work

Three genuine Rust controls compare complete ordered collector outputs across
TS/TSX/JS/JSX, repeated strings in distinct modes, type import attributes,
ambient declarations, malformed syntax and empty modules; retain immutable
packet ownership; exercise equal-length edits, syntax/path mismatch and no
packet; and compare whole mixed-frontier package vectors and scanned identities.
These laws require source-built Actions execution. Local formatting and source
inventories do not constitute Rust or n8n runtime qualification.

The finite source counterpart binds reviewed production
`4c1f514a24bd47fe30124b5692866150032850fd` to e7 with 198 complete
before/after native bodies and the same 45 whole original workload bodies.
Semantic manifest SHA-256 is
`0844ba65e65048385bc779772f12d06a8b3e5012c396bd041545cc05a8df288e`.
It admits exactly seven production paths and authenticates both new files'
original absence. Complete regular Git blobs, all 486 before/after mutation
refusals and four missing/extra/duplicate footprint refusals pass locally.
The original inline manifest and its negative law bodies remain byte-exact;
its current-head guard accepts only the separate complete frontier receipt,
explicitly with no acceptance credit. Finite missing-only Git preparation
includes the new source pins for each actually selected authority law. All
four process/hydration controls pass with zero skips. Native and original
workload runtime execution remain pending on Actions.

TODO: run the unchanged original authored n8n workload on exact successor source,
retain complete raw input/buffer/oracle equality and every original failure, then
read actual parser call counts. Compare exact-head wall time under the original
recipe and caps. No speed claim, 10x-target claim, merge/release completion or
n8n acceptance follows before those Actions receipts exist.

## Exact existing-Stack composition

The narrow slice is composed once onto unchanged actual Stack #8607 top
`3dd6ae0707dc42302638257b86967d6a6ffe902f` (#8724), preserving the separate
move commit. Production has exactly the same seven-path footprint; the
existing default and allocation diagnostic feature shapes remain unchanged.
The named exact-parent counterpart now binds producer
`7a4a0b907ada40cd997e6b25865d5ea7c07ee791` with 210 native whole-body pairs,
the same 45 original workload bodies and every 31 predecessor helper pair.
Semantic SHA-256 is
`2161b814f41ba7e721f3af6680c5771017b8d45af53b901dd1d39498312ad3b2`.
The earlier 198-pair e7-only record remains a distinct local proposal.

Both immutable original inline/allocation manifests and every old negative,
replacement-object, mode, observer and process law remain required. Their
original success branches still qualify their frozen original producers; only
the actual-head guard can use this separately named complete frontier receipt.
No optional allocation or occupancy capture is repeated. Fresh exact child
Actions, original n8n deadline, actual parser counts and all source-built Rust
controls are required before any performance, queue or acceptance claim.

The local complete-body check first refused two predecessor workload carriers:
`current-baseline/inputs.ts` and `session-process.ts` already contain the
separately reviewed optional observation hooks in actual #8724. Preserve each
complete actual-top after body on both frontier sides, while retaining their
original before/after pairs in the immutable allocation authority. Neither
carrier changes in this slice; every original workload input/oracle/cap remains
required. Original e7 body hashes cannot be mislabeled as actual #8724 bodies.

The first exact child `6ac0556` has preserved actual Actions failures. Native
compilation refuses the new test's nonexistent OXC `SourceType::js()`; use its
actual JavaScript-module `SourceType::mjs()` without changing any input or
expected vector. The zero-warning JS gate also refuses unused
`actualProduction`; assert that complete actual footprint equals the frozen
receipt rather than suppressing the warning. Original n8n run 38354940240
fails during this prerequisite compilation, so there is no authored campaign,
new cold-build timing or parser-hit observation. Its existing compiler corpus
passes separately. Shared JS/tooling/playground setup additionally refuses the
original MoonBit archive with HTTP 403; that is a distinct infrastructure
failure, not a waived source gate. Fresh exact successor Actions are required.

## Actual unchanged original n8n receipt

Corrected `cee8926a79c639fe9a9c87862035765766677ca8` executes original
[n8n 38356398987](https://github.com/ubugeeei-prod/vize/actions/runs/38356398987),
with both optional diagnostic flags disabled. Artifact `11793920814` has
independently verified complete ZIP SHA-256
`814f6154bf7b3c0ba64e2c4d7012628e448bf02c0391255870892ba5c1256385`.
The authentic ordinary `cargo build --profile ci -p vize` binary has SHA-256
`9fdc3caa95125dba8b05028661ee73ba67ad0d6f28346a94dc08aa7691bf5e7a`.
Whole originalInputs and oracle objects equal the retained e7 packet, and n8n
revision stays `e882e8a483f433facb47bab9b407d0ec00a81172`.

First 1,391-file graph id48 takes 72,334.042068 ms: reachability
28,638.156643 ms and package routes 35,226.098529 ms. Its three existing
frontiers report original-call requirements/actual calls/exact hits as
1362/488/874, 23/2/21 and 0/0/0: 1,385 requirements, 490 actual calls and
895 exact hits. These prove actual reuse, not an earlier-binary parser count.
All graph guards remain zero. The original 10-second timeout diagnostic and
campaign failure remain. The separate e7 71,162.334053 ms observation cannot
establish a causal speed effect; there is no 10x, deadline or speed acceptance.

The same exact full Check 38356401897 additionally preserves actual old
MoonBit HTTP403 setup/Nix failures while its Rust job continues separately.
Inherit precisely already merged #8766 (`01fb9eaa`) and #8801 (`ea1fc59`),
including both decisions, all original regression/custody controls and their
complete fixture bodies. Preserve all incoming central decisions. Twenty-one
additional non-central CI pairs authenticate this finite cohort; each of the
210 native, 45 predecessor workload and 31 predecessor helper pairs remains
mandatory. No native body, original toolchain pin, compiler/core hash,
installer smoke/update/bundle operation or timeout budget changes in this
infrastructure incorporation. The four MoonBit regression files pass all
16 controls locally with zero skips. No optional capture is repeated, and
fresh exact successor source/native qualification remains required.
