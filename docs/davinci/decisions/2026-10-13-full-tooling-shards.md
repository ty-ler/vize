# Keep the complete tooling suite within its original deadline

Tracking: [#6830](https://github.com/ubugeeei-prod/vize/issues/6830).

The scheduled full Check's original `test-scripts` job
[114772530077](https://github.com/ubugeeei-prod/vize/actions/runs/38237754010/job/114772530077)
spent 276 seconds preparing and 1,483 seconds testing successfully, then reached
its 30-minute deadline during evidence and post-job work. Its elapsed time was
1,808 seconds. Increasing the deadline would leave that serial workload intact.

Build the original full-suite CLI and SFC oracle once, then run the complete
tooling inventory in four isolated checkouts. Retain the original `ci` recipes,
stable compiler, Wild 0.9 linker and default Cargo build parallelism. The PR
producer's pinned compiler and explicit build-job setting are separate; using
that producer unchanged would break the existing transport identity checks.
Optimized native benchmark `ci-opt` binaries remain separate.

| Contract           | Preserved behavior                                                                                                               |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| Full events        | Main push, schedule and dispatch, with the original conditions                                                                   |
| Source CLI         | Complete original archive, binary/oracle hashes, source/tree, run/attempt, compiler/linker/flags and consumer-use receipt checks |
| Test inventory     | Original glob set equals the full plan; four disjoint workers retain every file, including all 113 T1 files                      |
| Test harness       | Original NAPI debug build, layout verification, serial Node test execution and mandatory tsgo                                    |
| Native controls    | Router, native JS setup and all nested reference/handler gates, attribute-value captures and strict judges run on worker 1       |
| Worker preparation | Fixture hydration, dependencies, plugin runtime and formatter reference browser remain local to every worker                     |
| Evidence           | Original native artifact names have one owner; differential formatter evidence has four distinct shard names                     |
| Quorum             | The original full JS report requires the producer, complete worker matrix and every previous dependency                          |
| Deadlines          | Workers keep 30 minutes; the existing full JS report keeps five minutes                                                          |

The planner's existing zero comparison base and `--tier merge` select every
test file without depending on a PR base. The existing planned runner validates
the complete inventory before partitioning it and retains concurrency one in
each checkout. The original source LSP path and source-build requirement remain.
The producer receipt digest also reaches every nested consumer, so a restored
oracle cannot silently become a fresh independent build.

The full Rust workspace action also hydrates its existing Element Plus fixture
before any tests: `git submodule update --init --depth 1 -- tests/_fixtures/_git/element-plus`.
The command is identical to the existing native helper and resolves the committed
Gitlink `20298a21ae54a5417955373b80130ae7c548a6bb`, not the upstream branch tip.
Real local Git regressions reject the predecessor and prove hydration still
selects that exact commit after the remote advances. Every original workspace,
differential, native oracle and archive gate remains unchanged. The hydration
source change has its own commit so a frozen older Stack can inherit it without
the tooling sharder.

Source coverage also retains the existing raw native syntax packets after
failure. Only its report step receives `VIZE_NATIVE_SYNTAX_CAPTURE_DIR`; an
always-run pinned artifact upload keeps the full temporary capture directory.
The original coverage command, filters, normalization and 40-minute deadline
remain unchanged. Missing packets warn and provide no byte proof; an original
compile or assertion failure remains a failed qualification.

The historical frozen diagnostic source had 1,217 files; fresh main has 1,219
before this change's new control test. The proof uses the actual source inventory
rather than freezing a stale count. All 113 T1 import closures were audited:
220 files, no unresolved/dynamic imports and no native capture dependency.
Optional capture readers in the larger full inventory still execute in their
original native action steps. Those capture variables remain step-local, as
before; later tests prepare their own evidence. File grouping changes from the
old glob order to a global sorted partition, so fresh full Actions must verify
the complete harness rather than treating set equality as runtime acceptance.

Keep the cache role `test-scripts`. The producer retains the original
`Linux-X64` suffix; workers use `Linux-X64-shard-1` through `-4`. Registry, Git,
target and save/seed keys are distinct for all five owners. Main-only trusted
writes and branch dispatch restore-only behavior remain unchanged, including
the existing suppression of mounted-target archives for this role.

TODO: record fresh source Actions, complete full-suite results, protected
delivery and actual merge. Runtime improvement remains unmeasured until the
original workload completes on the same repaired source.

Qualify the complete suite together with #8809's native listing-output fix.
The child preserves both the exact parent and shipping main
`b2f56c584c82f0da96db88c1faee565dd838ead8` as genuine merge ancestry, then carries
the original tooling and fixture commits. The listing control uses that reviewed
shipping cut and proves it is the actual ancestor; the immediate Stack parent
already contains the listing fix and cannot serve as its before image. All 429
literal BD source cells, complete parent-edge checks, production singleton and
refusal laws remain mandatory. Preserve qualified predecessor evidence, then run
one plain full Check on the source-qualified cumulative head.
Tooling checkouts fetch complete actual history: a depth-one HEAD refuses the
reviewed shipping-cut merge base even when all raw objects are present. The
existing checkout hydrates that graph; strict shallow and parent-edge refusals
remain unchanged.

The first cumulative full run exposed one deferred LSP guard that still read the
old monolithic workflow for create-vue hydration. Its actual pinned SFC/TSX
runtime test passed. Follow the real full-worker action from the parsed caller
and retain the identical hydration assertion; all original LSP runtime bodies
remain unchanged. This is the only T1 test that reads the old Check workflow.
Retain the failed run and audit every worker before one combined successor.

Actual cumulative [full run 38371279261](https://github.com/ubugeeei-prod/vize/actions/runs/38371279261)
at `9d1def612911a6b95709cb566ebd3ee00f4b0a36` returned all four commands within
their unchanged deadlines. This failed run is evidence of elapsed work, not
full qualification or a controlled speed comparison. The producer took 97s;
its original CLI/SFC command took 65s. All workers planned 1,229/1,229 files,
deferred no T1 tests and consumed the same original receipt
`e7397c13dfd13860ec0fc019b0edffd475bf31a9efbc2f5a63ed693aa7db097a`.

| Worker | Preparation | Planned wrapper | Post-job | Total | Actual result |
| ------ | ----------- | --------------- | -------- | ----- | ------------- |
| 1 | 258.104s | 593.326s | 6.569s | 858s | Passed |
| 2 | 68.571s | 524.032s | 4.396s | 597s | Passed |
| 3 | 76.896s | 776.986s | 3.117s | 857s | Listing source test failed |
| 4 | 71.452s | 510.379s | 3.168s | 585s | Old LSP guard location failed |

The existing full JS quorum failed on the aggregated worker failure as required.
The listing test also failed in source CI with only a file-level failure; its
local six-case success does not explain the hosted failure. The separate Vue
diagnostic parity failure remains a product blocker. Preserve the complete logs
and source-coverage packets, repair actual causes and obtain fresh full results.

For the observed listing file failure, retain structured built-in TAP alongside
the original spec stdout only when that file is already selected on Actions.
Keep every selected file, the original Node backend, concurrency one, TSGO
requirement, environment and deadline. Record the outer command's actual status,
signal, error and run/source identity before preserving its exit behavior. An
independent real Node control proves TAP retains a terminated file child's
SIGTERM while the outer process reports status 1. It explains neither hosted
failure and grants no repaired-source credit. A separate always-run artifact
keeps these observations without changing the original formatter evidence.
Capture the existing inherited NODE_TEST_CONTEXT; do not change it on a theory.
