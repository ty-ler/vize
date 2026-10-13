# Merge queue build concurrency trial

Issue: [#6830](https://github.com/ubugeeei-prod/vize/issues/6830).

At **2026-10-13 16:59:04.756 UTC**, ruleset `24013395` changed
`max_entries_to_build` from **8 to 12** for a monitored trial of the setting
recorded in the
[artifact baseline](./2026-10-12-ci-artifact-payload-baseline.md).
The trial ended at **17:07:29.108 UTC**, after 8 minutes 24 seconds, when
the setting returned to **8** because dispatch delays and waiting jobs grew.
Twelve builds are not accepted as the steady-state setting.

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

The planned observation window was 20–30 minutes, with early rollback for
material degradation. Observations compared jobs created after application,
dispatch percentiles, queued-job age, runner communication failures, candidate
admission and actual merges. Candidate SHAs were tracked independently of queue
positions, with run/job identifiers and complete ruleset snapshots retained.

The rollback conditions were persistent dispatch degradation, accumulating
waiting jobs, or repeated runner communication loss under additional load.
A single slow job or ordinary test failure would not establish capacity
exhaustion. The coordinator returned only `max_entries_to_build` to eight;
the complete before/after rollback comparison verified all other fields stayed
unchanged.

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

## Results and recovery

| Observation (UTC)              | Assigned jobs | Median dispatch | p95 dispatch | Queued jobs | Oldest queued job |
| ------------------------------ | ------------: | --------------: | -----------: | ----------: | ----------------: |
| 16:53:43, eight-build baseline |           421 |             7 s |         50 s |           0 |                 — |
| 17:05:43, twelve-build trial   |           136 |           155 s |        290 s |         129 |             343 s |
| 17:07:55, just after rollback  |           195 |           188 s |        293 s |         119 |             326 s |
| 17:18:01, recovery observation |           105 |           273 s |        377 s |          53 |             327 s |

Each row covers the candidate heads present at that snapshot, not an identical
job cohort. The trial sample includes jobs from the newly regenerated heads;
the pre-trial ten-minute dispatch p95 was 7 seconds. The recovery snapshot
contained eight candidates, but the 70 assigned jobs created after rollback
still had a 273-second median and 311-second p95. Waiting work decreased while
dispatch remained slow: recovery was incomplete at the final observation.
Returning the setting to eight did not cancel already dispatched candidates.
Twelve active candidates were observed during the trial, but no PR merged
within its eight-minute window or by the 17:18 recovery observation. Initial
admission of #8904 preceded the setting change. Neither admission nor merge
latency improved in a way this experiment could establish.

The [front candidate](https://github.com/ubugeeei-prod/vize/actions/runs/38434971830)
shows the effect on its critical path: the Rust archive producer finished at
17:09:56 UTC, while dependent shards started at 17:14:30–17:15:16, a further
274–320 seconds later. Their archive downloads took 43–47 seconds and tests
109–122 seconds. Dispatch delay therefore exceeded those download and test
durations for these shards; it was not merely background queue noise.

The first trial snapshot had no failed Check jobs. An independent source-plan
defect then failed the complete-Rust gate for docs-only candidate
[#8898](https://github.com/ubugeeei-prod/vize/actions/runs/38435064811/job/115430252462).
It selected `rust=false`; this was not a runner communication failure.
The coordinator removed that failed candidate and the owning
[#8947](https://github.com/ubugeeei-prod/vize/pull/8947). Its repair restores
unconditional full merge-group planning, with exact-head Actions required
before readmission. Those removals regenerated further heads.
No runner communication failure was observed in these sampled Check jobs.

The same interval also required cancellation of superseded runs after checking
both their absence from the live queue and a deleted or changed temporary ref.
These cancellations, prefix changes and queue jumps affect the recovery
observations. They prevent attributing either the regression or recovery
solely to the build-concurrency setting. Retain eight builds, address avoidable
candidate regeneration and obsolete work, and require a stable queue cohort
before another concurrency experiment. No throughput speedup is claimed.
