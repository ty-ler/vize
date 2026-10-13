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

TODO: run the unchanged original authored n8n workload on exact successor source,
retain complete raw input/buffer/oracle equality and every original failure, then
read actual parser call counts. Compare exact-head wall time under the original
recipe and caps. No speed claim, 10x-target claim, merge/release completion or
n8n acceptance follows before those Actions receipts exist.
