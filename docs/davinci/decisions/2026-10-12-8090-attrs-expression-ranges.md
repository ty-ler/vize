# Attribute forwarding locations

## Decision

For #8090 and the legacy linter fixture contract #6881, correct the existing
`script/no-duplicate-attr-inheritance` producer without changing its preset or
pipeline. Reuse the validated template AST, report the exact `$attrs` value,
and visit unscoped descendants of the existing eligible single root.

The actual v0.447 Matrix source `ef34d1a0409fc711a6c5cefcf0708b0cce78f502`,
run 38205026873, artifact 11727196356 reports one false positive and two false
negatives for the unchanged ant-design-vue ThemeIcon. Its full directive finding
at line 2, columns 9..24 mismatches the official identifier at 17..23, and it
omits the nested SVG identifier at line 4, columns 85..91. The original complete
project report, ZIP and zero-budget breach remain unchanged.

The full 1,350-byte source is authenticated against public commit
`7483836f0adac76516e527df893c3d84a7cd4005`, blob
`b6ff7c1c730f3ded5461c83edb31913469eb5116`. Candidate byte ranges are
27..33 and 146..152. Preserve the root message, help, label and warning severity;
new descendant findings explain the missing inheritance opt-out. No unsafe or
automatic fix is introduced.

## Boundaries

Keep the existing explicit boolean option behavior, sole-script ownership,
default dispatch and strict single-root policy. Exact argumentless `$attrs`
bindings are eligible; fragments, rendered root wrappers and compound expressions
remain outside this slice. New descendants under loops or slot parameters refuse
inference, while unscoped slot wrappers permit ThemeIcon's SVG. Existing root
scope behavior and explicit-true/provider differences remain named controls.
No generic traversal stage, new parse, context API, compiler configuration,
preset, dependency, budget or exclusion is added.

## Evidence and remaining qualification

The [durable corpus](../../../tests/_fixtures/differential/lint/attrs-expression-ranges-8090/README.md)
contains the unchanged original and 24 neighbors with whole before/after API,
CLI and official envelopes authored before observation. Preserve the initial
23-case bytes and the independent root-scope supplement. The authenticated
public v0.443.0 binary and pinned official scoped role each pass all 25 cases;
native warnings are 7 before and 14 authored after, with 17 official warnings
and explicit bounded differences.

The reference role retains the original Matrix configuration shape and exact
ESLint 10.4.1 / plugin 10.9.2 / Vue parser 10.4.1 / TS parser 8.65.0 / TS 6.0.3
package custody. Its complete output does not replace the all-rule Matrix packet.
No candidate output was used to recapture expected vectors.

Three source-only reference laws pass. Candidate API/formatter/CLI execution,
ordinary exact-source Actions, mandatory native compatibility, protected queue,
actual merge and installed release acceptance remain required. Source preparation
and old-public/provider observations provide no candidate execution or broader
Matrix qualification. All pre-existing legacy corpus authorities remain literal.

The paired issue decision is posted with this change. The release coordinator
owns public acceptance; this slice owns source, queue and actual-merge delivery.
