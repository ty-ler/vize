# JSR Node distribution (#8367)

Publish one `@vizejs/vize` ESM facade with root, `/config`, `/native` and `/vite`
exports. Every entry point re-exports the same exact Vize release from npm;
native binaries stay in the existing platform packages. Node >=22 is supported,
with Vite's additional Node >=22.12 requirement. Runtime portability is not
claimed for Deno, Bun, browsers or Workers. CLI executables and the other npm
packages are outside this first JSR offering.

Package metadata and exports are staged from tracked `jsr/vize/jsr.json` and
aligned release manifests. Publish dry-run checks the genuine JSR source graph,
types and current public npm dependencies. A repository-linked OIDC workflow
publishes only after maintainer scope/package bootstrap, then installs through
the actual JSR CLI in fresh Node consumers on Linux, macOS and Windows. Retain
registry source checksums, exact installed package versions, type checks,
configuration/native compiler output and Vite bundle evidence.

JSR package guards live in `tests/tooling/jsr-package.test.mjs`, preserving the
existing audited 34-file release-contract inventory. Unknown JSR inputs retain
the existing conservative full source gates; no selector or budget is narrowed.

Normal releases freeze the default-disabled `jsr/vize/channel.json` policy so
missing registry ownership cannot block urgent existing-product delivery. An
enabled H requires JSR publication and all four published consumers in its
official Release run. `VIZE_JSR_ENABLED` only authorizes inside that required
publisher: clearing the variable fails rather than skips the required channel.
Existing GitHub Release creation prerequisites stay intact. The 0.440 source cut
was owned by the release delivery lane. This change stayed outside the queue
until its metadata, tag, terminal publication and exact-version public checks
completed. That hold cleared before this change rebased onto actual main
`c6570cb8706dd9a4f16be984c7ecd04bdb57b26d`. The pinned catalog still compares
`release.yml` authority byte for byte, including disabled jobs; each later
publication window requires the same preservation.

Future source cuts also capture the JSR reusable workflow, generator, public
consumer, package template, package README, license, policy and policy reader
as publication authorities.
Any changed byte differs from the qualified catalog; a partial lane fails closed.
The four existing authorities and every existing graph field remain intact.
Enabling JSR is a maintainer bootstrap decision after successful initial manual
publication and all consumer receipts. The catalog captures the H policy,
exact package identity, version and four exports. The public verifier derives
expected facade/README/license bytes from raw H, verifies actual published
checksums, and rejects a missing, skipped or unsuccessful official publisher
or original consumer. Disabled H has no JSR delivery credit. Legacy source H
without this lane retains the original plan and receipt shape. Record exact
publication/consumer receipts with the first and each later enabled release.

Source `fd063b9c8` passed the hosted JSR stage but failed the unchanged original
`release-pr.test.ts:211` contract: a new policy step displaced the required final
candidate authorization step. Keep that original step and its complete env last;
emit the raw-H policy output inside it only after successful original validation.
The audited oracle, original build barrier and pinned verifier flags stay fixed.
The failed source remains failed; corrected source requires fresh whole Actions.

At preparation time the public `@vizejs` scope and package metadata return 404.
Required TODO: an authorized JSR scope administrator creates the scope/package,
links `ubugeeei-prod/vize`, configures Node-only compatibility, enables the
repository variable and runs initial publication. Registry authorization,
actual publication and all published consumer results remain pending. #8367
must stay open and JSR command tabs must not imply completed support until those
receipts exist.

On 2026-10-10 the maintainer explicitly deferred JSR. Preserve the reviewed
source and receipts in draft PR #8388 outside the queue, including the active
0.441 publication window. Registry bootstrap, settings, publication and further
JSR priority work are deferred; do not seek authorization again. Resume only
with fresh source qualification and actual delivery, without historical credit.

On 2026-10-11 the maintainer requested completion of all P0 issues and existing
PRs. Resume source preparation under that instruction while preserving the
previous deferral as history. The clean isolated refresh incorporates actual
main `b7ec71ecd3981fdeffb5df816bd0e811e175b61e`, retaining its release-driver
parent-custody repair, all original law bodies and release workflow changes.
The original PR head `8a9a6703bd6637df4f2e0b66f5cf4f4517cfdc8b` passed Check
`38038393847` and actual hosted JSR dry-run `38038393767`; those runs do not
qualify the refreshed source. The refreshed local JSR laws pass 12/12 and real
Deno 2.9.5 publication dry-run against public npm 0.443.0 succeeds with exactly
seven files. Fresh Actions, protected merge and actual consumers remain required.

The live JSR API on 2026-10-11 returns `scopeNotFound` for `vizejs` and
`packageNotFound` for `vizejs/vize`; `VIZE_JSR_ENABLED` is absent. The external
prerequisite is an authenticated project-authorized JSR account creating the
scope and package at <https://jsr.io/new>. Repository linking requires that same
account to be a JSR scope administrator and a GitHub repository administrator;
the available GitHub credential has repository-admin permission, which alone
does not establish JSR account ownership. The official requirements are
<https://jsr.io/docs/packages#linked-github-repository> and
<https://jsr.io/docs/publishing-packages#publishing-from-github-actions>.
Do not replace the account binding with a registry secret or claim that dry-run
delivers support. Once the source merges and ownership is linked, the initial
exact-version Release JSR run must publish and pass all four Node consumers
before the committed channel is enabled or #8367 closes. Registry creation,
settings changes, publication and consumer receipts are still unfinished.

The live protocol audit also found a publication-verifier defect: on
2026-10-11 linked `@std/path`, `@std/assert` and `@luca/flag` registry
`meta.json` omit `githubRepository`, although the documentation shows that
optional field. Their public package management API exposes the actual linked
repository. The previous synthetic fixture supplied a repository field the
live registry does not consistently provide. A realistic fixture reproduces
`JSR object required` against the unchanged verifier before correction.

Read the exact `vizejs/vize` package binding from
`https://api.jsr.io/scopes/vizejs/packages/vize` with the existing bounded,
unauthenticated reader. The management API supplies only package identity and
repository linking; version discovery, non-yanked status, exports and every
source checksum still come from the registry APIs, respecting
<https://jsr.io/docs/api#usage-restrictions>. Both endpoint identities must agree;
an optional registry repository field must agree too. Missing/foreign binding
fails even if static metadata asserts the expected repository. Enabled receipts
retain the binding URL; disabled and pre-JSR receipt shapes remain unchanged.
The original identity, source-byte, job and release contracts remain intact.
Require fresh corrected-source Actions and actual published consumers.

The refreshed source's Check `38106461820` retains the unchanged incoming More
guide audit refusal: tooling shard 3 found `/jsr` missing from explicit route
coverage. Add only that English route, with its Node/native/account and pending
publication boundaries reviewed above, and require native browser capture.
The empty uncovered-route assertion, every existing route, and existing
rendering boundaries remain unchanged. This records page review scope rather
than JSR delivery; fresh source/browser and eventual published support remain
required.

Corrected source `3e816303068bd4f9ee896ab02c84d99f9c105e2b` passed hosted JSR
validation `38107085195`, including all 13 JSR laws and genuine publication
dry-run. Its full Check `38107085231` failed formatting of the added regression
in `jsr-public-acceptance.test.ts`. Apply the repository's locked Oxfmt 0.63.0
reflow only; every assertion, input, negative control and product byte remains
unchanged. The failed source stays failed and the formatting successor requires
fresh full Actions before protected admission.
