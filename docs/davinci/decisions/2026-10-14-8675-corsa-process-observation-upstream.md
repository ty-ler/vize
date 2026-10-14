# Corsa process observation lives in corsa-bind, not in a vendored copy

Pull request: [#8675](https://github.com/ubugeeei-prod/vize/pull/8675).

#8675 needed to keep the stderr and terminal state of the Corsa processes that
the type checker and editor LSP spawn, so that a native shutdown can be told
apart from a real failure. It did that by vendoring six Corsa crates (about
65,000 lines) under `vendor/corsa_*` and patching them.

The patch itself was about 180 lines: an opt-in `ProcessObserver` /
`ProcessReceipt` in `corsa_core`, its re-export and use in `corsa_lsp`, and
two lint fixes. The maintainer decided on 2026-10-14 to add that API to
[`ubugeeei-prod/corsa-bind`](https://github.com/ubugeeei-prod/corsa-bind)
instead ([corsa-bind#514](https://github.com/ubugeeei-prod/corsa-bind/pull/514))
and to depend on the published release.

Why:

- Corsa-bind is maintained by the same maintainer, so the API belongs there
  and other consumers get it too.
- A vendored copy would have to be kept in sync with every corsa-bind release
  by hand, and its custody manifest pinned every vendored byte.
- The API is purely additive, so it ships as a corsa-bind minor release and
  Vize only raises the dependency.

The Vize change keeps the canon and maestro code from #8675 and its unit
tests. It drops the vendored crates, their custody manifest and the CLI test
that drove a Python wrapper.
