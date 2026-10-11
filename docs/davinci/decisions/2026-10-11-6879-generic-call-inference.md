# Keep authored generic inference in component calls (#6879)

Paired decision: [#6879 comment](https://github.com/ubugeeei-prod/vize/issues/6879#issuecomment-6107450742).

The original complete App check on fourth source `da43c7ccd2` reported one
PinInput story TS2322 at 20:11: `string[]` was rejected as `number[]`. Its
pinned child declares `Type extends PinInputType`, with no generic default,
and `[Type] extends ['number'] ? number[] : string[]`. The original story
supplies `ref<string[]>([])` with no number prop; the child's runtime props
default to text. The full Root, story, shared types and original failed vector
are retained at `tests/_fixtures/differential/typechecker/generic-call-inference/`,
with revision `c23e0ed8a38c66cd4f9350e7a46c6b502a8491c2`, hashes and its MIT license.

The producer already distinguishes authored generics from module-alias
generics. Aliases get synthetic `= any` defaults so bare type references remain
legal; the public generic component function uses the authored declaration.
The modern component's returned props/emits helper contract nevertheless used
the alias declaration. When this conditional prop cannot infer `Type`, an
`any` default can select its number branch. The bounded correction borrows the
existing authored declaration for that contract. Alias declarations, the
existing public function emitter and the legacy Vue2 branch stay unchanged.
Genuine authored defaults such as `= any`, `= 'text'` and `= 'number'` remain
part of the props/emits call signature. The existing slot resolver normalizer
is unchanged; this slice does not repair its separate default normalization.
No cache, pipeline stage, parser invocation or broad type widening is added.

A TypeScript 6.0.3 discriminator already reproduced the conditional/default
distinction: the synthetic-any call rejected string arrays, the authored call
accepted them, an explicit number prop rejected string arrays, and genuinely
authored `= any` kept that rejection. That is language-level evidence, not
proof of the real Canon/native cause or a product acceptance result.

Required `vue_codegen::generic_component_tests::` laws generate the complete
authored SFC through the production document factory and preserve alias and
legacy contracts. The native law always qualifies a tracked minimal whole-SFC
cause through the real public project factory and returning native client.
It uses the normal installed test Vue provider, no ReKa checkout, and a declared
strict standalone config. All six cases run: positive vectors must be empty,
negative vectors contain only the genuine model TS2322, and prior-contract
replay must differ only by the false text-model row. This mandatory standard
Rust-shard control runs even when capture and upstream fixtures are absent.

The single composed App qualifier additionally sets
`VIZE_TEST_REQUIRE_PIN_INPUT_FIXTURE=1`; the same law then requires the tracked
pinned fixture in an isolated snapshot with its full Root/story/config/import
context. Either native or pinned-fixture requirement also rejects native
disabling. Missing hydration or provider authority fails that suite. Every
observed ancestor provider scope is linked in its original nearest-first
layout; providers are neither installed nor copied through symlinks. Actual
link targets, Vue manifests, config provider bodies and missing scopes are
recorded. The authored fixture stays untouched. Capture is optional for native
semantics: `VIZE_NATIVE_SYNTAX_CAPTURE_DIR` or the standard
`VIZE_TEST_FIX_HISTORY_CAPTURE_DIR` retains the whole packets; without either,
the same complete data remain in the assertion context. No standard cause
assertion is conditioned on fixture availability or capture.

The pinned native control explicitly selects the existing core `tsconfig.app.json`.
That declared identity is distinct from the unchanged original full App CLI,
which supplied no explicit config. The real public checker materializes the
project; the returning native client attests that generated config, full
normalized compiler options and Root/story program membership. Complete
generated code, source maps and authored bodies are retained as verified
content-addressed blobs, with full raw and mapped vectors for each case.

No previous whole native child signature was captured by the original failing
App run. The before control is therefore explicitly a prior-helper-contract
replay: only the old checker/props/emits generic declarations replace the new
declarations in the actual produced Root's unmapped final export tail. Its
authored prefix, aliases, public generic function, source maps, project paths,
config and provider identities remain the same. It is not presented as an
unavailable old full-generator execution. The after control uses the complete
current production project. All cases are retained before verdicts are asserted.

The original text case must have exactly one genuine before model TS2322,
and after must equal its full before vector minus only that row. Explicit
number with number arrays must remain accepted; explicit number with string
arrays must retain its real TS2322. Authored any retains that genuine rejection,
while authored text and authored number preserve their positive array cases.
No original snapshot, reported diagnostic, check, cap or deadline is waived.

Formatting, module layout and generated inventories are preparation checks.
Compilation, native semantics, the unchanged full 32-case App row and all 15
negative controls, source Actions, queue, merge and installed release remain
pending. The App owner publishes the true fifth child once the actual parent
foundation is authenticated and runs the single existing composed qualifier.
This private payload does not dispatch an extra fourth/fifth observer build.

The publisher replayed only the two sealed owned commits onto the authenticated
post-prefix foundation `fe4dd1ee670b61da0b1397a8e77f0734ddcfba25`.
The existing composed workflow includes the same `generic_component_tests::`
filter and requires `VIZE_TEST_REQUIRE_PIN_INPUT_FIXTURE=1`, so the full pinned
six-case suite runs alongside the mandatory portable six-case cause control.
All five control groups reuse the original App row's dependency build; their
complete packets and individual statuses remain retained after any failure.
