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
`a6031f46f80d88b596b16dfb0aa79e4090af844b` with 210 native whole-body pairs,
the same 45 original workload bodies and every 31 predecessor helper pair.
Semantic SHA-256 is
`18b3c44b35648f7918e2762b5f9f802088eeb2f75967a4693d173932316aa6e1`.
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
