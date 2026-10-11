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
