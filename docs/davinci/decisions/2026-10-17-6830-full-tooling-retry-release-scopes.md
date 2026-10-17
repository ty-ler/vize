# Preserve retry and release input contracts after workflow changes

Tracked in [#6830](https://github.com/ubugeeei-prod/vize/issues/6830).

Full Check [38988499789](https://github.com/ubugeeei-prod/vize/actions/runs/38988499789)
exposed two stale tooling contracts. Neither failure requires changing the
production workflow or reducing its checks.

The Rust retry test read the retired download `name` field. The current
consumer selects a verified immutable artifact ID. Exercise that real selector
with the producer's source-bound upload name: a failed-only rerun keeps the
completed producer's ID, while a full rerun receives a replacement ID.
Foreign run/source selection, changed archive bytes and stale source receipts
remain rejected. The existing archive-download tests cover bounded transfer
retry, cleanup, digest enforcement and fatal completion gates.

The one-time v0.457.0 consumer contract was absent from the explicit release
test inventory. Keep it in the existing broad scope: its compressed incident
ledger and Git-selected Rust authority are runtime inputs beyond its static
imports. Assert selection for those inputs, the original consumer, Deno policy
and workflow. Source identity and all incident refusal controls are unchanged.
