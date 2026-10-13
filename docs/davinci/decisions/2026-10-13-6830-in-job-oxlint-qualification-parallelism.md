# In-job parallelism for the Oxlint project qualification

This [#6830](https://github.com/ubugeeei-prod/vize/issues/6830) decision
shortens the PR Oxlint original-project qualification job inside its one job.
It follows the [parallel PR JS package jobs](./2026-10-13-6830-parallel-pr-js-package-jobs.md)
record, which left this job as the critical path.

No rule is relaxed. The job still qualifies one source-built addon from its
own build: no downloaded addon, one `binarySha256` bound in `qualification.json`,
and every n8n input, both pinned Oxlint hosts and every mixed-directory cell
still qualified. Only process counts and scheduling change. Every new count is
fixed and opt-in, so local runs, the manual benchmarks and the main-branch
suite keep the original counts.

## Evidence

The qualification's own `phase-walltime.json` in
[PR run 38355807070](https://github.com/ubugeeei-prod/vize/actions/runs/38355807070)
(artifact `oxlint-original-locations-7bf59b5…-1-pr-js-packages`) measured:

| Phase                                     | Wall time |
| ----------------------------------------- | --------: |
| Whole qualification                       |     417 s |
| Baseline preparation (two vitest workers) |     199 s |
| Baseline workers, slowest of two          |     184 s |
| `mixedDirectory8507` (two workers)        |     116 s |
| Host transport, then HTML transport       | 23 + 79 s |
| Host wait for the baseline                |      97 s |
| Host n8n replay                           |     200 s |
| Host `reference` mode alone               |     155 s |
| Aggregation                               |      10 s |

The `reference` mode is one whole-project run of the historical wrapper, which
calls the addon once per rule: 69,813 native calls per host. The other host
modes take 1-19 s each.

## Changes

1. **Baseline partitions.** `VIZE_N8N_BASELINE_PARTITIONS` selects a fixed
   count; PR CI uses 12. Partitions stay contiguous ranges of the ordered
   inventory, and only the last runs the cache controls. Every input row is
   independent because the replay clears the file-state cache before each
   mode. The join therefore concatenates the same rows in input order.
   `n8n-baseline-partition-join.test.ts` joins 2, 3, 5 and 7 partitions and
   checks that the vectors, calls, controls and totals equal one serial range.
2. **Mixed-directory workers.** `VIZE_OXLINT_MIXED_WORKERS` selects a fixed
   count; PR CI uses 6. Worker _i_ takes every _n_-th cell in plan order. The
   existing join checks the same 98 observations in canonical order and the
   same 45 CLI and 8 native passes, and its test now covers 2 to 16 workers.
3. **Host branches.** Each host worker installs its pinned tools once. It then
   runs transport, HTML transport and its n8n replay concurrently instead of
   in sequence, as the two hosts already run beside each other. Each branch
   owns its captures, ledger and temporary directories. The replay still waits
   for the authenticated readiness packet, and the worker fails if any branch
   fails, after all three settle.
4. **Preparation order.** The qualification scripts' own input laws include
   real timing controls. Under full CPU saturation, one of them (the
   project-command SIGTERM escalation control) failed in three of five local
   runs. The laws now run first, beside only the pinned fixture hydrate,
   before any other branch starts. They were already on the n8n critical
   path. The historical reference build runs beside the baseline workers.
   Readiness still requires all of them to succeed.
5. **Reference slices.** `VIZE_N8N_HOST_REFERENCE_SLICES` selects a fixed
   count; PR CI uses 6. Each slice is a complete original project of its own
   with a contiguous part of the inventory, run with the unchanged arguments
   and configuration. The stock, baseline, shared and effective modes still
   run unsliced, in order, in one whole-project root.

## How equivalence is enforced for reference slices

- The joined report must equal the unsliced baseline report: diagnostics,
  file count, rule count and thread count. This is the qualification's
  existing comparison, so a slice that changed any per-file result, missed or
  repeated an input, or reordered output fails the job.
- `finishN8nReplay` still requires the exact per-file native call count in
  the reference phase: 51, or 50 for the six disabled scopes. Each call is
  checked against the input bytes in the slice's own root.
- Slices are cut only where byte order (the inventory order) and
  directory-walk order agree on the preceding files. The pinned corpus has 34
  positions where they disagree, for example `assistant-at-mentions/` before
  `assistant/`. The joined report is in whole-project order whichever of the
  two orders the host uses.
- Each process writes its own ledger. The host ledger is their concatenation
  in serial phase order, and `ledgers/ledgers.json` keeps each part's length
  and digest. The sources store is filled before any slice starts, so
  concurrent recorders only read complete files.
- `n8n-host-sliced-replay.test.ts` runs the real serial and sliced code with a
  controlled host that reports in directory-walk order. The summaries and the
  joined reference report match, and the joined ledger holds the same calls
  in the same order. The test also refuses a failed slice after every slice
  settles.

## Hang guards

Each host mode process has a timeout that guards against hangs; it is not a
check. One whole-project reference run took 153-157 s per host against a
180 s guard, and
[run 38388677032](https://github.com/ubugeeei-prod/vize/actions/runs/38388677032)
of PR #8833 timed out there. With six slices each reference process lints
about 228 inputs, roughly 26 s of the measured work, so the 180 s guard keeps
a wide margin. Runs that keep the whole reference run (local, manual and the
main-branch suite) now use a 600 s guard for that mode, about four times the
measured time and inside the 1,800 s host worker deadline.

A sliced run differs from a serial run only in process topology (one more
addon load per extra process, and so in `events` and `processes`), PIDs,
timings, owned temporary paths and ledger digests, plus one capture row per
slice. Any two serial runs already differ in all of these except topology.
One residual is not proven equivalent: a historical-wrapper defect that only
appears when one process lints all 1,369 inputs would no longer be observed.

## Not cached

The baseline preparation is not cached. It runs this PR's addon and plugin
source over the corpus, so it is not a function of the pinned n8n revision,
Oxlint versions and lockfile. Only the fixture hydrate and the historical
reference build depend on pins alone. Together with the input laws they took
about 15 s, and they now overlap other work.

## Fresco and UI conformance

`npm/ui check` is `pnpm lint:sfc && pnpm check:static && pnpm
check:story-testbed && pnpm check:vapor-runtime`, measured at 65, 15, 0.2 and
26 s. The parts only read sources and use their own temporary directories.
PR CI now runs them concurrently with
`tools/support/compat/github/run-package-check-parts.ts`. The runner reads the
parts from `package.json` on every run, runs the same `pnpm <part>` commands
in `npm/ui`, waits for all of them and fails if any fails. The trusted
`build-js-packages` job on `main` still runs the script itself.

## Comparison run

The `oxlint-parallelism` component of `ci-walltime-benchmark.yml` calls
`oxlint-qualification-parallelism.yml`. It builds the addon once and
qualifies twice: with the original counts and with the PR CI counts.
`compare-oxlint-qualifications.ts` then requires equal results everywhere
except process topology, PIDs, timings, owned paths and ledger digests. That
covers both qualification files, host transport and HTML results, mode
statuses, per-mode host reports, baseline vectors without timings, and cache
controls.

## Expected wall time

These estimates add the measured phases above to the new counts, and assume
work scales with the number of processes on 32 vCPUs. They are not measured
yet; CPU contention can stretch them.

| Phase                           | Before | Estimate |
| ------------------------------- | -----: | -------: |
| Baseline preparation            |  199 s |    ~50 s |
| `mixedDirectory8507`            |  116 s |    ~50 s |
| Host n8n replay after readiness |  200 s |    ~42 s |
| One host, all branches          |  402 s |    ~92 s |
| Whole qualification             |  417 s |   ~105 s |
| Qualification job, warm target  | ~8 min |   ~3 min |
| Fresco and UI conformance job   | ~3 min | ~2.3 min |

## Unfinished

- Neither the comparison run nor a PR run of this change has been measured.
- The main-branch `test-js-packages` composite keeps the original counts.
