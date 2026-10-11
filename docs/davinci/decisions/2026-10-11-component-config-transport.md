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
Its separate selector binds all 28 child production bodies and the 113-body
original parent/child composition. Both scopes retain the parent's complete
90-body source authority, all 51 custody bodies and every explicitly pinned
harness successor, plus the unchanged original registration corpus/API/oracle.
Unknown, omitted, duplicate or drifting bodies fail closed. Selector admission
does not qualify the actual 400-provider packets or a performance improvement.
The finite JSON authority is split into three explicitly named parts. Reassembly
retains all 90 production rows and 51 custody rows, and the same complete-value
SHA256 binding; each part has at most 350 lines. The editor's private lint
installer lives in its own module to retain the source-length gate.
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

The historical producer at `11910fb33a676265265050f8000769e3939c636d` retained
all six members in [run 38109907088, attempt 1](https://github.com/ubugeeei-prod/vize/actions/runs/38109907088).
Rust job `114383136249` succeeded, including all ten component tests; its whole
workspace JUnit has 17,380 cases with no failures or skips. Artifact `11692275416`
has exactly 12,037,294 downloaded bytes and archive SHA256
`5c3c8a248161e86fe33a0068d2003bde0d23a26c82e2b197b224bbb77da85182`,
matching GitHub's advertised digest. Independent whole-packet judgment found
no mismatch in the 120/8/180/6/90/4 observations or the counters `1..6`.

| Whole member                  | Bytes     | Downloaded SHA256                                                  |
| ----------------------------- | --------- | ------------------------------------------------------------------ |
| `whole-packets.json`          | 79,209    | `124652ec9747ccb2b9bdd542afa767bba3326ee9d0d90000f2077ec9bd6a012e` |
| `jsx-whole-packets.json`      | 6,214     | `b6b792b66c34eb9fcefccdf76e3ac2a01e7de1dc5a81c8337ba41e24c2a5b9c1` |
| `cli-transport.json`          | 315,490   | `248eeae7299b4fbe0b4cb23f25cc3325b5d5dd8186a324d398320a401d83b0b6` |
| `cli-one-evaluation.json`     | 7,048     | `533a71962bc62f5a0a04c4daaf6b07273018829f6c5272dfbc803da4e38177a8` |
| `lsp-transport.json`          | 3,497,915 | `9e975e798e7dfba113fb778d2325ae9161e20f4ed724a2c4f6ea1bc4c55b0256` |
| `lsp-policy-replacement.json` | 193,426   | `5956f26078e71f3904aed563625fb0cc7d7ab665496d0ecf84eccf1114ce4a86` |

The retained whole audit receipt SHA256 is
`ed92c229bbac5c341ff05e6d39d5074850f71bfc439e21c5cffd5c7f5fe481b6`;
the digest inventory covers all 2,347 archive members. The LSP source identity
joins the authenticated artifact/run and timing receipt: its own `sourceSha`
is null, executable bytes were not hashed, and its complete protocol is decoded
JSON rather than raw frames. Full Check was still running when the archive was
audited. This historical receipt grants no current-head, installed release,
400-provider or performance credit.

The exact `fc4c7a8e43f2480b856e19baf4bf02c1c0f58918` producer was also audited
from successful Rust job `114390754841` in run `38112485518`, attempt 1. Its
artifact `11693045152` has 12,037,045 bytes and SHA256
`bdfa9657562337ca6170be0e1a7892dbfad0431e2751153e39059f5a8967fab4`,
matching GitHub's digest. All 2,347 members were independently rehashed; all
120/8/180/6/90/4 complete observations have no mismatch or required value gap.
Its ten component tests and 17,380 retained JUnit cases have no failure or skip.
The whole source receipt SHA256 is
`d758e3d92ad26a831a870ad9c7b1b2828abe501ea4508e7db3f256481584d1d6`.
This grants exact fc4 producer credit with the same LSP binary/raw-frame limits;
it does not grant later-head, full Check, installed-public, reference execution,
adoption, 400-provider or performance credit.

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

The source `fc4c7a8e43f2480b856e19baf4bf02c1c0f58918` has two authentic
failures in [full Check 38112485518](https://github.com/ubugeeei-prod/vize/actions/runs/38112485518):
the unchanged mocked editor existing-config content-edit restart law exceeded
its original 20-second deadline, and Misskey churn sampled peak RSS was
128.1 MiB against the unchanged 128 MiB ceiling. The mocked event archive was
not uploaded: only its raw job log and last ten events survived before the real
host started. Preserve complete mocked events on the next diagnosis; no later
editor scenario receives credit. The RSS metrics and whole LSP custody archives
were downloaded with their advertised SHA256 digests verified. These failures
remain open; a private borrow candidate also exceeded the RSS ceiling and is
excluded from this child's finite source authority. Lower Stack restacking is
owned separately; replay once after its actual coherent parent is published.

Local formatting and the 14 config-host boundary controls pass. Those controls
also pass in fc4's successful `test-scripts` job `114390754793`; its final tooling
group has 7,321 cases, 7,254 passes, no failures and 67 explicit existing skips.
The whole skip lines and raw log remain retained. Fresh exact-head
consumer execution, source/full Actions, unchanged instruction ceilings, protected
queue, signed merge and genuinely included installed release acceptance remain
unfinished. This bounded transport does not close the full 51-rule, editor,
type-aware lint or performance requirements of n8n adoption. Upstream stays
read-only.

The final local replay uses configuration parent `8cf3babc17c75642895fd5a82771b61c1052ffc2`
and its bounded manifest reader without changing the original logical
`433e2847` authority or this child's `bcf13b6e` 28/113-body authority. After
the complete child or composed source qualifies, the distinct child loader
helper additionally binds the exact `a7ff8052` two-body loader context. Missing,
mixed, foreign or changed loader bodies refuse; a null parent-only result
requires the complete matcher successor. Source/refusal laws and local lint
are preparation evidence. Original selected-owner native packets, protected
full gates, the unchanged 128 MiB cap and a genuinely included public release
remain required; the deferred scratch-arena patch is excluded.

The next composition retains the original strict `bcf13b6e`, `433e2847` and
`a7ff8052` authorities and independently binds the complete 28/113 source
footprint to exactly three whole harness successors. The parent `8d3677de`
null-completion successor binds `61921cd7` to `d200def1`; the two child
caller bodies preserve every original row and use the same owner predicate
for qualified project or component context. Extra production owners cannot
receive this authority through another selector. The original 79 packets,
eight additional resolves, eight refusals and all 20 owner fields remain
required on both actual sources. Source laws and a truth table do not prove
those Linux native packets ran. Preserve the parent wrapper failure and the
4b29 green run that omitted all 16 additional controls; neither is completion.
