# Proposed composite recovery for the immutable 0.457.0 Deno consumer

Status: **Draft authority change. Do not merge or dispatch either recovery operation until the maintainer explicitly approves this proposal.**

The immutable release source is H `03882089eff75664abe99ba71868e33739496b01`,
with its single parent C `014bd42cacdf3d026fb75162cfa80dce76d78315`.
Source [#9196](https://github.com/ubugeeei-prod/vize/pull/9196) remains an unchanged,
unmerged draft. The annotated tag object
`46536212e8e1a16492f9e196d84908286170d57b` points to H. Signed integration
[#9197](https://github.com/ubugeeei-prod/vize/pull/9197) delivered the same tree
at `b4be3b70977b80a689c8e5ada62d05283e86b868`.

[Release R 38805261385](https://github.com/ubugeeei-prod/vize/actions/runs/38805261385)
attempt 3 rejected the newly published JSR version under Deno 2.9.7's default
24-hour dependency age. Attempt 4 ran after that age elapsed. Its sole failure,
[Deno job 117254411511](https://github.com/ubugeeei-prod/vize/actions/runs/38805261385/job/117254411511),
is different: the consumer's empty `package.json` selects manual `node_modules`
resolution, but nothing installed the npm dependency re-exported by JSR.
The remaining original 55 jobs are 54 successes and the original single skip.
The complete original 56-job packet and the complete failed-job log hash are
frozen in this proposal. An additional failure, a changed job, a missing job,
or another original attempt requires a new review.

The existing `resume` path reruns the original workflow bytecode at H. It cannot
acquire a repaired consumer fixture from moving main. Its successful-publication
rule and the ordinary public verifier require original R success. The existing
retirement path requires an unpublished cut, so published 0.457.0 cannot use it.
Changing H, moving the tag, substituting a new R, or labelling R successful would
violate the existing receipt. None is proposed.

The earlier read-only [JSR package run 38904123567](https://github.com/ubugeeei-prod/vize/actions/runs/38904123567)
proved #9257's consumer policy against published 0.457.0 at source
`1b6f856f4f276b853f649df42943a1fd5ac2798d`. It remains supporting evidence,
not an authoritative replacement for the failed release job. Its policy has
explicit owned-package age exclusions. This proposal uses no exclusions or age
override: its entire added Deno configuration is `{"nodeModulesDir":"none"}`.
Deno 2.9.7 retains its default 24-hour dependency age. The original empty
`package.json`, exact JSR import, facade/config/native compiler assertions, and
consumer bytes remain unchanged. The consumer SHA256 is
`410be5021e5c1bff706191bf68045ddbc2edbaa47b13325ddde3daa22926851c`.

## Decision being requested

Authorize **only this exact source/tag/R/attempt tuple** to use a successful,
separately authenticated unchanged-consumer run in a distinct composite receipt.
The original Release conclusion stays `failure` in APIs, artifacts, output and
records. Ordinary successful-release verification remains unchanged. There is
no generic accept-failed-run flag and no weakened consumer assertion.

Approval would permit the following two separate official operations after this
reviewed source has merged. It would not authorize a source rewrite, retag,
republish, arbitrary failure substitution, or automatic next release.

1. Run `Release Operator` on main with operation `consumer-repair`, source PR
   `9196`, source head H, source tag `v0.457.0`, and Release run `38805261385`.
   Leave all other inputs empty. The existing protected `release-operator`
   environment checks the same original/current maintainer user and role.
   Its authorization job then ends. A **different runner**, with only read
   permissions and no maintainer secret, executes the unchanged H consumer in
   a new empty project/cache with the host-only configuration. It retains all
   commands, whole stdout/stderr, exit/signal, runtime, source/config hashes,
   lockfile, original packets and a supplemental artifact. It performs no writes
   to GitHub release state, sources, refs or registries.
2. After that operator is terminal success, run `Release Operator` on main with
   operation `accept-consumer-repair`, the same fixed source/H/tag/R inputs,
   `consumer_operator_run` equal to the successful supplemental run ID and
   `consumer_policy_sha` equal to its exact reviewed main SHA. Leave
   `operator_run` and `source_cut` empty. This protected action verifies both
   successful supplemental jobs, owning identity, first attempt, signed main
   ancestry, every consumed policy file byte, and the retained artifact digest.
   It reauthenticates the original 56-job failure, unchanged H/tag/pin and signed
   integration, and the unchanged current shipping catalog/version. It runs
   the normal full public npm/crate archive checks plus fresh npm registry
   ECDSA verification, decoded SLSA source/digest/workflow checks, JSR member
   hashes, Marketplace/Open VSX observations and all original release asset
   metadata requirements. Sigstore verification is not claimed.

Only after those checks and a final unchanged-source/no-other-owner check may
operation 2 post one concise **own release source** comment recording the exact
composite identity and durable close intent, then PATCH **only #9196** to
`state=closed`. It preserves the unmerged draft, body, branch, H, tag, catalog,
original failed R and all published bytes. Both mutations have explicit
allowlist laws. A prior close-intent marker causes refusal rather than an
automatic retry. Failed/ambiguous mutation output is retained for inspection.
No next-cut dispatch exists in the implementation.

The `release-457-composite-acceptance` artifact records the failed original R,
successful supplemental operator, accepting operator, full public observations,
and exact closure. Only after operation 2 is terminal success and the unchanged
unmerged source closure is freshly confirmed may a **separate** ordinary
`operation=start` evaluate its existing guards and prepare the next minor.

## Existing next-release guards

`pr_pin_dispatch.rs::version_owner` rejects any other **open** `release/v…`
source receipt. `pr_pin_start.rs::start_selected` checks the expected current
main cut, prepares an isolated version change, checks that owner inventory,
and acquires the normal operator lease. `pr_pin_retire.rs::next_minor` checks
retirement reservations for the next target. None requires a previously closed
source's original R to become green. Thus authenticated composite closure can
unblock ordinary next-minor admission without changing those functions.

The old `resume`, `published_identity`, and watcher rules stay strict: they
continue to reject a closed failed-R source as ordinary successful publication.
Operators must use and report the explicit composite record for 0.457.0, never
pretend that a later ordinary resume can reconstruct it. The existing local
continuation script which requires R success must remain stopped; this proposal
does not rewrite or silently bypass that script.

## Qualification and cleanup

Offline laws cover the whole original job packet and failed log, mismatched
C/H/tag/PR/R/attempt, changed or missing additional jobs, original-run races,
foreign/ordinary operators, failed or duplicated jobs, source-policy mismatches,
unsigned/non-main policy, missing/expired/unhashed artifacts, immutable
source/tag/pin/integration mutations, real ECDSA refusal cases, JSR/asset
failures, and the exact two permitted writes. Process laws retain arbitrary
bytes before rejecting nonzero exit, signal and spawn failure.

The existing JSR package CI runs these laws, the unchanged ordinary public
acceptance suite, and the focused native TypeScript project. On this Draft's
source branch it also executes the exact H consumer read-only with the proposed
host-only configuration. This source check is evidence for the proposal; it
cannot create the protected supplemental authority or close #9196. Its actual
hosted outcome must be recorded before a decision. No recovery operation is
dispatched as part of preparing this proposal.

After composite recovery and the next minor's public acceptance, remove the
source-branch-only historical consumer probe. Preserve the frozen original
failure evidence and explicit composite verifier while supported 0.457.0
receipts require it. This is a single historical repair, not a new generic
release exception framework.
