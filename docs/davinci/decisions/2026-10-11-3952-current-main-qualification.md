# Native graph qualification on current main

Issue: [#3952](https://github.com/ubugeeei-prod/vize/issues/3952).
Implementation: [#8520](https://github.com/ubugeeei-prod/vize/pull/8520).

The finite whole-source graph qualification refused the PR merge checkout in
[Check 38140500342](https://github.com/ubugeeei-prod/vize/actions/runs/38140500342).
Its 188 producer bodies and 44 other preserved bodies remained exact. The
remaining body, `pnpm-lock.yaml`, changed on main in
[#8568](https://github.com/ubugeeei-prod/vize/pull/8568), which added the supported
Vue Vapor runtime alias. The refusal was correct; this change does not exclude
the lockfile or accept a different body on either side.

Merge exact main `fc551dc09faaa3187cd37a3a02cb94ebab0c3352` into the isolated
repair branch, preserving the existing source commits. The new qualification
uses that common ancestor and the complete reviewed producer at
`bbf94a5c634fd2859daaeb62e43a06cdce60844c`. All 188 producer before/after pairs
retain their original digests. All 45 preserved bodies remain identical
between the new before and after source; only the inherited lockfile digest
changes from the preceding qualification. The mutation and Git entry mode/type
controls remain required. This supersedes only the baseline/source pair in the
[preceding composition record](./2026-10-11-3952-native-graph-stack-composition.md);
its historical results retain their original scope.

The source capture test names its three complete buffers through
`Object.entries`, so type-aware lint sees the path name as a string. The same
resolver, candidate and collector byte assertions and all changed/missing-body
refusals remain. No lint allowance is added.

The original authored n8n campaign
[38140500217](https://github.com/ubugeeei-prod/vize/actions/runs/38140500217)
is still failed. Its complete artifact `11702737873` shows the first 419-source
cold graph taking 11.725 seconds and subsequent 1,391-source graphs taking
79.919 to 82.459 seconds. Every recorded cold build has `graph_guard=0`:
the original 10-second caller deadline retires the operation before its graph
can be published, so subsequent requests remain cold. CREATE and RENAME are
observed, but DELETE never receives the required missing-module diagnostics.
Late-publication refusal is retained; increasing the deadline would not qualify
the existing campaign.

TODO: reduce the proven cold construction costs while preserving complete
ordered facts, immutable owner identity, source/configuration authority,
native error precedence and file lifecycle behavior. Fresh exact-source
Actions must pass the original normal/native tests, n8n authored lifecycle,
400-request comparison, full workspace/Nix checks and 128/384 MiB resource
caps before queue admission. Source qualification alone grants no speed,
installed acceptance, release or issue-completion credit.

The next reviewed producer is
`d0c678454696b058e0789e84ea84b1ce6a5a1927`. It borrows the actual registered
package binding and private nested routes instead of recursively cloning them.
The existing stable manifest sort, complete-value adjacent deduplication and
shadow/fact operation order remain unchanged. Two new test modules retain the
literal original clone operations, compare all 65 project fields and complete
ordered facts across six lifecycle waves with observation both enabled and
disabled, and verify actual registered pointers and owner-sharing relations.
The separate private-route control also preserves equal routes separated by
a different same-manifest value; it does not replace full equality with a key.

The complete qualification now contains 190 before/after producer bodies and
the same 45 identical preserved bodies. Only the three reviewed shadow modules
change among the earlier 188 producer pairs; the two new modules are additional
test producers. Fresh Actions must compile and execute these controls and the
unchanged real campaigns. This source change has no measured speed or memory
claim yet. The preceding full Check also failed Misskey's unchanged 128 MiB
server cap at 129 MiB; the resource gate remains required.
