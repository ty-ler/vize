# Bounded post-pass exit observation

This diagnostic is separate from Musea HTTP fixture isolation. It leaves issue
#9067 unresolved unless a genuine failure establishes a cause and a separate fix
passes its regressions.

`input.json` is the 1,291-byte historical replay envelope at
`636d748192d9de121053d60033aad04d80482ea7`, SHA256
`2f056e942aefc05b2ee4e0a79885820295aa1a51460f23c9a35049b1e48ac9db`.
Its generated code/cases match the original Check `38524473765`, attempt 1,
job `115721472397` at `9b6a83d95ffc0f555d120323c94c8c3ea9b7f333`.
The failed guard-line-comment Vapor child printed exactly `{"passed":1}` before
SIGSEGV11. Original stdin bytes, Node PID, physical images and core were not
retained; this is a historical replay envelope, not recovered original stdin.
The original attempt's JUnit XML normalizes an embedded LF, so replay code was
also checked against the complete original job log.

The driver executes exactly two each of the original natural-exit observer,
current guarded observer and historical build-only natural-exit observer.
Build-only uses the literal original `loadRuntime` including its exact defines,
single-chunk assertion and module import. It creates no DOM and never claims a
passing DOM case. Three separately labeled controls require zero exit, exit 1
and actual SIGSEGV after the exact passing payload. Synthetic controls are not
genuine reproductions. No retries, stress loops, Cargo builds or workspace
campaign run here. Any unexpected signal remains failure after passing JSON.

The preload retains synchronous PID/start-tick events, open-executable identity,
dlopen entry/return, maps and mapped-provider hashes, imported data-module bytes,
stdout-write markers and beforeExit/exit. Whole input/stdout/stderr and actual
Node wait status/signal are separate files. Instrumentation adds overhead, and
the diagnostic parent differs from the original 16-slot nextest topology.
Six successful ordinary children cannot prove elimination. Current guarded
children use `execve`, bypassing native cleanup; they do not prove that cleanup
is sound. A JavaScript exit marker also precedes native environment cleanup.

No core limits or global `core_pattern` are modified. Core capture is explicitly
unavailable without verified private-guest custody; this probe does not attempt
to obtain that authorization. Native pathname hashes/maps are observations,
not an authenticated genuine-fault stack or complete retained core sysroot.

The manual workflow override is diagnostic-branch-only and must be restored to
its exact original blob before any final PR. Historical and current trees have
separate frozen installs; all source/helper/input bytes are hashed in receipts.
