# Return navigation fixture failures through Result

Owner: [#8371](https://github.com/ubugeeei-prod/vize/issues/8371).

The fourteen `clippy::expect_used` failures at `e4be66d` were followed by
fourteen genuine `clippy::panic` failures at `9445ec5` in
[the affected Rust build](https://github.com/ubugeeei-prod/vize/actions/runs/38178785141/job/114586863269).
The first repair was insufficient: ordinary fixture helpers do not inherit
the repository's exemptions for annotated tests. Both original failure packets
remain evidence; neither is converted into passing qualification.

The one test-only producer `0c7af488f473d5eb9d8679bc94c8a7ded6a9e583`
returns filesystem, JSON, URI and fixture-member errors through `Result`.
The three native tests return those setup errors to the Rust test harness.
Every original test statement and assertion is retained, apart from the
explicit return type, error propagation and final success value. Ordinary
helpers contain no `expect`, `unwrap`, `unwrap_or_else` or `panic`.
The original authored fixture is byte exact; no lint allowance is added.

A separately declared finite context binds the complete changed producer and
its one exact harness caller. The original strict-fixture, repair, Canon,
review and two-packet manifests remain unchanged. The new context projects
only the authenticated fixture body to its frozen predecessor before invoking
that original authority; all 113 current paths, 96 source bodies, 51 custody
witnesses, three harness witnesses and 29 native extensions remain mandatory.
Composed mode requires both original absent bodies, while inherited mode
requires both exact successor bodies. Missing or mixed bodies, wrong scope,
duplicate or foreign paths and any original-source drift refuse qualification.

The `9445ec5` Linux project-native campaign separately passes 33 tests with 17
closed raw process sessions, and its paired original400 campaign passes on
the unchanged shipping release recipe. These successful consumer packets do
not replace the failed Rust source gate or qualify this new source.

The [paired original400 run](https://github.com/ubugeeei-prod/vize/actions/runs/38178785021)
retains artifact `11717113502`: all 821 ZIP members pass CRC, and its complete
38,070,645 bytes match the published SHA-256
`e01ddf3706901929b59cc0953703aa8f4949068b8cd6512022bd35f8e197bf83`.
Independent replay preserves both complete 79-packet arrays, all 77 unchanged
responses, exactly 20 approved capability-field differences, and both sets of
16 actual resolve/refusal outcomes. The three original baseline refusals remain
failed; the successor has no refusal failures. All four retained raw sessions
close, and every whole stream hash, byte count and framing record matches.

TODO: rerun the complete exact-head source, native, project-native and paired400
campaigns after the common historical native-driver source guard is repaired,
restack and qualify the remaining children, verify protected merge and installed
release acceptance. The original full Matrix and performance targets remain
unfinished.

## Preserve assertions in unit-return test entries

The fresh-main source run at `d0fc55afc5c6178a436a4612fb41518dad12762c`
passed the selected Rust tests but failed three `clippy::panic_in_result_fn`
checks in [the actual Rust source job](https://github.com/ubugeeei-prod/vize/actions/runs/38182175208/job/114597134143).
Assertions are intentionally fatal in tests, while ordinary preparation errors
must remain fallible. Only the three annotated test entries therefore return
unit again and explicitly unwrap their direct setup calls. Their entire
ordinary helper prefix remains byte exact to the Result producer; all original
cases, assertions, queries and authored fixture bytes remain unchanged.
There is no lint allowance and no ordinary-helper unwrap or panic.

A new finite unit-entry context authenticates the entire producer and its one
changed caller on both sides before invoking the unchanged Result authority.
Both the original Result JSON and its qualifier remain byte exact. The complete original
historical authorities remain separate approved source receipts. Either new
unit-entry body requires both exact successor bodies before any delegation;
mixed old/new producer and caller pairs cannot obtain historical qualification.
The new actual source must retain all 113/96/51/3/29 original witnesses.
The complete archived Result laws run against their literal prior source,
separately from the new actual unit-entry qualification and refusal laws.
The original three Clippy failures remain retained and do not become green.

The `d0fc55afc5` native phase, project-native campaign and paired original400
workflow passed separately. These receipts do not qualify the changed unit-entry
source. Fresh exact-head Actions, protected merge and installed acceptance
remain mandatory; full Matrix and performance completion remain unfinished.
