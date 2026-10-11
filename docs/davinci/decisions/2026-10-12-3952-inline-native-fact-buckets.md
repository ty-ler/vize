# Inline singleton storage for native fact indices

Issue: [#3952](https://github.com/ubugeeei-prod/vize/issues/3952).
This candidate is a separate draft child of
[diagnostic PR #8688](https://github.com/ubugeeei-prod/vize/pull/8688),
whose minimum source parent is `b63d18511ce087e5ef9f6b1da17031f258ef7276`.
The actual reviewed source is `ab497e944cbfb57952db8dad1f787b0f6df5cd9b`.
The preceding [Linux occupancy receipt](./2026-10-12-3952-native-fact-occupancy-diagnostic.md)
counts the whole full-key index, unlike its explicitly incomplete prospective
suffix histogram. At 1,391 files, all 1,223,853 full buckets contain one index.
The current index allocates a separate vector for each such bucket.

## Decision and preserved authority

Store the first index inline. A private `FactBucket` has an empty initial state,
an inline singleton and an allocated collision vector. The original insertion
still hashes the entire `InputStamp` through the same operation-local Fx map
hasher and compares every complete fact through equality before insertion.
Only a distinct complete fact with the same full hash promotes the singleton
to a collision vector. No coarser key, path cache, source digest, parser,
observation, configuration probe or owner changes.

The original ordered stamp vector, full owner and route allocations,
qualification, cutoff, owner retirement, witness borrow and successful/error
return values stay under their existing operations. Clearing and rebuilding the
index on retirement naturally reconstructs singleton storage. Borrowed slice
iteration preserves the existing collision lookup and diagnostic statistics.
The optional diagnostic's cap, complete/prefix distinction, event fields and
opt-in boundary are unchanged; no repeat capture is requested.

Literal existing `private_bucket.rs` and `witness.rs` controls remain byte exact.
Three new controls prove natural same-fullhash collisions between unequal
complete nested routes; independently equal route/owner allocations deduplicate
without replacing the first owner; a linear complete-equality oracle verifies
all ordered indices and cutoffs; actual retirement/reinsert retains configuration
and unowned negative facts; successful, error and unwinding borrowed operations
keep the original complete vector and collision allocation. Observation disabled
and incomplete qualification remain covered. The existing population helper
accepts either vector or inline borrowed slices; its empty-map fixture only
adds the explicit vector type needed after making the helper generic.

The finite source successor authenticates all preceding 195 whole producer
bodies and the added test body, plus all the same 45 original workload bodies.
Its actual delta is precisely four paths: `consumption.rs`, `population.rs`,
the test-module declaration and the new `tests/inline_bucket.rs`. The immutable
195-body graph and exact-parent diagnostic authorities remain unchanged.
Their original positive graph control authenticates the pinned reviewed Git
bodies, while the successor control authenticates the actual current head's
complete 196-body source. Missing, extra or duplicate producers, changed Git
modes and every complete before/after body mutation still refuse. Twenty-four
existing and successor authority controls pass locally; Rust execution belongs
to fresh Actions.

## Performance and resource qualification

Removing singleton heap allocations may increase the map's per-value storage;
the enum layout and allocator/runtime effects require measurement. No speed or
RSS improvement is claimed from the whole-population count or source review.
Run the original flag-unset n8n 1,391-file workload with its original bytes,
oracle, 10-second typecheck deadline and full source/binary identities. Report
its genuine cold timing separately from the 10x target. Preserve the original
400-request pair and every native backend law.

The original full warm/Misskey churn gate is also mandatory. On unchanged-main
PR #8690 [Check 38158377107](https://github.com/ubugeeei-prod/vize/actions/runs/38158377107),
job `114525951530` fails its existing 128 MiB server ceiling. Artifact
`11709243781` retains the complete packet, with archive SHA-256
`6b3484d7219fe7e64a2117611ae4862602c3554091aab563cd215a09ad0954aa`.
Its actual source checkout is
`a16c6ed1a6fdcf13552c81340abe0b1f2ef806a2`. At `file-lifecycle-0`, the actual
Vize server PID `84849` peaks at 131,412 KiB (128.332 MiB), exceeding the ceiling
by 340 KiB. The packet records the server and two native child PIDs separately;
the server gate is not an aggregate worker-memory failure. All 40 original
churn cycles run with scale 1. Keep these bytes, sampling, cycles and ceilings;
do not raise budgets, shorten workload or retry away this failure.

TODO: obtain exact-head Actions controls, original400, authored n8n and full
warm/churn receipts before any adoption or merge decision. A cold gain cannot
establish warm RSS closure. Parent #8520 remains draft with its authored timeout
and separate CLI stderr failure, so no merge, release or issue-completion credit
is available yet.
