# Query-owned scratch memory for project navigation

Status: the bounded source pair passed. The composed configuration/Canon/component
successor, merge queue and released consumer acceptance remain required.

## Decision

Own one Oxc scratch arena within one existing synchronous project-navigation
worker query. Reset it after each complete source collector returns owned
`SymbolInformation`; drop it with the query. Use the existing parser, recovery,
semantic options, component/script/style/emit/slot collectors and ordering.
Keep the borrowed SFC input alive through those collectors, with the exact
filename/default parse options and original `Ok` acceptance / `Err` refusal.
Other Drawer callers retain their original fresh arenas.

This adds no persistent pool, cache, worker, pipeline stage or serialization.
The move into `workspace_symbols/vue.rs` is a separate move-only commit.
The parser delegation returns owned data; Rust lifetimes prevent arena AST
references from escaping into a reset. Complete descriptor JSON, parse-refusal
controls, retained owned Croquis debug values and complete symbol JSON after
resets cover the ownership boundary. Existing caller inputs/assertions remain.

## Evidence and limits

The original component source `fc4c7a8e43f2480b856e19baf4bf02c1c0f58918`
failed the unchanged Misskey 128 MiB gate at 128.0625 MiB in
[Full Check 38112485518](https://github.com/ubugeeei-prod/vize/actions/runs/38112485518).
The independent descriptor-borrow-only comparison also failed one after run at
128.6015625 MiB. Those failures are preserved.

One private trace of the actual MiMalloc recipe retained all 927 project sources.
Its first query requested 95,366,992 layout bytes and released 95,124,512 bytes;
Vue spans accounted for 76,674,183 of 93,917,228 per-source requested bytes
(81.64%). The counters include concurrent work and the observer, and exclude
allocator padding/metadata and native C allocations. They establish neither
exact live heap nor a leak or allocator-held residency. A dense physical sample
reached 129.36328125 MiB despite the original instrumented sampler reporting
116.90625 MiB. That counterevidence remains in the retained trace.

[Qualification 38116772018](https://github.com/ubugeeei-prod/vize/actions/runs/38116772018)
compared frozen `fc4c7a8e` to source `901984c57df421cc72a33fe9fc0157f7e53d2e27`
in before/after/after/before order with the original 40 edits, 20 file lifecycles,
128/384 MiB caps and real TSgo backend. Every original gate passed; dense physical
peaks matched the original peaks. Complete 287 diagnostic packets and 40 lifecycle
symbol replies matched in all four sessions, together with 16 independent
full-workspace query replies with UTF-16 ranges, emits, slots and malformed-source
refusal controls.
Only the authenticated copied fixture workspace URI prefix was translated.

| Run | Source | Peak RSS (MiB) | Peak process tree (MiB) |
| --- | --- | ---: | ---: |
| 1 | before | 120.63671875 | 245.4765625 |
| 2 | after | 122.4375 | 244.578125 |
| 3 | after | 121.3515625 | 245.3359375 |
| 4 | before | 123.20703125 | 244.35546875 |

Both baseline runs were green and the ranges overlap. This comparison does not
prove a meaningful RSS reduction or reproduce the prior failure. Phase wall
times and sampled process CPU ticks also overlap; production executables contain
no allocation counters or packet timestamps for a paired per-query attribution.
No 10x, cold-start p95, exact-heap or allocator-cause claim is made.

All affected library tests ran: Maestro 1,370 passed with three original ignored
controls; Croquis 469 passed, none ignored. Whole workspace and both affected
crate test-target Clippy checks passed with warnings denied, as did formatting.
The original ignored controls require a hydrated corpus shard, an idle-host
wall-clock benchmark and the Pkl runtime; they are not new exclusions.

The first campaign
[38116234413](https://github.com/ubugeeei-prod/vize/actions/runs/38116234413)
failed during the candidate build, before units or workload, because the carried
old helper expected a tuple instead of the current parser `Result`. Its exact
logs/source/executable artifact are retained. Source `901984c` corrects only
that API handling and an unused moved import.

## Delivery

Fourteen of the fifteen touched file preimages match actual main
`f3c340a0dfaeace5074e187a78bc936b96088005` byte-for-byte. The remaining worker
file contains the component owner's filtered search entry and post-collection
URI filter. Preserve that coherent owner's source when composing this change;
the qualified whole patch is not an identical-preimage independent main patch.

Record this decision on the existing issue with the shipping change. Replay
onto the coherent owner-controlled successor and its finite source authority,
then require exact-head complete Actions, the protected native Stack queue and
released consumer checks. The private pair does not close the current stack's
original RSS failure or provide merge/release acceptance.
