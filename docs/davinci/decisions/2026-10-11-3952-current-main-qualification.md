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

At actual source `2d8eacaab295cf0d34d84d5a35425e5933dd837e`,
[full Check 38143438572](https://github.com/ubugeeei-prod/vize/actions/runs/38143438572)
still fails the unchanged Misskey server cap. Artifact `11704151997` retains
all 287 publications and records 132,788 KiB server RSS at `file-lifecycle-0`
(129.67578125 MiB); tree peak is 352,268 KiB against 384 MiB. The smaller route
copies therefore do not establish resource acceptance. The source planner also
found one generated `test/dev` dependency row for the two new Canon tests;
regenerate the consumer-migration ledger without changing its generator.

The [fresh authored run 38143432343](https://github.com/ubugeeei-prod/vize/actions/runs/38143432343)
executes both new route laws and passes 2,032 ordinary Canon tests, then retains
all native refusal controls. Actual artifact `11704280891` still shows DELETE
version 5 receiving `typecheck-timed-out`, not the required missing-module
packet: the first 419-source graph takes 11.887 seconds and later graphs take
80.896 to 87.636 seconds, all with `graph_guard=0`. These observations do not
establish a timing improvement from the smaller route copies.

The next reviewed producer,
`96da838e50a92008a8ef5c478a98669c327193ff`, borrows complete module source bytes
until its owned occurrence packet is produced. The pure parsed-source cache
still compares exact bytes and `SourceType`, returns the same owned ordered
occurrences, and copies source only for retained misses. The existing guards,
references, callbacks, probes, facts and graph-write order remain unchanged.
A literal original owned-cache control compares every cache/source field and
counter, equal-length edits, syntax changes and invalid parse packets; hits
retain the actual saved source pointer and misses outlive caller mutation/drop.
The original complete walk/cache/no-cache control is retained unchanged.

This complete source pair contains 191 producer bodies and the same 45 identical
preserved bodies. Only the four reviewed scanner/parser modules change among
the preceding 190 pairs; the new literal control is the additional body. The
canonical consumer ledger is regenerated. New native/full/n8n/original400 and
resource Actions remain required; this allocation change has no measured
performance or acceptance result yet.

At actual source `a5e97ffb987e923a3b93bf8692ce7d1967f395ab`,
[authored run 38144668819](https://github.com/ubugeeei-prod/vize/actions/runs/38144668819)
passes all 2,034 ordinary Canon tests and retained native controls. Artifact
`11704194238` still shows 419-source graphs at 11.083 to 11.828 seconds and
1,391-source graphs at 81.619 to 82.476 seconds. DELETE's 1,390/1,389-source
graphs take 83.812/83.940 seconds; every graph has guard/takeover zero.
[Original400](https://github.com/ubugeeei-prod/vize/actions/runs/38144668858)
and [native CLI evidence](https://github.com/ubugeeei-prod/vize/actions/runs/38144668825)
pass independently. Full Check's artifact `11704341693` retains all 287
publications but fails the unchanged Misskey server cap at 133,956 KiB
(130.81640625 MiB); process tree peak is 347,944 KiB. The authored timeout and
resource failure remain release blockers.

The PR merge's two full frontier-transfer laws expose another failure:
the current main CLI-first executor combines failed CLI and native completion
packets into exit code 1. Incremental checking first encounters the unchanged
API spawn refusal, then its failed fallback replaces that original refusal
with the combined second failure. Retain the complete first error when both
paths fail, while recording both complete errors in a structured event.
Successful CLI fallback and its metrics stay unchanged. The original
frontier-transfer bodies and their exact terminal error assertions are retained.

Producer `3fdec59f217c0aae6b90f30b03e46f3e85d6e99e` adds the complete existing
executor session and fallback-test bodies to the finite qualification. The
earlier 191 before/after pairs and all 45 preserved bodies remain identical;
the complete pair now has 193 producer bodies. The new actual executable
corpus pins its complete JSON bytes, preserves an independently observed whole
CLI exit-17 packet, and compares the whole original API error after two
incremental attempts. The existing successful-fallback metric law remains.
Fresh default/full/PR native Actions must execute these laws; no result is
claimed from their source qualification alone.

Before another structural optimization, use the separate optional diagnostic
workflow at source `b9fb08a3ffac9ac961ab23e92ba792189a2996df` in
[run 38146821370](https://github.com/ubugeeei-prod/vize/actions/runs/38146821370).
Its native producer remains `a5e97ff` unchanged. It first runs the original
campaign, then repeats the same driver, source-build recipe, original bytes,
oracle, requests and deadlines in a distinct owned process. Attach 49 Hz CPU
sampling and syscall summaries only to the published PID after executable and
checkout verification; retain complete custody, packets and binary/lock hashes.
Observer timings and the second campaign's status grant no acceptance credit,
and the first campaign's failure stays failed. Ordinary jobs keep 20 minutes;
only this optional diagnostic job has a 35-minute envelope. All original
consumer deadlines, caps and registry remain unchanged.

The next producer, `5cad0b6a7fa267a489e7b58eb8cf3f6ceb6a1428`, preserves the same finite 193
producer pairs and 45 bodies. Only the existing fallback test's after body
changes: current SHA-2 returns a digest without `LowerHex`, so the earlier
test failed to compile in [PR Check 38147350153](https://github.com/ubugeeei-prod/vize/actions/runs/38147350153)
and [authored run 38147350140](https://github.com/ubugeeei-prod/vize/actions/runs/38147350140).
Compare all 32 digest bytes directly against the same fixed complete corpus
digest; the fixture, actual API/CLI packets, metrics and refusal laws do not
change. Regenerate the canonical ledger for this removal of a test-only macro
use. Fresh source and runtime qualification is required.

Diagnostic run 38146821370 retains the original authored timeout, but its
optional observer exits before launching the second process: Ubuntu installs
`perf` below symlink directories skipped by `rg --files`. Artifact
`11704789763` retains six pre-probe provenance files and no CPU or syscall
observations. Diagnostic source `88a39e897c4dc86c70932e34e7b399d9d03fe1a8`
follows those directories and reports missing tools explicitly. Repeat the
unchanged original campaign before sampling; no cost attribution or improvement
is claimed from the failed observer.
