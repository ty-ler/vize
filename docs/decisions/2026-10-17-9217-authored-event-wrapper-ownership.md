# Rejected authored event wrapper ownership proof

Status: rejected; PR #9276 is closed without merge. This branch preserves the
candidate and counterexamples for investigation. Production warning behavior
is unchanged. The source/hash and 70-case inventories remain retained.

Independent review demonstrated two false negatives beyond the candidate's
positive controls. A write through `globalThis.Object.assign` can replace the
intrinsic without an extra `Object` identifier reference. Separately,
`Object.assign` uses `[[Set]]`: an inherited setter on a fresh `{}` can install
a Vue instance method instead of the authored callable. Neither lexical
reference closure nor the absence of explicit `Object` writes proves that the
target acquired the expected property. The rejected proof also used quadratic
span lookups; any future consumer needs sets or sorted indexed lookups.

Exact counterexamples and baseline/candidate spans are retained under
`tests/_fixtures/differential/lint/legacy-instance-apis-9217/rejected-wrapper-proof/`.
Both must retain a warning. A future repair requires an authenticated effect
owner covering the actual copy operation, intrinsic identity, prototype/setter
effects and the resulting own-property identity. A denylist of receiver names
or reflection spellings is not that evidence. Unknown ownership must preserve
the current warning. The one Gogocode foreign call and all eight unknown
receiver identities remain open under #9217; #9251 remains held.

Issue [#9217](https://github.com/ubugeeei-prod/vize/issues/9217) retains one
proven foreign `$on` call in Gogocode's Vue 3 migration playground. Its
`mounted` hook creates an empty local `eventHub`, copies locally authored
forwarding methods with `Object.assign`, and calls that local `$on`. The
`beforeUnmount` hook uses an out-of-scope identifier with the same spelling;
that second receiver remains unknown and must keep its warning.

The complete pinned source is retained as
`crates/vize_patina/tests/fixtures/authored-event-wrappers/gogocode-B.vue.txt`.
It is copied without changes from the existing complete provenance packet:

- Repository: `thx/gogocode`.
- Revision: `6b94d4d05ee4facc935fe2c3e4965655913afd6e`.
- Path: `packages/gogocode-vue-playground/packages/vue3/src/components/events-api/B.vue`.
- SHA256: `136f82332bfa8b7795c5802015fc64859d3fbb794ce3720a73fe7093ecede165`.

The rejected candidate consumes the existing parsed script AST and builds OXC semantic
references only when a possible `assign` transfer exists. Positive ownership
requires a fresh empty local object and a const object literal of distinct,
statically named, authored callable properties, declared in the same statement
list before the transfer. There is no package allowlist. A property called
`$on` can be a local API independently of the library it forwards to.

Only the unshadowed standard `Object.assign(target, methods)` form qualifies.
Every source-map reference must be that transfer. Every target reference must
be that transfer or a later direct call to an owned method in the same
statement list. This rejects aliases, escaped objects, overwritten methods,
reassigned bindings, conditional initialization and deferred callback reads.
Spreads, duplicate/dynamic keys, getters, borrowed method values, `this`,
`super`, dynamic evaluation and semantic errors retain the existing warnings.
Other explicit `Object` references also decline the proof, including attempts
to replace `Object.assign`. As with other global built-in recognition, this
analysis assumes standard globals have not been replaced outside the script.

The candidate acceptance test checks the whole pinned SFC under Essential and Happy
Path presets: its local wrapper call is quiet and its sibling unresolved
`$off` keeps the exact authored property span. Neighbor controls exercise
local callable definitions, independent nested component calls, lexical
shadowing, mutation, escape and refusal. Existing 70 authored controls and
all original provider/native/provenance packets remain unchanged.

This does not close #9217: eight receiver identities remain unresolved and
keep their warnings. Draft [#9251](https://github.com/ubugeeei-prod/vize/pull/9251)
still owns all 17 template controls and its retained-expression authority
requirements. The 53 script controls retain their established ownership.
