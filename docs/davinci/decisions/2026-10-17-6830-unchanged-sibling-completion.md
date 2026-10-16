# Preserve completion documentation across unchanged project synchronization

Full Check [38929265536](https://github.com/ubugeeei-prod/vize/actions/runs/38929265536)
at `a00fb6cff9268e1371ba260739d905050e2a2573` failed the existing real VS Code
host assertion that `ownSlots.header` resolves to Markdown. Artifact
12057958902 retains the authored sources and hover responses, but no
completion/resolve packet. The failure alone does not identify the cause.
The separate TS-45 four-editor qualification passed all 16 steps and their
negative controls; that scenario does not exercise this host operation.

A passive first-observation capture at `15cea8fa28f3b5cf595265e41ff690e5165532be`
passed the original host action in run 38931939784. All eight original member
completion operations returned Markdown; `header` was the sole candidate at
index zero. That observation rules out the first-16 resolution limit for
that run only. It is not a repair or a reconstruction of the failed response.

A deterministic native control preserves the complete original Rich, Slot,
and InvoiceCard sources, the exact incomplete Slot overlay, actual locked
Vue declarations, and native 7.0.2. It first materializes Rich, then adds Slot
to the same Canon project, issues the original header candidate once, and
interleaves one explicitly ordered diagnostic before resolving that candidate.
Run [38934300022](https://github.com/ubugeeei-prod/vize/actions/runs/38934300022)
at `7e13f5bb28520a9c643c6e7e515b7764c4cb95f6` actually executed nine tests:
immediate resolution, unchanged same-document resolution, and all six
existing Maestro resolve contracts passed; unchanged sibling diagnostics
caused the sole failure. Artifact 12059823868 preserves complete raw native
protocol and first-issued/resolved packets. Native SHA256 is
`4f2de678286401759b3fb4475bafe35b8f32b4b3a07d92642bbf37eadc9b34a4`.
An earlier diagnostic source failed compilation before any test ran; it
provides no product evidence.

The failing native trace shows Slot materialization reloading the same
canonical project and closing unchanged Rich and InvoiceCard overlays.
After the candidate is issued, Rich diagnostics reopen those exact buffers.
That real mirror mutation correctly advances the global generation and
revokes all issued completion capabilities. Consequently the original
resolve is refused before any `completionItem/resolve` reaches native.
Neither authored document changes its bytes or revision in this case.

The repair changes only project synchronization. Before a topology reload,
retain an existing overlay only when the root and effective configuration
are unchanged, the root is Canon's generated project, the URI names the
same canonical physical file, disk bytes equal the retained bytes, and the
file is absent from every changed/created/deleted set. Restore those buffers
after the existing reload so subsequent sibling diagnostics need no close
and reopen. Actual materialized-file notifications still advance generation.
Root, configuration, and materialized-session transitions retain nothing.
All completion generation, whole-issued-item, foreign-position, reopen,
mutation, and native-session refusal code remains unchanged. There is no
resolve retry, new completion query, longer deadline, or relaxed assertion.

The legacy corpus at `tests/_fixtures/differential/lsp/unchanged-sibling-completion`
retains complete authored inputs and both successful and failed historical
packets. Additional native controls edit a sibling, delete a dependency, and
reopen the target with identical bytes/version; each requires the original
candidate to remain wholly unresolved. Canon controls cover unchanged byte
and path identity, all materialized delta kinds, missing files, symlinks,
root/configuration/mode transitions, and the existing six issued-item laws.

Validation of the repaired source is pending. The isolated diagnostic workflow
is temporary and must not land. Fresh focused native execution, the unchanged
actual editor host scenario, final combined-source Actions, protected merge,
and release remain separate requirements. The original unrecorded host failure
must not be retroactively asserted to have this exact causal chain.
