# Consumer recovery repository timestamps (#6830)

Recovery run `38990889311`, attempt 2, at
`78b75fb151c115ab8f5043e99424c0e55a562081` completed all six consumer replays.
Its finalizer job `117274555191` then refused `original signed integration
changed`: GitHub returned newer `pushed_at` and `updated_at` values inside the
integration PR's `head.repo` and `base.repo`. These clocks describe activity in
the repository, not a change to the historical signed integration.

Prepare artifact `12085630438` and failed-finalizer artifact `12084743637`
retain the same complete `integration.json` (144,236 bytes, SHA-256
`794f583ecbc5cbba07013e0c6806153106e0197d1febf6b870d3df3eb95aeaf2`). The
fresh response that failed comparison was not separately saved. The log records
`pushed_at` changing from `01:30:03Z` to `01:34:38Z` and `updated_at` from
`01:25:44Z` to `01:33:25Z`, all on 2026-10-17. A timestamp-mutated copy of the
retained packet is a regression control, not a recovered final API response.

Use comparison-only copies that ignore the string values of exactly those two
repository fields. Their presence and types remain exact. The only recognized
locations are a run's `repository` and `head_repository`, the integration PR's
`head.repo` and `base.repo`, and each retained Check run's two repository
objects. There is no recursive field-name filter; run, PR, job and other
timestamps still compare exactly. Unknown repository metadata also stays exact.

Apply the same narrow comparison to the original Release and replacement run
rechecks. Preserve the raw packets, their file hashes, the signing input, the
existing original-custody field set, and all admission, C/H/R/attempt/event,
job, artifact, tag, signature and public-archive checks. No publication or source
closure behavior changes, and the original Release remains failed.

Validation: the new snapshot controls and existing recovery, archive, public
identity, JSR and installed-acceptance suites pass (133 tests). Controls reject
changed or missing identities, repository field presence/types, non-repository
timestamps, signed merge data, jobs, artifacts, tags and proof fields; frozen
input objects and serialized raw bytes remain unchanged. The original
500-line recovery test and its retained fixtures are unchanged. Hosted
finalization and signing still require qualification after this fix lands.
