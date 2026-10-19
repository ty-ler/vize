//! script/no-deprecated-delete-set
//!
//! Disallow `$set` and `$delete`, removed in Vue 3.
//!
//! Vue 3's proxy-based reactivity tracks added and deleted properties, so the
//! Vue 2 escape hatches `this.$set`/`this.$delete`, `Vue.set`/`Vue.delete` and
//! the `set`/`del` exports were removed. Mirrors eslint-plugin-vue's
//! `vue/no-deprecated-delete-set`: it checks `this.$set`/`this.$delete` and
//! `Vue.set`/`Vue.delete` inside component definitions (and `Vue.*` in
//! `<script setup>`), and calls of `set`/`del` imported from `vue` anywhere.
//!
//! ## Examples
//!
//! ### Invalid
//! ```ts
//! export default {
//!   methods: {
//!     update() {
//!       this.$set(this.user, 'name', 'Ada')
//!       this.$delete(this.user, 'age')
//!     },
//!   },
//! }
//! ```
//!
//! ### Valid
//! ```ts
//! export default {
//!   methods: {
//!     update() {
//!       this.user.name = 'Ada'
//!       delete this.user.age
//!     },
//!   },
//! }
//! ```

use super::{
    ScriptLintResult, ScriptRule, ScriptRuleMeta, SfcScriptContext,
    component_objects::component_objects,
};
use crate::diagnostic::{LintDiagnostic, Severity};
use oxc_ast::ast::{
    CallExpression, Expression, ImportDeclarationSpecifier, ObjectExpression, Program, Statement,
};
use oxc_ast_visit::{
    Visit,
    walk::{walk_call_expression, walk_object_expression},
};
use oxc_span::Span;
use vize_l0::{CompactString, FxHashSet};

static META: ScriptRuleMeta = ScriptRuleMeta {
    name: "script/no-deprecated-delete-set",
    description: "Disallow $set and $delete, which Vue 3 removed",
    default_severity: Severity::Error,
};

/// Disallow `$set` and `$delete`, removed in Vue 3.
pub struct NoDeprecatedDeleteSet;

impl ScriptRule for NoDeprecatedDeleteSet {
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
            imported: imported_set_del(program),
            script_setup: sfc.is_script_setup,
            depth: 0,
            spans: Vec::new(),
        };
        visitor.visit_program(program);
        for span in visitor.spans {
            let start = offset as u32 + span.start;
            let end = offset as u32 + span.end;
            result.add_diagnostic(
                LintDiagnostic::error(
                    META.name,
                    "The `$delete`, `$set` is deprecated.",
                    start,
                    end,
                )
                .with_label("removed in Vue 3", start, end)
                .with_help(
                    "Vue 3 tracks added and deleted properties. Assign the property \
                         (`object.key = value`) or use `delete object.key` instead.",
                ),
            );
        }
    }
}

/// Local names of `set` and `del` imported from `vue`.
fn imported_set_del(program: &Program<'_>) -> FxHashSet<CompactString> {
    let mut names = FxHashSet::default();
    for statement in &program.body {
        let Statement::ImportDeclaration(declaration) = statement else {
            continue;
        };
        if declaration.import_kind.is_type() || declaration.source.value != "vue" {
            continue;
        }
        for specifier in declaration.specifiers.iter().flatten() {
            if let ImportDeclarationSpecifier::ImportSpecifier(specifier) = specifier
                && !specifier.import_kind.is_type()
                && matches!(specifier.imported.name().as_str(), "set" | "del")
            {
                names.insert(CompactString::new(specifier.local.name.as_str()));
            }
        }
    }
    names
}

struct Visitor {
    components: FxHashSet<u32>,
    imported: FxHashSet<CompactString>,
    script_setup: bool,
    /// How many component definitions enclose the current node.
    depth: usize,
    spans: Vec<Span>,
}

impl<'a> Visit<'a> for Visitor {
    fn visit_object_expression(&mut self, it: &ObjectExpression<'a>) {
        let component = self.components.contains(&it.span.start);
        self.depth += usize::from(component);
        walk_object_expression(self, it);
        self.depth -= usize::from(component);
    }

    fn visit_call_expression(&mut self, it: &CallExpression<'a>) {
        match &it.callee {
            Expression::StaticMemberExpression(member) => {
                let name = member.property.name.as_str();
                let this_api = matches!(&member.object, Expression::ThisExpression(_))
                    && matches!(name, "$set" | "$delete")
                    && self.depth > 0;
                let vue_api = matches!(&member.object, Expression::Identifier(object) if object.name == "Vue")
                    && matches!(name, "set" | "delete")
                    && (self.depth > 0 || self.script_setup);
                if this_api || vue_api {
                    self.spans.push(member.property.span);
                }
            }
            Expression::Identifier(callee) if self.imported.contains(callee.name.as_str()) => {
                self.spans.push(callee.span);
            }
            _ => {}
        }
        walk_call_expression(self, it);
    }
}

#[cfg(test)]
mod tests;
