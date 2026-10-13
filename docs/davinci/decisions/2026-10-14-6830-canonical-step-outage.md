# Canonical worker selection degrades when the jobs API omits steps

Issue: [#6830](https://github.com/ubugeeei-prod/vize/issues/6830).

## Decision

`canonical-corpus-workers.mjs` checks that each canonical observer ran six
named steps in order and that its evidence upload happened inside the upload
step. When every completed job in the run reports no steps, it instead
requires the upload to fall inside the observer job's own window. It records
`stepEvidence: "unavailable"` on each worker and writes a warning to the log
and the job summary.

## Reason

From 2026-10-13 21:15 UTC the GitHub jobs API returned `steps: []` for every
job of every new run, GitHub-hosted and Blacksmith alike. Every s2 dom corpus
job failed with "Missing canonical step", which would have stopped every PR
and merge-queue candidate that runs the canonical corpus.

## Scope

The fallback applies only when no completed job in the run reports steps. One
job with steps keeps every step check. Observer success, artifact identity,
digest, run binding and the full verification of the downloaded contents are
unchanged.

Remove the fallback (`canonical-corpus-step-outage.mjs`) once the jobs API has
returned steps reliably for a week; the recorded `stepEvidence` values show
whether it was ever used after the outage.
