# Exact-candidate array backend timeout observer

The second #8561 protected-queue attempt failed in Rust shard 1, run
38109119091 / job 114381540965, at source
`c395492c78117aae12e764235c85fa2e106a53e3`. Of 4,536 tests, 4,535 passed.
The original array native Vue test returned `Backend(Timeout)` after 30.056 s
at its report unwrap. Its complete raw log, JUnit and authentic archive
receipt are retained; the log does not identify the loop iteration or IPC
request. Congestion and backend overlap remain hypotheses.

This private, dispatch-only branch runs one exact original law from the same
source-bound archive, then rebuilds only its integration target with stderr
iteration, typed error and PID markers. Removing the exact marker patch
reconstructs both original test files byte for byte. The original loop,
all complete diagnostic comparisons, refusal controls, 30 s request deadline,
product bridge/client source and full shard workflow remain unchanged.
The workspace build selection and pinned Rust 1.99.0 / ci profile are retained.

External strace uses its documented [full read/write dumps](https://github.com/strace/strace/blob/master/doc/strace.1.in)
to preserve backend IPC/LSP bytes and process identities, with actual observer
process-tree CPU/RSS samples. Source files,
archive receipt/hash, selected original binary, observer binary and actual
backend bytes/hashes are retained in one complete artifact. Existing caches
are restored without mounting or registering a writer. No upstream write,
audit PR, queue admission or normal concurrency change is part of this probe.

A single-law pass does not replace the failed full shard or prove the cause.
The isolated load and tracing overhead must be reported separately. A failing
control or observer keeps the diagnostic job red while uploading all evidence.
Hosted [run 38111373780](https://github.com/ubugeeei-prod/vize/actions/runs/38111373780)
completed successfully at observer driver `fc93757`, with original candidate
`c395492` and its authenticated failed-run archive. The exact original law
passed in 0.30 s; the marked, traced law passed in 0.42 s. All three template
iterations retained both complete reports and the bound-template refusal.
The instrumented integration target build took 24.755 s. Original nextest
command walltime was 20.553 s including archive extraction, separate from
the 0.30 s test execution.

Artifact 11691816293 retains 34,602,193 bytes; all 188 downloaded capture SHA256
entries match. Its 149 trace files contain five actual backend execs and full
project/configuration/API-session/diagnostic/shutdown traffic. The retained
actual TypeScript 7.0.2 binary SHA256 is
`4f2de678286401759b3fb4475bafe35b8f32b4b3a07d92642bbf37eadc9b34a4`.
Both report-producing iterations completed; no timed-out request was observed.
The failed full-shard cause remains unproven, and #8561 remains off the queue.
