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
`population.rs` is added; the other 193 producer bodies stay unchanged.
Manifest SHA-256 is
`da67c0b266a29d54ee9561d7dc7dbe739e621cbc66e796ebeee2bdefbb009adc`.

The initial child PR's original400 source binding in
[run 38156985618](https://github.com/ubugeeei-prod/vize/actions/runs/38156985618)
honestly refuses `population.rs`: its actual parent baseline is `aaf0512`,
so the production delta has two paths, while the original `fc551dc` authority
requires the complete 195-path delta. Preserve that original qualification.
Add a separate exact-parent counterpart that permits only these two actual
changed paths but verifies all 195 whole baseline/current bodies (193 unchanged,
the exact former carrier body and literal absence of the new helper before),
plus all the same 45 original workload bodies. Every omitted, extra or duplicate
producer and every complete body change refuses qualification. Retain this
named counterpart in the source receipt; it grants source qualification only.
Six original and exact-parent authority controls pass locally.

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

Source and observer review are complete. The collector treats only exact
`ENOENT`/`ESRCH` after a stat read as process disappearance; mismatched birth,
executable, permissions and every other error still refuse. Actual Linux
controls cover these post-stat races. Full equality, ordered ownership and
retirement laws and an unprofiled comparison on the unchanged workload remain
required for any later adoption.

## Actual Linux receipt

The single optional capture in
[run 38156995382](https://github.com/ubugeeei-prod/vize/actions/runs/38156995382)
completed at exact checkout `3f479326611b93adec3cc86848b3d012c1baf748`.
Canon passed 2,058 controls (one ignored), Clippy passed, and all 11 observer
controls passed on Linux with none skipped. Compiler full-source custody and
fixture checkout passed. The unchanged first authored campaign failed; the
second capture step succeeded and retained its consumer exit `1`. The overall
workflow therefore remains failed. This is diagnostic evidence only, with
`acceptanceCredit=none`.

Artifact `11709776613` retains both complete raw campaigns and the diagnostic
receipts. Its downloaded archive is 5,191,071 bytes and has SHA-256
`7842f8c9a3ee30e5e3842082dd8d27d78a3f05ab737621ad3ad190325632bdfe`,
matching GitHub's artifact digest. Within
`n8n-cli-config/38156995382-1/diagnostic-native-fact-buckets/`,
`owned-process.json` authenticates provider PID `93955`, its complete Linux
birth stat, exact executable and clock interval. `source-binary.sha256` records
`target/ci/vize` as
`31a7c6b1614e337e94783117def9c966bc6e3ec8f077c028fa65f8c90997df4c`.
`source-locks.sha256` records `Cargo.lock` as
`ff89684d784eef5066edb7596fae1aaeac2331295d62891531d25a2c70f74c8b`
and `pnpm-lock.yaml` as
`12e66667fc82ac9a5b72d1e9ab2aa59f7c1466ea8be689f17a67678bf31a0915`.
`observations.json` retains all nine original numeric event lines and both
complete input/oracle packets. Those packets match exactly; the first has no
diagnostic event. Its complete stderr SHA-256 is
`9d7dbcf61ba89f5e9a3a826923d939b1afcb16dbe074bb163a25fe716cae0af8`.

Every observed full index has maximum occupancy `1` and zero collision pairs.
These are whole-index counts. The last-three-components histogram is a separate
prospective prefix, whose completeness must be read independently:

| Build              | Whole facts / full buckets | Prospective facts / keys | Prospective maximum / pairs | Prefix complete | Counting cost                |
| ------------------ | -------------------------- | ------------------------ | --------------------------- | --------------- | ---------------------------- |
| 1 file             | 53 / 53                    | 53 / 27                  | 10 / 69                     | yes             | 41 us                        |
| 419 files, first   | 190,632 / 190,632          | 179,188 / 131,072        | 66 / 219,998                | no              | 100,172 us                   |
| 1,391 files, first | 1,223,853 / 1,223,853      | 311,833 / 131,072        | 69 / 2,328,170              | no              | 181,360 us                   |
| 1,391 files, later | 1,223,853 / 1,223,853      | 311,833 / 131,072        | 69 / 2,328,170              | no              | 189,484; 194,683; 185,008 us |
| 419 files, later   | 190,632 / 190,632          | 179,188 / 131,072        | 66 / 219,998                | no              | 121,211 us                   |
| 1,390 files        | 1,223,821 / 1,223,821      | 311,831 / 131,072        | 69 / 2,328,168              | no              | 196,416 us                   |
| 1,389 files        | 1,223,818 / 1,223,818      | 311,829 / 131,072        | 69 / 2,328,165              | no              | 170,451 us                   |

The first 1,391-file packet is timestamped
`2026-10-11T17:01:24.833200Z`. Its prefix has 5,477 buckets over eight facts,
containing 140,971 prefix facts; the first 419-file prefix has 414 such buckets
and 10,362 prefix facts. Both stop at the existing key cap. These are not
whole-population suffix statistics. Do not enlarge the cap, repeat the capture,
adopt a suffix key or claim that a promotion threshold is justified by this
incomplete prefix.

The original flag-unset 1,391-file cold `alias_build` interval is
`73,130.861536 ms`; the optional second process records `70,113.044316 ms`.
These executions have different cache/order and diagnostic conditions and are
not a qualified performance comparison. Both keep `graph_takeover=0` and
`graph_guard=0`; the first campaign still fails its original typecheck deadline.
At exact successor `b63d18511ce087e5ef9f6b1da17031f258ef7276`, the
[original400 pair](https://github.com/ubugeeei-prod/vize/actions/runs/38159508543)
passes. Its complete `warm-pair/workflow-source.json` authenticates actual
baseline `aaf051206778b1f189dcc51386e992eb342ee8b0`, precisely two production
paths and the named diagnostic qualification with all 195 whole source pairs
and 45 original workload bodies. Artifact `11708929716` has archive SHA-256
`b55dc4d721470b4d33bf5fafa9929f6e1b419fe22f924c215f00e1dc4274f56b`,
matching GitHub's digest. This source and workload qualification does not turn
the original authored failure into acceptance.

The same successor's `check-js` job `114529289956` reports eleven
`no-floating-promises` warnings on observer test registration. Explicitly
mark only the eleven Node test-registration promises with `void`; keep every
test body, process refusal, raw event, assertion and Node runner unchanged.
All seven portable observer controls still pass locally, with four Linux laws
left for fresh Actions. The exact native backend phases in
[38159508554](https://github.com/ubugeeei-prod/vize/actions/runs/38159508554)
also pass, and all four PR Rust test shards pass. No optional occupancy capture
is repeated.

The same head's tooling checks identify two observer delivery defects. Preserve
the complete CPU/parser section in a linked companion, with a byte-exact split
control, so the main record stays below 350 lines. Extract the original five
contiguous authored-editor setup/verification steps into a local composite
action. A deep-equality control retains their complete command order, conditions,
shell (`bash -e {0}`, as recorded by the original Actions), environment and
working directory, along with every other first-campaign step. Move only the
optional diagnostic's unchanged observer-control command into its existing
script, keeping the workflow below 350 lines.

The tooling runners use shallow checkouts and lack the diagnostic authority's
pinned parent Git object. Add one coordinated line after the existing tooling
plan generation to prepare only the actual shard's named source authorities.
Validate their full frozen SHA identities, check existing complete commits,
fetch only missing exact SHAs with `--no-tags --depth=1`, then refuse if any
complete object remains unavailable. The current source/byte/mode authorities
are unchanged. No broad history or skipped qualification is introduced.
Literal controls cover unrelated shards, present commits, missing commits,
malformed plans/identities, original process errors, failed fetch and falsely
successful incomplete fetch. The normal tooling test imports these controls and
all original eleven observer laws, allowing fresh Linux execution without
repeating the optional original-workload capture. CI lane clearance preserves
its separate Docker observer clause; the combined workflow stays at 350 lines.

TODO: investigate the current singleton bucket's per-entry vector allocation
as a narrow candidate. Any proposed storage change must preserve the existing
full hash, complete equality, ordered stamp vector, owner allocations, negative
probes, cutoff and retirement. No production adoption or speed claim follows
from this receipt.
