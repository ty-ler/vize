# Stable bare-script reads and deferred importer refresh

Issue: [#8371](https://github.com/ubugeeei-prod/vize/issues/8371).

Historical base: `0a74842b6e6aab5fbc88061b8d69b7c34568c936`.

The original full Actions failure is retained at
[the source-coverage job](https://github.com/ubugeeei-prod/vize/actions/runs/38088497528/job/114319920469).
It records two unchanged bare-script reference laws returning the entire
`ContentModified` error after earlier complete native/Vize vectors succeeded:
the incoming script law (Vize request 13) and the historical ordinary.d.ts law
(Vize request 31). The log does not contain environment trace provenance, so
the specific interleaving remains a source-derived causal diagnosis pending
the hosted deterministic and whole-protocol controls.

The initial diagnostic worker finishes the opened source's own diagnostics,
then calls importer refresh with `current_owner_invalidated = false`. An
importer in the same owner therefore marks the disk project dirty again.
For .ts/.d.ts this advances the native environment generation twice even when
the opened source set has settled and the active native request already
synchronized those buffers. The unchanged request scope correctly refuses its
reply. This late synthetic invalidation is the unnecessary mutation.

Prepare the owner's disk view once at the open boundary, before scheduling the
initial worker. Both the worker's exact fan-out entry and immediate open
fallback then use the existing current-owner-prepared entry. Other importer
owners still receive one deferred invalidation per fan-out. Close, didChange,
watched-file and native request guard policies remain unchanged. No new retry,
deadline, backend, queue, pipeline stage or fixture modification is introduced.

Three deterministic source controls retain the original plain.ts/ordinary.d.ts
bytes and exercise actual server paths: a live native scope remains current
across the worker's exact same-owner fan-out after prepared open; an actual
cross-owner declaration edit advances the full owner revision vector once per
affected owner despite duplicate importers while preserving an idle owner;
active authored mutation still yields the entire ContentModified error through
the native wrapper, and superseded worker work changes no owner. All controls
require no backend to be created. The separate hosted qualification must also
run all eight original bare-script laws with their unchanged inputs, complete
vectors, disk assertions and frozen runtime.

`strict-production-inverse.patch` restores the original early-open and delayed
worker/fallback dirtiness behavior, retaining the controls and request guards.
It passes `git apply --check`. Its same-owner worker law must be observed RED
before a successor can receive causal proof credit. The other complete laws
must remain GREEN. Source-only rustfmt, strict assertion scan, length checks and
protected-path equality passed locally. Cargo, rustc and native runtime were
not executed locally; Actions is the qualification authority.

This source decision is paired with the existing issue. Fresh hosted native
controls and the original eight-law protocol report remain qualification
requirements; source review alone does not establish runtime completion.
