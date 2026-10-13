# Prop declaration diagnostics

Issue: [#8796](https://github.com/ubugeeei-prod/vize/issues/8796).

The official v0.448.0 real-project Matrix at source `2817a0aa13518dd46c16bc8bf56ac831f68c24dc` found missing Options API prop mutations and casing diagnostics, plus declaration range mismatches. `eslint-plugin-vue@10.9.2` reports complete runtime properties and complete TypeScript property signatures.

Use the existing Croquis Options descriptor for template prop ownership. Casing reads runtime Options declarations through Patina's existing props resolver and retains their complete AST spans. Required/default diagnostics retain the original prop declaration location; a default expression is a secondary label. Standalone `withDefaults` expression statements receive the same typed analysis as assigned calls.

The differential corpus includes Options object/array declarations, ordinary objects, loop/slot shadowing, bound options, listener names, typed defaults, foreign macros and optional controls. Required checks, presets and zero-divergence budgets stay unchanged.

Sibling normal-script types are a separate follow-up that must reuse the existing block ASTs. This slice does not claim those six original missing diagnostics are repaired. Exact-source Actions, protected merge and a published installed-consumer check remain required.
