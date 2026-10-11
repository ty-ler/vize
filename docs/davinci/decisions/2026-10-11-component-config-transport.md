# Loaded component policy reaches CLI and editor consumers (#8142)

The existing #8497 API slice removes guessed framework names and custom-element
prefixes. Its remaining delivery boundary is the compiler matcher: the actual
CLI and editor constructors previously discarded it after loading configuration.

The CLI now uses the existing checked `LoadedProjectConfig` host API once. Its
document produces the same lint plan, features, execution settings and project
root, plus `document.clone().into_compiler_custom_elements()`. Each distinct lint
group receives that matcher while retaining entry-local explicit global names.
`--no-config` retains its original default configuration and empty matcher.
There is no second evaluation, discovery pass or new parser stage.

The editor stores compiler policy in its existing private project context and
process fallback snapshot. Patina receives the matcher from the same selected
workspace context as the lint plan; existing callers keep their three-field
settings interface. The deepest enclosing folder, ignores, rule severity,
explicit globals and selected Nuxt preset keep their existing ownership. A
neighboring root does not inherit another root's custom-element declaration.
Existing Musea settings reads avoid cloning the compiler matcher they do not use.
Compiler globs and original Vue ESLint `ignorePatterns` remain distinct APIs.

The original 30 authored SFCs, all 120 API observations, eight JSX/TSX packets and
60 pinned full 51-rule reference observations remain unchanged. New consumer
laws compare 180 complete actual CLI packets across discovery, explicit file
and explicit directory selection, and 90 complete JSON-RPC publications across
30 workspace contexts and three revisions. They judge every diagnostic field,
including unrelated findings, rather than filtering to the registration rule.
The CLI config counter requires one actual JS evaluation per invocation.
Additional editor controls retain a Unicode/CRLF missing neighbor, process
fallback, root isolation and actual watched policy replacement. A sibling keeps
its distinct declared element after the owner's watched policy is replaced.

This is a new child of the configuration native Stack #8400, after #8531. Its
parent APIs and original 400-provider qualification remain separately required.
The parent's finite source-body custody cannot automatically authorize these
new matcher bodies; this child needs its own exact-source qualification.
Its separate selector binds all 27 child production bodies and the 112-body
original parent/child composition. Both scopes retain the parent's complete
90-body source authority, all 51 custody bodies and every explicitly pinned
harness successor, plus the unchanged original registration corpus/API/oracle.
Unknown, omitted, duplicate or drifting bodies fail closed. Selector admission
does not qualify the actual 400-provider packets or a performance improvement.
The original source preparation was backed up before replay; all original
fixtures and incoming decisions are retained.

The existing `rust-full-workspace-${github.sha}-${github.run_attempt}` artifact
retains `target/nextest/full/` and the exact component-context packet directory.
No extra upload, job or compilation is added. Its component receipt must bind
the actual source SHA, run/attempt, artifact ID/archive digest and each full
member's SHA256 after download:

| Member in `differential/component-registration-context-8142/` | Required observations                                        |
| ------------------------------------------------------------- | ------------------------------------------------------------ |
| `whole-packets.json`                                          | Original 120 API packets                                     |
| `jsx-whole-packets.json`                                      | Original eight JSX/TSX packets                               |
| `cli-transport.json`                                          | 180 CLI packets                                              |
| `cli-one-evaluation.json`                                     | Six CLI calls and evaluation counters                        |
| `lsp-transport.json`                                          | 90 versioned publications and complete protocol              |
| `lsp-policy-replacement.json`                                 | Four required workspace/reload packets and complete protocol |

The public observer is part of this same source PR and the existing public
acceptance workflow. Eligibility requires #8497 actually merged into the release
cut, all executed component harness bodies equal the frozen release head, and
the complete original 30-case corpus copied from that head without changes.
It authenticates the terminal successful Release, tag and source PR, the exact
public GNU CLI archive and sidecar, and the freshly installed executable digest.
It replays the same 180/90 complete packets, six evaluation counters and four
required reload observations. Every additional reload publication is judged
against its own live policy; raw CLI bytes, complete JSON-RPC frames, stderr and
ordinary process exits remain available on failures. Final sealing binds every
whole packet file, original corpus, archive, sidecar and executable again.

The new component observer runs after the original native DOM, SSR, browser and
VRT observations with independent prerequisites. Its eligibility or runtime
failure retains evidence without suppressing those original observations;
successful public completion additionally requires the component observer.
Earlier releases cannot receive credit for this later, unmerged transport fix.

Local formatting and the 12 config-host boundary controls pass. Actual consumer
execution, fresh source/full Actions, unchanged instruction ceilings, protected
queue, signed merge and genuinely included installed release acceptance remain
unfinished. This bounded transport does not close the full 51-rule, editor,
type-aware lint or performance requirements of n8n adoption. Upstream stays
read-only.
