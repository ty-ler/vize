# Preserve current source contracts after the main merge

Refs [#6830](https://github.com/ubugeeei-prod/vize/issues/6830),
[#9200](https://github.com/ubugeeei-prod/vize/pull/9200).

Full Check [38993084178](https://github.com/ubugeeei-prod/vize/actions/runs/38993084178)
at `2b0cf6c084ea0d4ab0a3dce33cfb9ebf0e7c8db2` exposed three contract
failures after main added the #9312 build evidence checks and #9251 retained
template analysis. All three failures reproduce locally. Repair their source
contracts without changing workflow selection, product fixtures or budgets.

The planner contract now compares the complete five-test command as argument
tokens, including the existing build evidence test. It still requires the same
tooling-input condition and install-free Node/offline metadata preparation.

Move the two retained assignment/scope walkers byte-for-byte in a separate
commit, then use ordinary `retained/{assignments,scopes}.rs` module discovery.
Their Rust module names, parent visibility and implementations stay identical.
Update both source-custody includes; the module-layout guard remains unchanged.

The declaration CLI contract compares all 19 accepted IDs in original order
against the complete 20-case primary sequence, excluding only the explicitly
unqualified template-this observation. Its actual CLI runner, complete JSON
packets, stderr/status checks and source/config custody remain unchanged.
All original fixture files are retained byte-for-byte.

The existing bounded parser-entry source guard now reports the complete
`(module, forbidden spelling, original byte offset)` violation vector and
requires it to be empty across the same six collection/walker files. Import,
direct-call and fallback controls require exact vectors; spaces/newlines cannot
hide a forbidden spelling. The dynamic parse counters and original AST-pointer
checks remain unchanged. This textual boundary still does not claim to prove
an arbitrary future call graph. The assertion linter and allowlist are unchanged.

All 14 focused workflow/layout/assertion contracts and all 37 tests in the
actual five-test planner command pass. The exact source-guard functions and
their six real inputs also compile and pass in a dependency-free Rust probe;
this is not a full product build. Formatting and the focused TypeScript lint
pass. Fresh combined-source Actions must execute the retained Rust ownership
and complete CLI observations before qualification is complete.
