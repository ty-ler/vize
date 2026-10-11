# Independent dependency reads within a source snapshot

Issue: [#7698](https://github.com/ubugeeei-prod/vize/issues/7698).
Source baseline: `b7ec71ecd3981fdeffb5df816bd0e811e175b61e`.

The current batch shares one immutable `TypeSourceSnapshot`, parsed dependency
modules and import-resolution cells. Its disk map still holds one mutex across
`std::fs::read_to_string`. First-use reads of distinct dependencies therefore
serialize even when their module and resolution cells can initialize in parallel.

Store a separate source-or-miss `OnceLock` for each existing disk-map key. Release
the map mutex before initializing or waiting on that cell. Readers of the same
key receive the same captured `Arc<str>` or missing-file result. Independent keys
can read concurrently. Public path normalization still happens on every call;
overlay priority, fresh snapshot lifetime, root-buffer parsing, per-world module
limits, import resolution, dependency facts and diagnostics stay unchanged.
No backend, pipeline stage, persistent cache or admission domain changes.

Each distinct captured disk key now owns one additional shared cell allocation.
Cold and one-thread tradeoffs must be assessed alongside parallel workloads;
no existing instruction or allocation ceiling is relaxed.

The source controls retain existing overlay/positive/miss/fresh-revision laws,
add sixteen simultaneous readers sharing one captured source, and use a genuine
Unix FIFO to hold one disk read open while an unrelated dependency completes.
The FIFO law releases and joins both readers before reporting a failure; it must
fail under the original global read lock. It proves independent I/O progress,
not lower command latency.

## Measurement and acceptance

The existing Type source snapshot benchmark runs complete public module-fact
parity and actual CLI diagnostic/program parity at exact common-base and head
SHAs. Preserve its generated500, shared-barrel500 and shared-leaf501 inputs,
one-thread/default-max modes, first launches, two warmups, nine alternating
fresh-process pairs, planted diagnostics, binary/compiler/runtime receipts and
separate untimed profiles. The historical generated500 target remains 42.55 ms;
prior stage or imported-corpus results do not establish its full-command 10x goal.

TODO: inspect the complete current paired Actions results, including any
regression or unchanged lane, before readiness. Exact-head source/full/protected
checks, actual merge and public release remain required. No speed improvement,
real-project/edit acceptance or completion of #7698 is claimed by this source
change. Persistent no-op, leaf/shared edits and real-project work remain open.
