# Inline singleton storage for native fact indices

Issue: [#3952](https://github.com/ubugeeei-prod/vize/issues/3952).
This candidate is a separate draft child of
[diagnostic PR #8688](https://github.com/ubugeeei-prod/vize/pull/8688),
whose minimum source parent is `b63d18511ce087e5ef9f6b1da17031f258ef7276`.
The actual branch parent is the repaired
`0d0c47b87cc6812f6897c4d354c2d432371ae606`; its native producer and original
workload bodies remain identical to that minimum parent. Linux tooling job
`114535135317` passes all 16 hydration, owned-process, diagnostic and literal
workflow/document preservation controls, including all four Linux process laws.
Exact-parent Check `38161304606`, original 400-provider `38161304519` and native
backend phases `38161304623` all pass. The original authored failure below is
retained separately; the optional capture is not repeated.
The actual reviewed source is `f3dbbedad2298dd0dd207e29457651068ea145b1`.
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
the retention module's test declaration and the new `tests/inline_bucket.rs`. The immutable
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

The original authored command builds with `--profile ci`. Its unchanged Cargo
profile inherits `dev` with optimization level 0, debug assertions and 256 codegen
units. The original 400-request pair uses the shipping release recipe. Keep both
recipes and their separate qualification: a release result cannot substitute
for the original authored deadline or establish a speed ratio between profiles.

The actual repaired parent runs the original campaign in
[38161304560](https://github.com/ubugeeei-prod/vize/actions/runs/38161304560).
Artifact `11710002695` has archive SHA-256
`90f30bab52790c1cb222315c186b41f153086f9f3e9f4a06a42fbb00abd015cd`.
Its producer receipt binds source `0d0c47b87cc6812f6897c4d354c2d432371ae606`
to the unchanged recipe and binary SHA-256
`5a143b63b4e3fba4642179e79bd5635de27da0c6509387a28f43d960b5d676ef`.
The first complete 1,391-file cold build (id 48) takes 72,665.090965 ms with
both graph guards zero; the original authored typecheck deadline still fails.
The complete raw stderr and original input/oracle packets are retained for the
future unchanged-workload comparison. This is a failed baseline, not acceptance.

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

## Native test placement repair

The first child head `9ec21af5a9777b50f3bcfca17df75b3a7c09f3e0` fails
Rust compilation with E0624: the cutoff oracle calls the existing private
`retention.rs::contains_before` from a sibling test module. Preserve the complete
failed logs from original authored job `114539086990`, affected Rust build
`114539237975` and full source coverage `114539196423`; no runtime or resource
qualification is claimed from their aborted tests.

Declare the new control as a test child of `retention.rs`, following its existing
private-bucket control placement. Every production function body and visibility,
all new cutoff assertions and the whole old `tests.rs`, private-bucket and witness
bodies remain unchanged. Restore the original generated Carton site at line 204.
The source successor still requires exactly four producer paths and all 196/45
complete bodies; the two actual module-body identities and reviewed source
identity change explicitly. Fresh full native, original authored, 400-provider
and full warm/Misskey controls remain required after this compile repair.

The failed native-test head separately passes full Vue parity job `114539196401`
in [38162843462](https://github.com/ubugeeei-prod/vize/actions/runs/38162843462).
Its authenticated build receipt records the original
`cargo build --profile ci -p vize --features legacy` recipe, exact source
`9ec21af5a9777b50f3bcfca17df75b3a7c09f3e0` and binary SHA-256
`54c44fbc98318f20469765f1163bec9daea109c6154d36ddb8e164e2efe51d93`.
Artifact `11710948289`, archive SHA-256
`a592f0044798222ad8560fffb6d8611d75f09e211dd739e54ee7345d9d08ceeb`,
retains the complete original scale-1, 40-cycle Misskey packet and 63 samples.
At `file-lifecycle-0`, actual server PID `93634` peaks at 130,328 KiB
(127.2734375 MiB), below the unchanged 128 MiB cap; the full tree peaks at
351,636 KiB with at most three processes. This is genuine warm/RSS evidence
for that failed native-test head, not repaired-head qualification or proof
that the bucket change caused a memory improvement. Repeat the original gates
on the genuine compile repair before adopting it.
