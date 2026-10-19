//! script/no-deprecated-model-definition
//!
//! Disallow the `model` component option, removed in Vue 3.
//!
//! Vue 3 replaced the `model: { prop, event }` option with the `modelValue`
//! prop and `update:modelValue` event, and named `v-model` arguments for more
//! models. Mirrors eslint-plugin-vue's `vue/no-deprecated-model-definition`
//! with its default options (`allowVue3Compat` is not supported).
//!
//! ## Examples
//!
//! ### Invalid
//! ```ts
//! export default {
//!   model: { prop: 'checked', event: 'change' },
//!   props: { checked: Boolean },
//! }
//! ```
//!
//! ### Valid
//! ```ts
//! export default {
//!   props: { modelValue: Boolean },
//!   emits: ['update:modelValue'],
//! }
//! ```

use super::{
    ScriptLintResult, ScriptRule, ScriptRuleMeta, SfcScriptContext,
    component_objects::component_objects,
};
use crate::diagnostic::{LintDiagnostic, Severity};
use oxc_ast::ast::{Expression, ObjectExpression, ObjectPropertyKind, Program, PropertyKey};
use oxc_ast_visit::{Visit, walk::walk_object_expression};
use oxc_span::Span;
use vize_l0::FxHashSet;

static META: ScriptRuleMeta = ScriptRuleMeta {
    name: "script/no-deprecated-model-definition",
    description: "Disallow the model component option, which Vue 3 removed",
    default_severity: Severity::Error,
};

/// Disallow the `model` component option, removed in Vue 3.
pub struct NoDeprecatedModelDefinition;

impl ScriptRule for NoDeprecatedModelDefinition {
    fn meta(&self) -> &'static ScriptRuleMeta {
        &META
    }

    #[inline]
    fn uses_ast(&self) -> bool {
        true
    }

    fn check_program<'a>(
        &self,
        program: &'a Program<'a>,
        source: &str,
        offset: usize,
        result: &mut ScriptLintResult,
    ) {
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
        let mut visitor = Visitor {
            components: component_objects(program, sfc),
            spans: Vec::new(),
        };
        visitor.visit_program(program);
        for span in visitor.spans {
            let start = offset as u32 + span.start;
            let end = offset as u32 + span.end;
            result.add_diagnostic(
                LintDiagnostic::error(META.name, "`model` definition is deprecated.", start, end)
                    .with_label("removed in Vue 3", start, end)
                    .with_help(
                        "Declare a `modelValue` prop and emit `update:modelValue`; use named \
                         `v-model` arguments for other models.",
                    ),
            );
        }
    }
}

struct Visitor {
    components: FxHashSet<u32>,
    spans: Vec<Span>,
}

impl<'a> Visit<'a> for Visitor {
    fn visit_object_expression(&mut self, it: &ObjectExpression<'a>) {
        if self.components.contains(&it.span.start) {
            for property in &it.properties {
                if let ObjectPropertyKind::ObjectProperty(property) = property
                    && !property.computed
                    && is_model_key(&property.key)
                    && matches!(&property.value, Expression::ObjectExpression(_))
                {
                    self.spans.push(property.span);
                }
            }
        }
        walk_object_expression(self, it);
    }
}

fn is_model_key(key: &PropertyKey<'_>) -> bool {
    match key {
        PropertyKey::StaticIdentifier(key) => key.name == "model",
        PropertyKey::StringLiteral(key) => key.value == "model",
        _ => false,
    }
}

#[cfg(test)]
mod tests;
