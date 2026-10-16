# Stop owned Rust compiler processes before cache teardown

Issue: [#6830](https://github.com/ubugeeei-prod/vize/issues/6830).

## Observed delay

The replacement PR Check run
[38893209547](https://github.com/ubugeeei-prod/vize/actions/runs/38893209547)
at `986d6cdb14d866bf23786099acbc4f57dff5c824` was created at 11:21:16 UTC.
Its first jobs started at 11:23:40, 144 seconds later. The previous run
[38892945040](https://github.com/ubugeeei-prod/vize/actions/runs/38892945040)
at `fccbc44b6631c04de00153cd1a87258f1d0733e9` did not finish cancellation
until 11:23:39. Both PR runs belong to the same cancel-in-progress group.

The previous
[Compiler cohort](https://github.com/ubugeeei-prod/vize/actions/runs/38892945040/job/116946725992)
was the last cancelled worker. Its step reported cancellation at 11:21:35.754,
but Cargo, cargo-nextest, rustc and linker descendants survived until the
runner's final orphan cleanup at 11:23:28.902–11:23:29.054. Its sticky-cache
post actions occupied 113 seconds between those events:

| Post action         |  Elapsed | Observed cause                                                                                                       |
| ------------------- | -------: | -------------------------------------------------------------------------------------------------------------------- |
| Target disk         | 19.319 s | 12.338 s from mounted-device detection to usage report, then ten failed unmount attempts because the target was busy |
| Cargo git disk      | 48.502 s | 47.084 s before usage report; successful unmount; explicitly no commit                                               |
| Cargo registry disk | 44.770 s | 44.113 s before usage report; successful unmount; explicitly no commit                                               |

The pinned `useblacksmith/stickydisk` version
[`3f6be1451e3cad893b778bc93495c80452a5da26`](https://github.com/useblacksmith/stickydisk/blob/3f6be1451e3cad893b778bc93495c80452a5da26/src/post.ts)
runs global `sync`, then `df`, cache dropping and unmount before checking its
read-only/no-commit setting. The three intervals before usage reporting total
103.535 seconds. Existing timestamps do not separate `sync` from `df`, and do
not prove that a particular process was in uninterruptible kernel sleep.
The logs do prove that this was teardown with live compiler descendants,
not a cache upload or commit.

The replacement runner's own Blacksmith message-wait and acquisition timings
were 747 ms and 358 ms. It started one second after the old run became terminal;
the evidence does not support attributing the 144-second wait to runner capacity.

## Change

The cohort CLI previously used `spawnSync` for `cargo nextest run`. Its Node
event loop could not handle cancellation while Cargo was running. Launch that
same executable and argument vector asynchronously in a new POSIX process
group, with inherited environment, working directory and standard streams.

On SIGINT or SIGTERM, signal only that owned group. If SIGINT is ignored,
send SIGTERM after one second. Send SIGKILL after two seconds if the group
still exists. Await the direct child's completion and the disappearance of
the group, including grandchildren remaining after Cargo itself exits, before
returning. The overall drain limit is five seconds from the first signal.
An undrained group produces an explicit failure with exit status 1; it is
never reported as clean.
SIGKILL cannot promise immediate completion of uninterruptible kernel I/O.

Cancellation returns 130 for SIGINT or 143 for SIGTERM, including when a child
catches the signal and exits zero. Ordinary exit statuses and spawn errors
remain unchanged; an independently signalled child still returns the previous
nonzero status of 1. This cannot turn a cancelled Rust step into a passing
required report.

The ownership boundary is the process group created by this invocation. No
process-name scan, host-wide kill, cache-policy exception or post-action bypass
is introduced. A process that deliberately creates a different session/group
is outside this boundary. The affected package plan, test-target projection,
features, nextest options, PR/merge-queue roots and job concurrency are unchanged.
The short existing metadata command is also unchanged.

## Validation and remaining measurement

`rust-test-cohort-cancellation.test.ts` executes the real CLI with a temporary
Cargo provider and real Node child/grandchild processes. It checks inherited
argv/environment/cwd/output, ordinary success/failure, independent child signal
failure and spawn failure. Cancellation controls cover SIGINT, SIGTERM, ignored
SIGINT, a leader exiting zero before its grandchild, and descendants ignoring
both graceful signals. Every control requires the owned group to be gone before
the CLI exits while an unrelated process remains alive.

The SIGINT control also runs the actual PR cohort workflow shell. Its timing
receipt and shell status must retain exit code 130, and both failed and cancelled
cohort results must fail the required Rust aggregate. Local validation uses
macOS with Node 26.12.0 and the pinned Node 24.14.0; Linux group teardown still
needs Actions validation, especially orphan/zombie reaping by the guest's init.

Existing cohort-projection, workflow and strict Rust-gate tests remain required.
Fresh Actions on the committed change must establish ordinary CI acceptance;
a controlled cancellation of our own run can measure hosted drain latency.
Local process controls alone do not establish that sticky-cache teardown or
the PR duration target has been achieved.

The observed replacement run reached its required report in 8m02s from run
creation, or 5m38s from first job allocation. Removing the cancellation wait
alone therefore would not meet the five-minute PR target. Keep the actual
creation-to-required-report measurement, including queue time.
