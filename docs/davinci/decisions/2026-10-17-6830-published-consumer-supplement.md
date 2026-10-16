# Proposed one-time consumer proof for published v0.457.0

Issue: [#6830](https://github.com/ubugeeei-prod/vize/issues/6830).
Status: proposed; local implementation and refusal controls are not hosted proof
or authorization to close a release receipt.

The original [Release R38805261385](https://github.com/ubugeeei-prod/vize/actions/runs/38805261385)
at attempt 3 has 54 successful jobs, one failed Deno consumer, and one deliberately
skipped manual crates handoff. The failed job is
[116687943513](https://github.com/ubugeeei-prod/vize/actions/runs/38805261385/job/116687943513).
All 42 original artifacts and the original failure remain evidence. Source
[#9196](https://github.com/ubugeeei-prod/vize/pull/9196), its H, pin and annotated
tag must remain unchanged. The P0 fixes merged later require a separate release.

The frozen Deno configuration encounters both the fresh-package age policy and
manual node_modules resolution. [#9257](https://github.com/ubugeeei-prod/vize/pull/9257)
fixed the current consumer configuration while preserving the original assertion
program. Its [successful public check](https://github.com/ubugeeei-prod/vize/actions/runs/38904123567)
supports the repair, but does not itself bind all historical release identities.
This proposal replaces only the remaining-publication-gate advice in
[the source restoration record](../../release/2026-10-17-source-receipt-recovery.md):
waiting and rerunning old workflow bytes does not apply the configuration repair.
The source restoration and immutable-source guard remain unchanged.

A single incident-specific, main-only workflow runs the exact H consumer against
public `jsr:@vizejs/vize@0.457.0` using pinned Deno 2.9.7. Its empty cache and home
are outside the checkout; no workflow credentials or provider overrides enter
the consumer process. The approved config retains the one-day age policy for
external dependencies and exempts only the exact owned closure. All seven JSR
facade files must equal generation from H. The script authenticates H/C/pin/tag/R,
the signed metadata integration V and H/V catalog equality before and after the
consumer. Moving main is not the published catalog; prepublication promotion
continues requiring its original strict catalog equality.

The complete original API/log capture is retained in
[published-0.457.0.json.gz](../../../tools/support/release/incidents/published-0.457.0.json.gz).
Its decompressed SHA-256 is
`9db9805310dff2f7d5bf3363274b7297df49206e0c483ccf7a170e03f1eab8a5`.
It records the original run, all jobs/steps, all artifacts and the raw Deno log,
captured read-only on October 16 UTC. Tests reject newer attempts, additional
failures, missing or changed evidence, and unauthorized runtime/config inputs.
The public run must reproduce this inventory; unrelated repository profile
timestamps are not release identity. Expired evidence or a different incident
requires a new review, not a fallback.

## Manual finalization boundary

After the proposal merges, coordinate with the release owner before running the
read-only workflow on main. Independently inspect the completed successful run,
latest attempt, own repository, exact policy SHA and successful consumer/upload
steps. Verify the API artifact digest against the downloaded ZIP before reading
its sole `proof.json`; verify its context and `status: passed`. Failure artifacts
are also uploaded and never authorize completion. Retain the run, artifact ID,
digest and complete proof outside the expiring Actions artifact store.

Immediately before any manual closure, recheck source #9196, H, pin, annotated tag,
original R/attempt and the complete publication evidence, and coordinate with any
active operator. Freshly verify **all** public targets from H's existing
`derivePublicationPlan`, plus JSR: npm versions, crates, Marketplace and GitHub
Release assets. Public visibility supplements the original successful tarball,
native ABI, lifecycle and publication gates; it does not replace them. Close the
unmerged source receipt only after this independent review accepts the combined
evidence. Preserve R's failed outcome and its original job/log/artifact identities.

There is no new Operator mode, automatic closure, tag, publication, retry or
durable ref. Ordinary resume/promotion semantics do not change. Remove this
one-time workflow/script after reviewed finalization while retaining the source
and proof receipts. Neither implementation nor proof-artifact existence establishes
release completion or the original ten-minute end-to-end release target.
