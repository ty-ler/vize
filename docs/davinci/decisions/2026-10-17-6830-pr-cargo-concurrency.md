# Trial more Cargo build slots for PR Rust cohorts

Tracked in [#6830](https://github.com/ubugeeei-prod/vize/issues/6830).

Set `CARGO_BUILD_JOBS=24` only for pull-request executions of `pr-rust-shard`.
Merge-queue workers retain 12, including nested Cargo invoked by their tests.
Keep the 32-vCPU runner, nextest 16, libtest 4, package roots, features, target
selection, profiles, tests, cancellation and cache policy. The archive producer
and Clippy job retain their existing settings. Keep 24 after the first hosted
trial passed without dropping cases; this observation does not establish a
causal speedup or the five-minute whole-PR maximum.

## Evidence for trying 24

The [#9209 Compiler job](https://github.com/ubugeeei-prod/vize/actions/runs/38929000438/job/117067972586)
and [#9216 Compiler job](https://github.com/ubugeeei-prod/vize/actions/runs/38929037171/job/117068097734)
passed the same 7,167 Compiler cases, within identical 18,209-case Rust inventories.
Product Rust inputs and the 19 packages logged as compiling were unchanged.
Cargo took 96 versus 231 seconds; nextest took 102.480 versus 106.075 seconds.
Their final-report tails were 10 and 9 seconds. The slow run lacked CPU/memory
telemetry, so these observations do not identify the cause of its build variance.

The retained Cargo HTML from [queue run 38932534797](https://github.com/ubugeeei-prod/vize/actions/runs/38932534797)
records jobs=12/ncpu=32, 465 dirty units, 63.06 seconds of compilation and 43.76 seconds
with ready work waiting. Time-weighted CPU usage was 34.8%, peaking at 49.1%.
Maestro's lib-test took 42.96 seconds and finished last; more slots cannot remove
every dependency or individual-unit bottleneck. This different-source queue
measurement supports the trial, not a projected speedup for the slow PR.

The [published runner](https://docs.blacksmith.sh/blacksmith-runners/overview)
has 128 GB RAM. Jobs=12 originated with source-tier commit `d7b08263af`; the reviewed
introduction and shard decisions contain no OOM-derived rationale. The
[trusted seed](https://github.com/ubugeeei-prod/vize/actions/runs/38933867331/job/117084324535)
already passed with jobs=24 on the same runner SKU. This demonstrates feasibility,
not worst-case memory headroom; no peak-memory measurement was retained.

## Actual trial

The jobs=12 [parent run](https://github.com/ubugeeei-prod/vize/actions/runs/38935551261)
at `d6c5c95c2a7b7703bf5e49cfa8a0db1a0766fb92` passed in 4m45s;
the first title event to required success was 6m07s, including 82s before Check
started. Its actual checkout was `95fd88af62d77fea9e93faab3a4ecee3434643f1`,
which also includes intervening main changes.

The jobs=24 [trial](https://github.com/ubugeeei-prod/vize/actions/runs/38936385902)
at `55725a8d555ab3170eaf2bc681e8367ed27aa600` passed Check in 4m21s and
all ten ordinary workflows in 4m26s from the earliest observed event. Its actual
checkout was `af9574852a968cc6dfb709e3d1f392ccb2ce07a5`. All 18,224 baseline
Rust cases passed again, with no duplicate identities. Intervening main #9290
added four provider-selection cases in two integration helpers: 18,228 passed.
Production Rust, Cargo.lock, toolchain, package selection and feature inputs
were identical, but the compiled integration helpers were not.

JS builders was the final workload in both runs: its test step took 207s and
182s, with Cargo still set to 12. Both final-report tails were 9s. The overall
time reduction therefore cannot be attributed to the Rust cohort setting.
The first Check's event delay was 82s versus 4s for the trial. All observations
are first attempts; no failed job was retried or omitted. Use the existing logs,
JUnit and timing artifacts rather than adding a persistent probe workflow.

Sticky mounts and source-mtime restoration were successful in the earlier pair,
but identical cache keys do not prove identical trusted snapshots or usable
artifacts. Report unknown or changed cache state and absent memory evidence.
The comparison is observational. Keep the strict test/Clippy gates and revert
this trial if it causes OOM or meaningful regression; do not change assertions,
budgets or retries to obtain a passing result.
