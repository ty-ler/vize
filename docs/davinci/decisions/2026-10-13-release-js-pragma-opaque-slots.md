# Release JavaScript pragma and opaque slot regressions

Issue: #6879. Full Check `38356181245` at
`8db2f83ec054502597890db68109efd929fd2d35` rejects two original Vue parity
cases. Their inputs, complete diagnostic vectors and deadlines are retained.
This repair does not refresh authored diagnostic goldens.
The [paired independent release repair decision](https://github.com/ubugeeei-prod/vize/issues/6879#issuecomment-6141990845)
records the same product scope. Full run `38371279261` at the cumulative9d
source reproduces both regressions; its whole raw failure remains retained.

## JavaScript file opt-in

The leading `// @ts-check` case in the original four-case JavaScript SFC
oracle reports no SFC diagnostics instead of its required TS7006 and two
TS2339 findings. The imported TypeScript helper's TS2322 remains reported.

`SourceFilePolicy` had collapsed omitted `allowJs` and explicit false into
the same membership bit. The new denied-JavaScript projection consequently
hid the per-file pragma. Retain a separate explicit-denial bit through the
existing private build context. An admitted leading pragma keeps its typed
projection when the option is omitted; an explicit false still wins. Project
JavaScript discovery, ordinary unchecked files, `checkJs`, Options API and
the existing editor path keep their established policy.

The new pure ownership law compares the entire generated file and all maps
with the same-root allowed reference. It covers omitted and inherited
omitted options, explicit and inherited denial, and same-owner policy
replacement. The original real VueTsc/Vize oracle remains unchanged and must
pass on Actions.

## Opaque external component

The ecosystem fixture explicitly resolves Nuxt UI component imports to its
authored `DefineComponent<Record<string, unknown>, {}, any>` adapter. Its
`UCard` header slot acquired an erroneous empty-navigation contract. This
differs from the original denied-child `DefineComponent<{}, {}, any>` shape.

For the existing native Vue fallback whose public instance is `any`, use the
already declared setup-props parameter to distinguish an open string-index
contract from a known empty props contract. Only the open case stays opaque.
Actual native `$slots: {}` remains empty, and actual typed slot names still
reject wrong names. Explicit Vize slot markers and required-slot checks are
unchanged.

A separately retained pinned native TypeScript 7.0.2 helper control reproduces
four whole errors before and three after. Only the opaque header error is
removed. The closed Vue empty contract, native empty contract and wrong typed
slot errors remain byte-identical. This local helper execution supplies no
Rust producer, whole App, protected merge or release acceptance credit.

The new ordinary configured native production law uses five complete host
controls over the retained parent/child source shape. It must execute with the
actual required native backend. Original membership, Options, quoted-key,
missing-shim and unknown-constructor laws stay intact.

## Qualification boundaries

The selected development base is actual main
`b2f56c584c82f0da96db88c1faee565dd838ead8`. The production pair is
independent of #8675 executor/lifecycle APIs and is delivered separately to
unblock the actual full-release Vue parity regressions. Existing JavaScript source93,
Star322 and auxiliary source authorities remain immutable. A separately
named whole-current counterpart must authenticate every changed complete
body, all retained inputs and whole maps before offering a bounded historical
source view. Unknown, partial and drifting bodies continue to refuse.

Ecosystem snapshots also retain complete generated TypeScript. The preexisting
synthetic-helper mismatch from #8777 is distinct from the authored diagnostic
regression. Any source-bound helper projection successor must retain the
entire original packet, prove exact reversible generated-byte changes and
preserve every authored diagnostic and mapping; a blanket snapshot update is
not qualification.

The finite successor retains all eleven complete original generated packets in
a compressed passive capsule: ten Rust virtual-TypeScript snapshots and the
whole nine-file ecosystem packet. Exact helper-source custody proves forward
and inverse whole-byte migration; every ecosystem diagnostic, file identity
and counter remains literal. Two source-only laws pass locally. Actual Rust
generation and the original Vue parity oracle remain unqualified.

Exact-head source Actions, original complete Vue parity, the five new native
controls, protected merge delivery and installed public acceptance remain
required. This independent product pair has release priority. The preserved
#8675 source/lifecycle prototype, nonempty authored-star export repair and
five historical #8615 App failures remain separate unfinished work.
