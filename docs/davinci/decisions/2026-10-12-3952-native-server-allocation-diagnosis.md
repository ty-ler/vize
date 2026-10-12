# Bounded allocation diagnosis for the original Misskey server

Issue: [#3952](https://github.com/ubugeeei-prod/vize/issues/3952).
This is a local review proposal. It authorizes neither a new capture nor a
performance adoption. PRs #8520, #8688 and #8703 remain draft and unqueued.

## Exact repaired-head results

The published inline-bucket compile repair is
`e7ec9790a0ec5586588f97d21b8e5913ad01861c`. Its PR Check
[38178606904](https://github.com/ubugeeei-prod/vize/actions/runs/38178606904),
native backend phases
[38178606864](https://github.com/ubugeeei-prod/vize/actions/runs/38178606864)
and original 400-provider pair
[38178606836](https://github.com/ubugeeei-prod/vize/actions/runs/38178606836)
pass. The 400 archive is artifact `11716308809`, SHA-256
`45ab0bbf74b82b0d73ce36a114ced9065863db7f31089f6d4cad91d37ad9c475`.
All three new inline controls and the original full-equality, cutoff,
retirement and witness controls actually run successfully on Linux.

Full [Check 38178605986](https://github.com/ubugeeei-prod/vize/actions/runs/38178605986)
fails. Vue parity job `114586195127` retains the complete original Misskey
packet in artifact `11716363269`, archive SHA-256
`63326bc94f7f1b8808a79ce0d425fb451305fb6d248a89d0185d38e326fd84f2`.
The original recipe is `cargo build --profile ci -p vize --features legacy`,
with actual binary SHA-256
`87b420bb18019beb5e8d3c090744f49688980ff7c132827ac5ac7b87624d516b`.
Actual server PID `93571` peaks at 132,316 KiB (129.21484375 MiB),
1,244 KiB above the unchanged 128 MiB cap, at `file-lifecycle-0`.
The whole tree peaks at 357,300 KiB. The same frozen Misskey revision
`810faa8e5db4bbf9d6d408a61df148559340ee99` has 583 Vue and 888 Vue/TS
files; all original 40 edit cycles and 63 RSS samples run at scale 1.
The previous 9ec head's 127.2734375 MiB PASS remains separate. Their
production bodies are identical except test declarations, so this pair
does not establish a bucket-storage effect or a repaired-head success.

Original [n8n 38178606898](https://github.com/ubugeeei-prod/vize/actions/runs/38178606898)
also fails its unchanged 10-second authored typecheck deadline. Artifact
`11717068412` has archive SHA-256
`45d988a5184ccab24c72383f85013fad482072854ffd4db8a0f319d1782a2c31`.
The actual original `cargo build --profile ci -p vize` binary is
`bcba0e263e1fbda33829d8120058b5acb14401632cdacf8761aa779d6c4f5b6e`.
The first complete 1,391-file alias build (id 48) is 71,162.334053 ms;
reachable dependencies take 28,514.648095 ms and package routes
34,797.372262 ms. All graph guards are zero. Complete original input,
buffer and oracle packets match parent 0d0c; the optional occupancy event
is absent. This observation neither meets the target nor proves causation.

The full Check has separate preparation failures. Clippy/native tests
and source coverage lack pinned ElementPlus preparation supplied by
actually merged #8690 (`fd8ab9eab6473ee8d8fa243bb418165067ac50cb`);
source coverage also exposes an old native-denial law repaired in actually
merged #8701 (`055a1dc5b81d6dc5bb58997b38dcfbb77eeed469`). Compose fresh
main after preserving these failed packets; keep all original assertions.
Full `test-scripts` job `114586195051` lacks the exact frozen aaf/b63/6b/f3
Git objects; the full JS report correctly fails its dependency. The live
nontruncated GitHub b63 tree contains both the original workflow (blob
`6161d302b9cc3eade4ef60205d8315cecf3e68a5`) and decision record (blob
`4fbffd9a00eb1cf948aa784ce41be723b64a65e8`). Its misleading shallow-worker
missing-path stderr does not justify changing those pins or old bodies.
A separate finite full-tooling object-preparation repair remains required.

The first optional diagnosis at exact `851223b5667b87d87ac7bd8dc4df5a093d3065db`,
[38187483671](https://github.com/ubugeeei-prod/vize/actions/runs/38187483671),
fails before Rust compilation or either workload arm. Its 27 Node laws pass,
but the retained original inline guard cannot read the complete b63/f3 objects.
The whole job log has SHA-256
`904ccaffd237cf4c523dc8e90fb1f54a813ad88ccd17c4f7c29132befaa5187f`.
There are no first/second binaries, receipts or workload measurements. The
artifact step also fails because the campaign has not started. The repair
uses the existing finite source helper with the actual selected inline and
allocation-source law plan before those laws run. Both manifests determine
every required historical object; the helper keeps its original missing-only,
depth-one, no-tags fetch and hard refusal behavior. All original law bodies,
workload bounds and native producers remain unchanged. A new immutable-head
campaign requires separate review; this setup failure supplies no acceptance.

## Two distinct binaries and unchanged original workload

The first arm rebuilds the frozen e7ec source with its exact original CI+legacy
recipe and authentic new binary SHA/receipt. The historical 87b420 executable
itself was not retained, so it cannot be presented as a byte-identical replay.
All native allocation, preparation-trace and occupancy flags are unset.
Its fresh result remains separate from the retained e7ec RSS failure.

The second arm builds the reviewed diagnostic source with
`cargo build --profile ci -p vize --features legacy,allocation-diagnostic`. Its separate
diagnostic-only receipt cannot satisfy the ordinary build receipt validator.
The existing `ProfilingAllocator<MiMalloc>` remains the actual allocator;
only its existing counters are enabled. A distinct nondefault CLI
`allocation-diagnostic` feature requires the existing `profiling` feature and
forwards to an empty Canon `allocation-diagnostic` feature. These two exact
whole-manifest successors leave default, legacy and profiling-only graphs
unchanged. All native diagnostic modules, fields and calls compile only under
the new feature. A compile-time original field-shape law preserves the default Phase
layout, and separate feature tests plus diagnostic packets report actual sizes.
No new allocator, profiler reset, global timing profiler or heaptrack
interposition is proposed.

Both arms use the whole original test and lifecycle bodies, four complete
authored buffers, selected fixture manifest, provider bytes, source controls,
40 edit cycles, 63 causal sampling fences and every original budget.
The existing before-spawn input hook passively authenticates the fixture
and buffers. The baseline flag stays unset, so it adds no completion queries.
A separate observer captures complete client/server/stderr bytes and their
monotone chunk timestamps, actual parent/PID/birth/executable identity and
server smaps after each existing RSS sample. It sends no RPC, starts no
server or sampler and kills no process. Whole client vectors must match
between arms after physical fixture root relocation and normalization of exactly
one initialize request’s numeric `params.processId`, which must equal that
arm’s authenticated owner parent PID. Wrong, missing, duplicate or additional
PID fields refuse comparison. Query IDs, order and every server response and
diagnostic packet remain exact; any cancellation-stream difference is retained
as an honest refusal rather than normalized away.
The first arm’s native binary retains the unprofiled original source and recipe,
but this passive JavaScript driver instrumentation can change scheduling and
timing. Its fresh metrics are diagnostic observations with no untouched-CI
performance, RSS or causal credit.

Missing or reused PIDs, changed executable metadata, foreign providers,
missing smaps, truncated streams, missing owner close, incomplete inputs,
or changed 40/63 control bounds refuse diagnosis. ENOENT/ESRCH can label
proven disappearance; they still cannot produce complete capture or zero RSS.
The ordinary flag-unset helper path retains its existing launch, raw-capture,
baseline, sampling and report behavior.

## What the measurements can establish

The diagnostic records complete existing requested/released layout-byte
counters at LSP begin/end and before/after each existing preparation phase.
These are global overlapping windows with observer and concurrent-thread
costs. Every counter must be present and monotone, and each complete phase window
must remain within its actual owner’s begin/end totals; resets and impossible
windows refuse the packet. Storage packets must retain their diagnostic-only
and no-acceptance markers.
They do not prove allocator coverage, allocation lifetime or exclusive
callsite cost. Net requested/released bytes are not live heap bytes or RSS.

At the existing `NativeFacts::finish`, an immutable optional scan records
actual fact/vector lengths and capacities, map length and usable capacity,
empty/singleton/collision counts and collision-vector lengths/capacities.
Actual `size_of` values include the enum, old Vec and both map pairs; a
separate owned Vec first-push probe reports its requested capacity.
Usable map capacity is not the raw bucket count or allocated map bytes;
allocator size classes, control bytes and Arc/path allocations remain unknown.
The scan and probe contribute explicit diagnostic observer overhead.
Full hash/equality, ordered facts, first owner identity, cutoff, retirement,
qualification and successful/error/unwind witness operations remain original.
The prior whole-population occupancy capture is not repeated.

The separate optional Actions workflow checks out the exact requested head,
prepares only the two named full source objects and original pinned Misskey,
and uses the original 32-vCPU runner, Rayon 4 and scale 1. Its first branch
execution requires an explicit `diagnostic:allocation` label event on this
owned same-repository PR; no synchronization event repeats a capture. Existing
Check, n8n, native and original 400 workflows remain unchanged.

The runner creates a raw replacement-disabled e7ec worktree, qualifies all
original 196 native bodies and mandatory 45 workload bodies plus the finite
allocator and diagnostic source closure, and archives full before/after bodies.
Both builds share dependency artifacts. Before the second build, it retains
the actual first executable, ordinary receipt and complete source/recipe
identity. The second executable and separate diagnostic receipt are retained
independently. Each arm invokes the whole original test once with its original
300-second test timeout and a separate 330-second orchestration bound. Whole
command streams and actual exits remain available. A complete first-arm RSS
cap failure can proceed to the diagnostic arm, but final workflow status still
fails the original gate. Incomplete capture refuses the pair without retries.

The finite source manifest binds the actual reviewed producer source
`0d3697652c7a84e2724c232e4b095b5bc5021954` to frozen e7ec: 208 native
whole-body pairs, all original 45 workload pairs and 31 bounded helper pairs.
Its semantic SHA-256 is
`090c84a8e9066170cdc261f164f42c2a746a442c6b269368b4f44b800f382f2d`.
All original 196 producers and the original 196/45 manifest remain mandatory;
the old manifest retains whole-file SHA-256
`0eb167a2811ad25303d53d4e8ac72f297a439f0bfa5368f309ca7622c2284ada`.
Exactly nine native paths and 35 complete changed source paths are admitted.
Raw replacement-disabled Git modes and before/after bodies are required;
genuine replacement-object borrowing, unknown/missing/duplicate producers,
symlink/executable modes and every complete body mutation refuse qualification.
The original f3 historical inline-bucket positive and complete negative laws remain
byte-exact. Its actual-head guard accepts the unchanged original receipt or the
separate complete diagnostic receipt, explicitly with no acceptance credit. The
finite selected tooling shard prepares only its named original and reviewed
diagnostic objects; missing bodies still refuse full source qualification.
The old SDK, default eligibility and 400-provider authorities remain unchanged.

TODO: obtain independent finite source and runner review before remote
publication or execution. Rust feature/layout and
native controls await actual Linux Actions; local parser/source controls do
not substitute for them. Fresh-main source/native/original400, original n8n
and full warm/Misskey gates remain required for adoption. This optional
diagnosis carries no acceptance, speed or RSS credit.
