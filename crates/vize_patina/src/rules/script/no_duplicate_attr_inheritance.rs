//! script/no-duplicate-attr-inheritance
//!
//! Flag a component that applies its fallthrough attributes twice.
//!
//! Ports [`vue/no-duplicate-attr-inheritance`](https://eslint.vuejs.org/rules/no-duplicate-attr-inheritance.html),
//! which warns about *double attribute application*: a component that keeps the
//! default attribute inheritance (`inheritAttrs: true`) **and** also forwards
//! `$attrs` manually with `v-bind="$attrs"` on its root element ends up applying
//! the fallthrough attributes twice.
//!
//! The existing rule preserves two related diagnostics:
//!
//! * **An explicit `inheritAttrs: true`.** `true` is the framework default, so
//!   the legacy rule reports the redundant option even without a template
//!   spread. The pinned provider instead reports `$attrs` references; this
//!   option-only diagnostic remains a separately documented legacy difference.
//! * **`v-bind="$attrs"` with the default left implicit.** This covers the root
//!   and its unscoped descendants in a single-root template. It needs the
//!   validated `<template>` AST — see [`template`] for the ownership limits.
//!
//! When both are present only the first fires: the explicit `true` is the
//! smaller, more actionable edit, and two diagnostics for one defect is noise.
//!
//! ## What stays silent
//!
//! * `inheritAttrs: false` — the intended opt-out, in either spelling.
//! * An `inheritAttrs` whose value is not a boolean literal: the effective value
//!   is unknown, so neither direction may be assumed.
//! * New descendant bindings under `v-for` or slot parameters: their local
//!   `$attrs` ownership is unavailable here. Existing root scope behavior is
//!   retained; the rule does not resolve arbitrary template expressions.
//! * A multi-root (fragment) template: there is no single element for the
//!   fallthrough attributes to land on.
//! * An SFC with **both** `<script>` and `<script setup>`. The rule is invoked
//!   once per block and each sees only half the script surface, so an
//!   `inheritAttrs: false` in the sibling block would be invisible. See
//!   [`SfcScriptContext::sole_script_block`].
//!
//! ## Examples
//!
//! ### Invalid
//! ```ts
//! defineOptions({ inheritAttrs: true })
//! export default { inheritAttrs: true }
//! ```
//!
//! ```vue
//! <script setup lang="ts"></script>
//!
//! <template>
//!   <div v-bind="$attrs"></div>
//! </template>
//! ```
//!
//! ### Valid
//! ```ts
//! defineOptions({ inheritAttrs: false }) // intentional opt-out
//! export default {}                      // default inheritance, unstated
//! ```

mod options;
mod template;
#[cfg(test)]
mod tests;

use super::{ScriptLintResult, ScriptRule, ScriptRuleMeta, SfcScriptContext};
use crate::diagnostic::{LintDiagnostic, Severity};
use oxc_ast::ast::{BooleanLiteral, Program};

use self::options::{InheritAttrs, declared_inherit_attrs};
use self::template::{AttrsSpread, for_each_attrs_spread};

static META: ScriptRuleMeta = ScriptRuleMeta {
    name: "script/no-duplicate-attr-inheritance",
    description: "Flag a component that applies its fallthrough attributes twice",
    default_severity: Severity::Warning,
};

const MESSAGE: &str = "`inheritAttrs: true` is redundant because it is the default.";
const LABEL: &str = "redundant default";
const HELP: &str = "Remove `inheritAttrs: true`: attribute inheritance is already on by default. \
     Keep this option only to opt out with `inheritAttrs: false` (for example when forwarding \
     `$attrs` manually with `v-bind=\"$attrs\"`).";

const SPREAD_MESSAGE: &str = "`v-bind=\"$attrs\"` on the root element applies the fallthrough \
     attributes twice, because `inheritAttrs` defaults to true.";
const SPREAD_LABEL: &str = "attributes applied twice";
const SPREAD_HELP: &str = "Opt out of the automatic inheritance so only this `v-bind` applies \
     them, e.g. `defineOptions({ inheritAttrs: false })` or `inheritAttrs: false` in the \
     component options.";
const NESTED_MESSAGE: &str = "Set `inheritAttrs: false` when forwarding `$attrs` manually.";
const NESTED_LABEL: &str = "manual attribute forwarding";
const NESTED_HELP: &str = "Disable automatic inheritance with \
     `defineOptions({ inheritAttrs: false })` or `inheritAttrs: false` in the component options.";

/// Flag a component that applies its fallthrough attributes twice.
pub struct NoDuplicateAttrInheritance;

impl ScriptRule for NoDuplicateAttrInheritance {
    fn meta(&self) -> &'static ScriptRuleMeta {
        &META
    }

    #[inline]
    fn uses_ast(&self) -> bool {
        true
    }

    #[inline]
    fn uses_template_ast(&self) -> bool {
        true
    }

    fn check_program<'a>(
        &self,
        program: &'a Program<'a>,
        source: &str,
        offset: usize,
        result: &mut ScriptLintResult,
    ) {
        // Keep the parse-owning `check` path functional: without SFC context
        // only the explicit-`true` half is observable.
        self.check_program_with_sfc(program, source, offset, SfcScriptContext::default(), result);
    }

    fn check_program_with_sfc<'a>(
        &self,
        program: &'a Program<'a>,
        _source: &str,
        offset: usize,
        sfc: SfcScriptContext<'_>,
        result: &mut ScriptLintResult,
    ) {
        let mut stated = false;
        for declared in declared_inherit_attrs(program) {
            stated = true;
            if let InheritAttrs::Literal(literal) = declared
                && literal.value
            {
                report_redundant_true(literal, offset, result);
            }
        }
        // The template half only speaks about the *implicit* default. An
        // explicit `true` was just reported at the more actionable location, an
        // explicit `false` is the intended opt-out, and an opaque value is
        // unknowable — all three are done here.
        if stated {
            return;
        }
        check_template(sfc, result);
    }
}

/// Manual `$attrs` forwarding in a single-root template with inheritance left default.
fn check_template(sfc: SfcScriptContext<'_>, result: &mut ScriptLintResult) {
    if !sfc.sole_script_block {
        return;
    }
    let Some((root, template_offset)) = sfc.template_ast() else {
        return;
    };
    for_each_attrs_spread(root, |spread| {
        report_attrs_spread(&spread, template_offset, result);
    });
}

/// Report the redundant `inheritAttrs: true` boolean literal.
fn report_redundant_true(literal: &BooleanLiteral, offset: usize, result: &mut ScriptLintResult) {
    let start = offset as u32 + literal.span.start;
    let end = offset as u32 + literal.span.end;
    result.add_diagnostic(
        LintDiagnostic::warn(META.name, MESSAGE, start, end)
            .with_label(LABEL, start, end)
            .with_help(HELP),
    );
}

/// Report the `$attrs` value, preserving root wording and labeling new nested bindings.
fn report_attrs_spread(spread: &AttrsSpread, template_offset: u32, result: &mut ScriptLintResult) {
    let start = template_offset + spread.start;
    let end = template_offset + spread.end;
    let (message, label, help) = if spread.is_root {
        (SPREAD_MESSAGE, SPREAD_LABEL, SPREAD_HELP)
    } else {
        (NESTED_MESSAGE, NESTED_LABEL, NESTED_HELP)
    };
    result.add_diagnostic(
        LintDiagnostic::warn(META.name, message, start, end)
            .with_label(label, start, end)
            .with_help(help),
    );
}
