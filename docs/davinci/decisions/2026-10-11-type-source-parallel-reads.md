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

## Measured result: retain and close without merge

[Actions 38106011578](https://github.com/ubugeeei-prod/vize/actions/runs/38106011578)
completed successfully at exact base `b7ec71ecd3981fdeffb5df816bd0e811e175b61e`
and measured head `0083a177df5dc91909d2c9139f4a291dde036e08`.
The [complete CLI report](./evidence/2026-10-11-type-source-parallel-reads.json)
is byte-exact downloaded primary JSON with SHA-256
`b396f6dd6b5be29fbb97f6fa4b86f1964c8027fea0e78e7795b83d9f41c8bb7f`.
[Artifact 11689997297](https://github.com/ubugeeei-prod/vize/actions/runs/38106011578/artifacts/11689997297)
retains every input, raw process report and separate profile; GitHub reports
ZIP digest `sha256:0d1abe6a263b76cf8a6f137999b39838a4e7b933567347774b594ff34f114072`.
The [complete stage report](./evidence/2026-10-11-type-source-parallel-reads-stage.json)
retains all twelve public module-fact signatures and raw samples.

Both CLIs are Vize 0.443.0 on Rust 1.99.0, native TypeScript 7.0.2 and
Vue 3.6.0-beta.10, with identical ci-opt/thin-LTO/16-codegen-unit settings on
Blacksmith's 32-vCPU Linux/x64 AMD EPYC runner. Two warmups precede nine
alternating fresh-process pairs per row. All twelve module-fact signatures,
complete ordered CLI/program/plant reports, both thread modes, and 144 full
leaf-parity vectors across the original 36 cases passed. Green proves these
parity contracts; it does not prove an improvement.

| Corpus / mode | Base median ms | Head median ms | Paired mean head minus base ms | Conditional 95% t8 interval ms |
| --- | ---: | ---: | ---: | ---: |
| shared-barrel500-max | 352.187 | 346.775 | -11.042 | [-22.479, 0.396] |
| shared-barrel500-1t | 471.044 | 474.141 | 1.741 | [-6.372, 9.854] |
| shared-leaf501-default-max | 283.786 | 287.437 | 1.479 | [-3.069, 6.027] |
| shared-leaf501-default-1t | 588.297 | 583.850 | -21.694 | [-56.269, 12.881] |
| generated500-max | 482.601 | 478.978 | -0.362 | [-7.758, 7.034] |
| generated500-1t | 1401.582 | 1427.039 | -8.614 | [-57.631, 40.403] |

Every interval crosses zero. Generated500/max changed by -0.75% in median,
but its paired mean is only -0.362 ms with [-7.758, +7.034] uncertainty;
no original-workload improvement is demonstrated. Generated500/1T and shared
leaf/max medians are slower by 1.82% and 1.29%. These intervals use nine paired
deltas and t=2.306; they are conditional on this run and runner. A single first
launch per side, retained in the primary report, does not establish repeatable
cold-disk behavior. No filesystem cache eviction occurred.

Close [#8560](https://github.com/ubugeeei-prod/vize/pull/8560) unmerged and never
queue this candidate. Its FIFO progress control and mutex shape do not justify
an extra per-source allocation without useful whole-command evidence. This
receipt commit changes documentation only and makes no current-head runtime,
protected-merge, release or 10x claim. #7698 remains open.

## Next larger measured cost

The separate generated500/max profiles have no dropped spans or counters.
The actual sharded backend wall span is 332.900 ms at base and 326.757 ms at
head; the seven overlapping command spans sum to 2215.925 and 2203.778 ms,
which are not command wall time. Summed root augmentation spans are 46.034
and 55.132 ms. These are one untimed observation per side and cannot be
subtracted from separately measured CLI medians.

Keep the original complete inputs, diagnostic plants and membership while
refreshing the existing native-phase observation on current source. The
historical native phase record reports Check as its largest observed field;
there is no separate Program-object or startup field. Do not attribute an
unexplained residual to startup or claim a program cache from process reuse.
The urgent n8n cold-graph investigation must establish the first actual native
fact-authority refusal before removing work: unresolved configuration, missing
bodies and retired owners require different complete proofs. Its original
source, guards, deadlines and failed campaigns remain retained. Real-project,
persistent no-op, leaf/shared edits and the 42.55 ms full-command target stay
unfinished.
