# Bounded native fact occupancy diagnostic for #3952

Issue: [#3952](https://github.com/ubugeeei-prod/vize/issues/3952).
The published independent [PR #8520](https://github.com/ubugeeei-prod/vize/pull/8520)
remains at `aaf051206778b1f189dcc51386e992eb342ee8b0`, draft and unqueued.
Its original authored campaign fails the unchanged 10-second typecheck deadline.
All 2,055 Canon controls, the original 400-request paired campaign and native
backend phases pass at that exact head; the separate CLI snapshot still fails
with the complete degraded API warning and native EOF. These partial receipts
do not establish acceptance, merge or release completion.

The local diagnostic source commit is
`6b665a1e93d59f35ced1be13c30168d86c919aeb`. Its finite qualification contains
195 whole before/after production bodies against immutable original
`fc551dc09faaa3187cd37a3a02cb94ebab0c3352`, plus the same 45 complete original
workload bodies. Only the preceding `consumption.rs` after body changes and
`population.rs` is added; all other preceding 194 source axes stay intact.
Manifest SHA-256 is
`da67c0b266a29d54ee9561d7dc7dbe739e621cbc66e796ebeee2bdefbb009adc`.

## Decision and source boundary

Keep the qualified producer and failed packets. Before considering a coarser
private index, count actual retained facts in an independent optional diagnostic
producer based on `aaf0512`. Do not infer actual occupancy from filenames or
change regular insertion, observation, full equality, cutoff or retirement.

Only two Rust source bodies change: `context/build/consumption.rs` and its new
`consumption/population.rs` under
`crates/vize_canon/src/corsa_bridge/vue_dependencies_alias/`. The former adds an
explicit `VIZE_DIAGNOSTIC_NATIVE_FACT_BUCKETS=1` check at the existing `finish`.
With the flag absent, the original return value, ordered stamp vector,
qualification, full index and trace output remain unchanged. With the flag set,
the latter borrows those immutable stamps and the actual existing full index,
then emits one numeric-only event with the actual processing PID and counting
cost. No new pipeline stage, per-fact callback, filesystem probe, parse or
resolver owner is introduced.

Full-index statistics count its actual bucket lengths without rehashing source
bodies. Prospective statistics count Fx-hashed last-three normalized path
components of both input and optional owner, including the owner's role.
`None`, component tags, parent components and non-UTF-8 names remain distinct.
The prospective histogram is bounded by 131,072 distinct keys and 500,000
processed facts. Allocation refusal or either cap yields `complete=false` and
the exact processed prefix. Full retained facts remain unchanged and are counted
separately. No histogram supplies identity or qualification authority.

Literal controls cover independent equal owner and route allocations, natural
coarse route-write collisions, all roles and unowned facts, normalized and parent
components, ordered duplicates, exact limits and explicit prefix
refusal. Capture preserves the complete original vector, map and allocation
pointers. Negative probes and actual owner retirement remain controlled by the
original `NativeFacts` operations, with configuration owners retained.

## Independent capture and evidence limits

The workflow dispatch input defaults to false. The original first authored
campaign runs with the diagnostic flag unset and retains its complete raw
packets and failure. Only explicit dispatch enables a second execution of the
same original provider and workload. The original 600,000 ms campaign bound,
10-second requests, source bytes, oracle and resource caps are unchanged; the
optional wrapper has a separate 660-second observer bound.

Authenticate the second provider using its actual session PID, exact checkout,
Linux executable and full process stat before accepting events. Every event
must identify that same PID. Retain source/binary/lock digests, command, clock
receipts, both complete input packets, raw stderr and consumer exit status.
Require the second complete input/oracle packet to equal the first and refuse
diagnostic events in the first packet. Cleanup may signal only the authenticated
PID with unchanged birth identity and executable; retain the cleanup command
status and signal request separately from successful termination.

The observer's output explicitly records `diagnosticOnly=true` and
`acceptanceCredit=none`, including partial histograms. A successful capture
cannot replace the original authored failure, CLI stderr gate, source-origin
reconciliation or any full protected-queue qualification.

Local Node and four complete-source authority controls pass; four Linux-only
process laws and the actual Rust controls still belong to Actions. Source and observer review are complete. The collector treats only exact
`ENOENT`/`ESRCH` after a stat read as process disappearance; mismatched birth,
executable, permissions and every other error still refuse. Actual Linux
controls cover these post-stat races. Publication and capture are pending. TODO: inspect actual
1,391-file populations and counting cost before proposing any bounded promotion
strategy. Full equality, ordered ownership and retirement laws and an unprofiled
comparison on the unchanged workload remain required for any later adoption.
