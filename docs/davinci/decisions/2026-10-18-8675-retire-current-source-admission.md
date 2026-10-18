# Retire current-source admission from historical Reader frames

Status: accepted scope correction for the remaining #8675 work.

The historical NoDeep, setup, SDK and component Reader frames recorded exact
reviewed source transitions. Their hashes and pair counts describe those source
transitions. They do not authorize unrelated current production changes or prove
current Vue behavior.

## Decision

Retire only the following roles:

- Treating the historical 112-pair dual frame as an admission policy for current
  production source.
- Requiring a current source wrapper to reconstruct a particular historical
  insertion with a textual inverse.
- Claiming current acceptance from historical 112, 237 or 323 body/count labels.

The unused `gitReaderHarness` dispatch wrapper is removed from
`tests/performance/support/warm-type-backed-git-reader-harness.ts`.
`gitReaderHarnessPairs`, the original source constants and
`qualifyGitReaderHarness` remain unchanged because the current raw-Git authority
tests use them. No production request, lint rule, provider selection, package
policy or semantic classifier changes.

Keep the original five-law driver at
`bee0fb6bbb4bea9947c1416f542068c1511657f1:tests/tooling/warm-type-backed-git-reader-nodeep.test.ts`
and the raw historical source evidence retained by original #8675 at
`df973f70687c8607c0dbef9c8b7b87acf00819ae`.
Do not rehash its current tuple, replace its expected bodies or report it as
executed by a current substitute. Archived source strings are historical evidence,
not active test enrollment.

## Retained contracts

The historical NoDeep/setup/incoming qualifiers and their currently used refusal
tests remain intact. In particular:

- `tests/tooling/warm-type-backed-git-reader-setup.test.ts` still verifies the
  authentic historical NoDeep pair and rejects changed/absent sides, partial,
  duplicate, unknown and inherited-family entries.
- `tests/tooling/warm-type-backed-git-reader-incoming.test.ts` retains complete
  historical incoming bodies and refuses relabelled whole preset laws.
- `tests/tooling/warm-type-backed-git-body-authority.test.ts` retains real Git
  commit/blob replacement controls and the original six-pair qualifier.

Current source and product authority belongs to its actual owner:

| Owner                      | Existing contract                                                                                                                                                                                                                                                                                                                                                         |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Checked SDK source         | `tools/support/compat/github/checked-corsa-source.test.ts`: real Git raw/physical body, mode, symlink, HEAD and replacement-ref refusals; complete source census and license substitution controls.                                                                                                                                                                       |
| Native snapshot source     | `crates/vize_canon/src/lsp_client/editor_lsp/snapshot_source/tests/native.rs`: full stdlib and acknowledged overlay bytes from the owning real snapshot, foreign/absent/released owner refusals and retained encoded responses.                                                                                                                                           |
| Snapshot project selection | `snapshot_source/project_identity_tests.rs`: complete typed descriptor, absent/foreign/duplicate/changed identity and empty handle refusals.                                                                                                                                                                                                                              |
| Vue diagnostics            | Existing whole-result tests in `lint-props-deep-destructure.test.mjs`, `lint-runtime-prop-defaults-cli.test.mjs`, `lint-setup-export-defaults.test.mjs`, `lint-default-migrations-cli.test.mjs` and the corresponding Patina/Maestro modules. These compare native CLI/LSP results and authored inputs, rather than approving file names or newly selected source hashes. |

These contracts protect their own current behavior. They do not establish
byte-level equivalence to, or execution of, the retired historical current-frame
policy. An execution claim still requires actual results bound to the tested
source and provider.

## Completion boundaries

This decision neither closes #8675 nor grants public-package acceptance. Preserve
the original intent ledger, the still-active refusal tests, and the required
replacement merge and public-consumer evidence. New SDK namespaces and registry
publication remain separate release decisions.

Do not introduce another hash-selector API or expand source capsules to follow
ordinary product evolution. When an actual Vue defect is found, preserve its
minimal authored input and add a direct regression to the existing product owner.
