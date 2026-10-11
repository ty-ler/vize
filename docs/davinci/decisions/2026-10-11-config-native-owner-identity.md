# Native configuration ownership identity (#8371)

The independent-owner control on #8476 failed in native Actions
[38104755717](https://github.com/ubugeeei-prod/vize/actions/runs/38104755717)
and full Check
[38104801624](https://github.com/ubugeeei-prod/vize/actions/runs/38104801624).
Both independent native processes returned `api-session-1`.

This is the provider's actual contract: its
[package-level atomic counter](https://github.com/microsoft/TypeScript/blob/e73c923cb58e9ea8cd75ba41c51b8d8886af3076/tsc/internal/api/session.go#L39)
is incremented by `NewSession` and formatted as `api-session-%d`. Each process
starts its own counter. The
[LSP attachment](https://github.com/microsoft/TypeScript/blob/e73c923cb58e9ea8cd75ba41c51b8d8886af3076/tsc/internal/lsp/server.go#L2282)
returns that identifier together with its generated communication pipe. The
pinned Corsa 1.14 binding exposes both fields and connects to the returned pipe.

Compare the complete `(pipe, session_id)` attachment identity across owners.
Retain the distinct pipe assertion, actual PID/birth/executable identity,
exact one-native-child-per-project assertion, exact project configuration,
whole clean/error diagnostics, continued independent-owner response after
the first owner is reaped, and second-owner reaping. No production transport,
diagnostic oracle, timeout or resource ceiling changes.

Fresh native and full Actions are still required. The preserved failed runs
remain historical failures and provide no completion credit.
