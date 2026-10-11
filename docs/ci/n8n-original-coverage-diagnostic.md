# Original coverage concurrency diagnostic

This finite investigation preserves failed full Check run `38107375842` at
source `2ce2d2b75cfa9ba14f322a99de8f7146b623b8fe`. Three original Maestro
tests exceeded existing native diagnostic deadlines. Their complete source,
Canon implementation, runtime locks and build configuration match green
neighboring layers; the failed log contains no process census that proves a
resource cause.

An isolated driver checks out that exact source in a separate directory. It
verifies every tracked physical file against its original Git blob and records
whole SHA-256 manifests before compilation, before tests and after tests. Native
runtime binaries, packages, Vue declarations, compiler identity, coverage
environment and the original instrumented test binary are retained by hash.
Workspace compilation preserves original feature unification. The complete
1,334-test Maestro suite runs in the finite order host-default, four threads,
four threads, host-default using the same binary. No test, expected result,
fixture, diagnostic deadline or shipping workflow changes.

Every arm preserves complete stdout/stderr, original result counts and 200 ms
Linux process samples: PID, PPID, process start ticks, state, thread count, CPU
ticks, virtual size, resident pages, all-process census and host pressure. Known
descendants retain their identity after reparenting. Original cleanup is
observed for five seconds; an owned process remaining then stops subsequent
arms instead of overlapping experiments. The driver never kills native children.

This experiment omits execution of workspace test binaries preceding Maestro,
uses a separate checkout path and intentionally keeps the suite's native test
deadlines unchanged. These conditions bound causal interpretation. A successful
diagnostic arm cannot qualify the original failed full coverage gate or a new
shipping source. Remaining stack layers still require genuine fresh-head full
Actions before protected queue admission. This driver has no PR and will not
merge into the shipping branch.

## Authenticated measurement

Corrected driver `f0973c895fdaeac762120120de031f00d053eafe` completed
[run 38110188045](https://github.com/ubugeeei-prod/vize/actions/runs/38110188045).
Artifact `11690548583` contains 10,014,178 bytes; its downloaded ZIP matches the
server digest `d142115d39cff5a2aaa04cb2ca36d91a87e4c330d1f23555d141171b925ded2f`.
All 27,861 tracked physical source entries and actual runtime manifests match
before compilation, before tests and after tests. The original instrumented
test binary SHA-256 is
`0949cc23dcaa178d952c99220393a546a63afbab8d70440bc40dc9060c7fa13b`.

| Arm | Original harness concurrency | Seconds | Passed / failed / ignored | Peak sampled owned processes | Peak sampled owned threads | Peak summed resident bytes |
| --- | --- | ---: | --- | ---: | ---: | ---: |
| 1 | Host default | 27.38 | 1,331 / 0 / 3 | 115 | 1,650 | 4,178,128,896 |
| 2 | Four | 33.61 | 1,331 / 0 / 3 | 84 | 1,208 | 2,685,628,416 |
| 3 | Four | 33.91 | 1,331 / 0 / 3 | 84 | 1,165 | 2,672,762,880 |
| 4 | Host default | 26.35 | 1,331 / 0 / 3 | 113 | 1,730 | 4,067,946,496 |

Every LF and CRLF original editor witness preserves its whole expected/actual
packet and all eight complete native collection stage vectors. No sampled
owned descendant remains after original cleanup. Sampling peaks are lower
bounds; resident bytes sum each process's resident pages, including shared
pages. These measurements expose substantial backend fanout, but do not
reproduce the original three timeouts. The four-thread harness reduces peak
resource use and is about 26% slower. It is not a demonstrated repair, and no
shipping concurrency or diagnostic deadline changes follow from this result.
The failed full gate remains unqualified until genuine fresh shipping-head
Actions pass.

Initial driver run `38110012556` stopped before compilation or tests because
its receipt helper assumed the former preview `lib/tsgo` name. The corrected
helper verifies the actual original TypeScript 7.0.2 `lib/tsc` executable and
package. The failed bootstrap and the original failed full-suite receipt remain
preserved separately from the completed diagnostic.
