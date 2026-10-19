//! script/no-deprecated-vue-config-keycodes
//!
//! Disallow `Vue.config.keyCodes`, removed in Vue 3.
//!
//! Vue 3 dropped key-code aliases for `v-on` modifiers along with
//! `Vue.config.keyCodes`; use the kebab-case `KeyboardEvent.key` name as the
//! modifier instead. Mirrors eslint-plugin-vue's
//! `vue/no-deprecated-vue-config-keycodes`.
//!
//! ## Examples
//!
//! ### Invalid
//! ```ts
//! import Vue from 'vue'
//! Vue.config.keyCodes = { f1: 112 }
//! ```
//!
//! ### Valid
//! ```ts
//! import { createApp } from 'vue'
//! import App from './App.vue'
//! createApp(App).mount('#app')
//! ```

use super::{ScriptLintResult, ScriptRule, ScriptRuleMeta};
use crate::diagnostic::{LintDiagnostic, Severity};
use oxc_ast::ast::{Expression, Program, StaticMemberExpression};
use oxc_ast_visit::{Visit, walk::walk_static_member_expression};
use oxc_span::Span;

static META: ScriptRuleMeta = ScriptRuleMeta {
    name: "script/no-deprecated-vue-config-keycodes",
    description: "Disallow Vue.config.keyCodes, which Vue 3 removed",
    default_severity: Severity::Error,
};

/// Disallow `Vue.config.keyCodes`, removed in Vue 3.
pub struct NoDeprecatedVueConfigKeycodes;

impl ScriptRule for NoDeprecatedVueConfigKeycodes {
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
        _source: &str,
        offset: usize,
        result: &mut ScriptLintResult,
    ) {
        let mut visitor = Visitor { spans: Vec::new() };
        visitor.visit_program(program);
        for span in visitor.spans {
            let start = offset as u32 + span.start;
            let end = offset as u32 + span.end;
            result.add_diagnostic(
                LintDiagnostic::error(
                    META.name,
                    "`Vue.config.keyCodes` are deprecated.",
                    start,
                    end,
                )
                .with_label("removed in Vue 3", start, end)
                .with_help(
                    "Vue 3 has no key-code aliases. Use the kebab-case `KeyboardEvent.key` \
                         name as the modifier, such as `@keyup.page-down`.",
                ),
            );
        }
    }
}

struct Visitor {
    spans: Vec<Span>,
}

impl<'a> Visit<'a> for Visitor {
    fn visit_static_member_expression(&mut self, it: &StaticMemberExpression<'a>) {
        if it.property.name == "keyCodes"
            && let Expression::StaticMemberExpression(config) = it.object.without_parentheses()
            && config.property.name == "config"
            && matches!(&config.object, Expression::Identifier(vue) if vue.name == "Vue")
        {
            self.spans.push(it.span);
        }
        walk_static_member_expression(self, it);
    }
}

#[cfg(test)]
mod tests;
