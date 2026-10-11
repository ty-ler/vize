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
After terminal results, record the actual request/iteration if observable;
otherwise retain the uncertainty and coordinate the next bounded probe.
