# Instruction ceilings are required qualification

Tracked in [#6830](https://github.com/ubugeeei-prod/vize/issues/6830).

The previous workflow made instruction measurement advisory: the reusable job
had `continue-on-error: true`, and the required outer `test-report` did not
include its caller in `needs`. The command-level comparator could reject an
instruction regression while the merge-queue Check workflow still reported
success. The old workflow-shape test explicitly preserved that advisory policy.

The explicit maintainer requirement to enforce the actual instruction gate
supersedes that policy. Remove the reusable job's advisory status and require
`instruction-counts` in both the merge-queue report and the full qualification
report. This covers both the existing level and formatter campaigns; neither
can be advisory or disappear behind a successful sibling.

The outer Check report uses a separate `--check-report` mode. It requires an
instruction result and rejects failure, cancellation, an absent result, or an
absent instruction row. A skipped instruction job is allowed only for ordinary
pull requests, where the existing caller condition deliberately omits the
expensive campaign. Every other needed job must still succeed. Source WIT/Nuxt
queue-only rules retain their existing separate `--check` mode.

Scheduled and manual full qualification already use a strict aggregate with no
allowed skipped jobs. Add the instruction caller to that aggregate's dependency
list and retain its existing strict command. Removing `continue-on-error` also
makes a failed standalone instruction workflow or full Check workflow fail in
its own right. The full release evidence requires a successful `full-js-report`.

Regression tests parse the actual workflow and execute its actual outer-report
command for PR and merge-queue success, failure, cancellation, legitimate PR
skip, and missing instruction results. They execute the full aggregate command
for scheduled/manual instruction failure, cancellation, skip, and missing result.
The source-level checks also refuse advisory flags on either measurement job or
measurement steps. Existing immutable registry, numeric ceilings, Rust toolchain,
three-run equality checks, measurement windows, and artifact retention are
unchanged. Full source qualification remains required after the related product
performance fixes are integrated.
