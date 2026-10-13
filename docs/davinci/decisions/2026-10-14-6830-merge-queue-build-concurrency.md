# Merge queue build concurrency trial

Issue: [#6830](https://github.com/ubugeeei-prod/vize/issues/6830).

At **2026-10-13 16:59:04.756 UTC**, ruleset `24013395` changed
`max_entries_to_build` from **8 to 12** for a monitored trial. This record
supersedes only the eight-build setting recorded in the
[artifact baseline](./2026-10-12-ci-artifact-payload-baseline.md).
It does not establish a measured throughput improvement yet.

The complete before/after ruleset comparison found no other changes. Squash,
`ALLGREEN`, minimum/maximum one merge, zero batching wait and the 60-minute
check timeout remain unchanged. The branch rules still require `check-js`,
`check-vize-apps`, `fmt-rust` and `test-report`; merge-group workflows still run
their complete suites. No check, performance budget or acceptance gate was
removed. No queue jump was made as part of this trial.

[GitHub's merge queue documentation](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue)
distinguishes concurrent build dispatch from merge batching. Increasing the
merge limit would not combine builds, so it stays at one.

## Baseline and expected tradeoff

At **16:53:43 UTC**, the queue contained 42 entries: eight were awaiting
checks and two already qualified entries still had candidate heads. Across
their ten Check runs, 421 jobs had an assigned runner and a start timestamp.
Dispatch delay is `started_at - created_at` from the Actions jobs API.

| Baseline sample                          | Jobs | Median |  p95 | Maximum |
| ---------------------------------------- | ---: | -----: | ---: | ------: |
| All assigned jobs in current candidates  |  421 |    7 s | 50 s |   108 s |
| Jobs created in the preceding 10 minutes |   85 |    3 s |  7 s |     7 s |
| Blacksmith 32-vCPU jobs                  |  408 |    8 s | 50 s |   108 s |

No Check job was queued or failed in that snapshot. The current candidates
included 105 assigned jobs created after the reported 16:36 runner outage:
51 had succeeded and 54 were running, with no failures observed. That is
bounded cohort evidence, not a claim about the entire provider.

Queue admission was materially slower than source validation. The exact-head
[Check for #8904](https://github.com/ubugeeei-prod/vize/actions/runs/38418633810)
took 16 minutes 33 seconds. GitHub records its queue entry at 15:25:09 UTC;
the watcher first observed a candidate at 16:58:42 UTC, 93 minutes 33 seconds
later. This observation precedes the trial and cannot be credited to it.

Twelve builds allow four additional candidates to start speculatively. They
can shorten admission waits when runners have capacity, while leaving the
first candidate's critical path unchanged. Four recently completed Check
runs consumed approximately 145–181 runner-minutes each:
[8854](https://github.com/ubugeeei-prod/vize/actions/runs/38430582444),
[8852](https://github.com/ubugeeei-prod/vize/actions/runs/38430585786),
[8860](https://github.com/ubugeeei-prod/vize/actions/runs/38430597393) and
[8871](https://github.com/ubugeeei-prod/vize/actions/runs/38430834567).
Four additional complete builds could therefore occupy roughly 580–724
runner-minutes, plus other workflows. These are summed runner durations,
not billed cost. A stable queue does the same eventual work sooner; a failed
prefix or reordered queue can discard more speculative work.

## Observation and rollback

Observe the first 20–30 minutes from the exact application timestamp. Compare
jobs created after that timestamp, recent dispatch percentiles, queued-job
age, runner communication failures, candidate admission and actual merges.
Match candidate SHAs rather than queue positions. Preserve run/job identifiers
and the ruleset snapshots so the comparison remains reproducible through the
Actions jobs API and the GraphQL merge queue API.

Return only `max_entries_to_build` to eight if dispatch degradation persists
across consecutive observations, waiting jobs accumulate, or repeated runner
communication losses appear under the additional load. A single slow job or
ordinary test failure does not by itself prove capacity exhaustion. Keep all
other gates unchanged during either continuation or rollback.

The first observation already has a material confounder: four existing PRs
were inserted with `jump: true` at 16:59:09, 16:59:13, 16:59:19 and 16:59:24
UTC ([#8956](https://github.com/ubugeeei-prod/vize/pull/8956),
[#8947](https://github.com/ubugeeei-prod/vize/pull/8947),
[#8899](https://github.com/ubugeeei-prod/vize/pull/8899) and
[#8901](https://github.com/ubugeeei-prod/vize/pull/8901)). Existing branch heads
were unchanged while their candidate SHAs regenerated. These queue changes
were outside the concurrency-setting change; no human or agent attribution
is inferred from the shared account. Their additional work prevents a clean
causal throughput comparison for this interval.

The trial remains in progress. Add the measured dispatch, failure and merge
results here before treating twelve builds as an accepted steady-state
setting. Do not turn the configured 50% increase into a claimed 50% speedup.
