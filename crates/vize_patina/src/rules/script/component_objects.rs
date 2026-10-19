//! Which object literals in a script are Vue component definitions.
//!
//! Follows eslint-plugin-vue's component detection: `export default {}` in an
//! SFC, the object passed to `defineComponent()` / `defineNuxtComponent()`, and
//! the options object of `Vue.component()`, `Vue.extend()` and `Vue.mixin()`.
//! Rules record the start offset of each such object and recognise it while
//! walking the program.

use oxc_ast::ast::{
    Argument, BindingPattern, CallExpression, ExportDefaultDeclarationKind, Expression, Program,
    Statement,
};
use oxc_ast_visit::{Visit, walk::walk_call_expression};
use vize_l0::{FxHashMap, FxHashSet};

use super::SfcScriptContext;

/// Start offsets of every component options object in `program`.
pub(super) fn component_objects(
    program: &Program<'_>,
    sfc: SfcScriptContext<'_>,
) -> FxHashSet<u32> {
    let mut objects = Collector::default();
    if sfc.is_sfc && !sfc.is_script_setup {
        objects.export_default(program);
    }
    objects.visit_program(program);
    objects.starts
}

#[derive(Default)]
struct Collector {
    starts: FxHashSet<u32>,
}

impl Collector {
    fn export_default(&mut self, program: &Program<'_>) {
        // `const options = {}; export default options`
        let mut bindings: FxHashMap<&str, u32> = FxHashMap::default();
        for statement in &program.body {
            if let Statement::VariableDeclaration(declaration) = statement {
                for declarator in &declaration.declarations {
                    if let BindingPattern::BindingIdentifier(id) = &declarator.id
                        && let Some(start) = declarator.init.as_ref().and_then(object_start)
                    {
                        bindings.insert(id.name.as_str(), start);
                    }
                }
            }
        }
        for statement in &program.body {
            let Statement::ExportDefaultDeclaration(export) = statement else {
                continue;
            };
            let start = match &export.declaration {
                ExportDefaultDeclarationKind::ObjectExpression(object) => Some(object.span.start),
                ExportDefaultDeclarationKind::Identifier(identifier) => {
                    bindings.get(identifier.name.as_str()).copied()
                }
                ExportDefaultDeclarationKind::ParenthesizedExpression(expression) => {
                    object_start(&expression.expression)
                }
                ExportDefaultDeclarationKind::TSAsExpression(expression) => {
                    object_start(&expression.expression)
                }
                ExportDefaultDeclarationKind::TSSatisfiesExpression(expression) => {
                    object_start(&expression.expression)
                }
                _ => None,
            };
            self.starts.extend(start);
        }
    }
}

impl<'a> Visit<'a> for Collector {
    fn visit_call_expression(&mut self, it: &CallExpression<'a>) {
        let options = match &it.callee {
            Expression::Identifier(callee)
                if matches!(
                    callee.name.as_str(),
                    "defineComponent" | "defineNuxtComponent"
                ) =>
            {
                it.arguments.first()
            }
            Expression::StaticMemberExpression(member)
                if matches!(&member.object, Expression::Identifier(object) if object.name == "Vue")
                    && matches!(
                        member.property.name.as_str(),
                        "component" | "extend" | "mixin"
                    ) =>
            {
                it.arguments.last()
            }
            _ => None,
        };
        if let Some(Argument::ObjectExpression(object)) = options {
            self.starts.insert(object.span.start);
        }
        walk_call_expression(self, it);
    }
}

fn object_start(expression: &Expression<'_>) -> Option<u32> {
    match expression {
        Expression::ObjectExpression(object) => Some(object.span.start),
        Expression::ParenthesizedExpression(expression) => object_start(&expression.expression),
        Expression::TSAsExpression(expression) => object_start(&expression.expression),
        Expression::TSSatisfiesExpression(expression) => object_start(&expression.expression),
        _ => None,
    }
}
