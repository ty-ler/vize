//! Positive ownership for local callable properties copied onto a fresh object.
//!
//! A spelling such as `$on` alone does not establish Vue instance identity.
//! Preserve the historical warning unless the retained AST and every lexical
//! reference prove an unescaped local wrapper. No import-name allowlist or
//! inference from missing receiver information is involved.

use oxc_ast::ast::{
    Argument, BindingPattern, CallExpression, Expression, IdentifierReference, ObjectExpression,
    ObjectPropertyKind, Program, PropertyKind, Statement, ThisExpression, VariableDeclarationKind,
};
use oxc_ast_visit::{Visit, walk};
use oxc_semantic::{Semantic, SemanticBuilder};
use oxc_span::Span;
use oxc_syntax::symbol::SymbolId;

pub(super) fn owned_calls<'a>(program: &'a Program<'a>, source: &str) -> Vec<Span> {
    // Demand-only semantic work: ordinary legacy instance calls keep the
    // existing AST-only path. This gate is an optimization, never evidence.
    if !source.contains("assign") && !source.contains('\\') {
        return Vec::new();
    }
    let mut dynamic = DynamicScope(false);
    dynamic.visit_program(program);
    if dynamic.0 {
        return Vec::new();
    }
    let built = SemanticBuilder::new().with_build_nodes(true).build(program);
    if !built.diagnostics.is_empty() {
        return Vec::new();
    }
    let mut proof = Proof {
        semantic: &built.semantic,
        calls: Vec::new(),
    };
    proof.visit_program(program);
    proof.calls
}

struct DynamicScope(bool);

impl<'a> Visit<'a> for DynamicScope {
    fn visit_identifier_reference(&mut self, id: &IdentifierReference<'a>) {
        // Includes escaped names and parenthesized direct eval calls.
        if id.name == "eval" {
            self.0 = true;
        }
    }

    fn visit_with_statement(&mut self, _: &oxc_ast::ast::WithStatement<'a>) {
        self.0 = true;
    }
}

struct Proof<'s, 'a> {
    semantic: &'s Semantic<'a>,
    calls: Vec<Span>,
}

impl<'a> Visit<'a> for Proof<'_, 'a> {
    fn visit_statements(&mut self, statements: &oxc_allocator::Vec<'a, Statement<'a>>) {
        for (index, statement) in statements.iter().enumerate() {
            if let Some(call) = statement_call(statement) {
                self.transfer(statements, index, call);
            }
        }
        walk::walk_statements(self, statements);
    }
}

impl<'a> Proof<'_, 'a> {
    fn symbol(&self, id: &IdentifierReference<'_>) -> Option<SymbolId> {
        self.semantic
            .scoping()
            .get_reference(id.reference_id.get()?)
            .symbol_id()
    }

    fn exact_references(&self, symbol: SymbolId, allowed: &[Span]) -> bool {
        let references: Vec<_> = self.semantic.symbol_references(symbol).collect();
        references.len() == allowed.len()
            && references.iter().all(|reference| {
                !reference.is_write() && allowed.contains(&self.semantic.reference_span(reference))
            })
    }

    fn transfer(&mut self, statements: &[Statement<'a>], index: usize, call: &CallExpression<'a>) {
        let Expression::StaticMemberExpression(callee) = &call.callee else {
            return;
        };
        let Expression::Identifier(object) = &callee.object else {
            return;
        };
        if object.name != "Object"
            || callee.property.name != "assign"
            || call.optional
            || callee.optional
            || self.symbol(object).is_some()
            || call.arguments.len() != 2
        {
            return;
        }
        // An explicit mutation/alias of the global invalidates this transfer.
        let global_refs = self.semantic.scoping().root_unresolved_references();
        if !global_refs
            .get("Object")
            .is_some_and(|references| references.len() == 1)
        {
            return;
        }
        let [Argument::Identifier(target), Argument::Identifier(source)] =
            call.arguments.as_slice()
        else {
            return;
        };
        let (Some(target_symbol), Some(source_symbol)) = (self.symbol(target), self.symbol(source))
        else {
            return;
        };
        let before = &statements[..index];
        let (Some((target_object, _)), Some((source_object, source_kind))) = (
            literal(before, target_symbol),
            literal(before, source_symbol),
        ) else {
            return;
        };
        if !target_object.properties.is_empty()
            || source_kind != VariableDeclarationKind::Const
            || !self.exact_references(source_symbol, &[source.span])
        {
            return;
        }
        let Some(methods) = callable_properties(source_object) else {
            return;
        };
        let mut references = vec![target.span];
        let mut calls = Vec::new();
        for statement in &statements[index + 1..] {
            let Some(call) = statement_call(statement) else {
                continue;
            };
            let Expression::StaticMemberExpression(member) = &call.callee else {
                continue;
            };
            let Expression::Identifier(receiver) = &member.object else {
                continue;
            };
            if self.symbol(receiver) == Some(target_symbol)
                && methods
                    .iter()
                    .any(|name| *name == member.property.name.as_str())
            {
                references.push(receiver.span);
                calls.push(call.span);
            }
        }
        // Every use must be either this transfer or a later same-block call
        // to an owned method. Writes, escapes, aliases, nested closures and
        // reads before initialization all retain the original warnings.
        if !calls.is_empty() && self.exact_references(target_symbol, &references) {
            self.calls.extend(calls);
        }
    }
}

fn statement_call<'a, 's>(statement: &'s Statement<'a>) -> Option<&'s CallExpression<'a>> {
    let Statement::ExpressionStatement(statement) = statement else {
        return None;
    };
    let Expression::CallExpression(call) = &statement.expression else {
        return None;
    };
    Some(call)
}

fn literal<'s, 'a>(
    statements: &'s [Statement<'a>],
    symbol: SymbolId,
) -> Option<(&'s ObjectExpression<'a>, VariableDeclarationKind)> {
    for statement in statements {
        let Statement::VariableDeclaration(declaration) = statement else {
            continue;
        };
        if declaration.declare || declaration.kind == VariableDeclarationKind::Var {
            continue;
        }
        for declarator in &declaration.declarations {
            if let BindingPattern::BindingIdentifier(id) = &declarator.id
                && id.symbol_id.get() == Some(symbol)
                && let Some(Expression::ObjectExpression(object)) = &declarator.init
            {
                return Some((object, declaration.kind));
            }
        }
    }
    None
}

fn callable_properties<'a>(object: &ObjectExpression<'a>) -> Option<Vec<String>> {
    let mut names = Vec::new();
    for property in &object.properties {
        let ObjectPropertyKind::ObjectProperty(property) = property else {
            return None;
        };
        if property.computed || property.kind != PropertyKind::Init {
            return None;
        }
        let name = property.key.static_name()?.into_owned();
        if name == "__proto__" || names.contains(&name) {
            return None;
        }
        // A literal callable is authored here. Aliases to Vue methods, getters,
        // spread overwrites and arbitrary factory results prove nothing.
        if !matches!(
            property.value,
            Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_)
        ) {
            return None;
        }
        let mut receiver = ReceiverUse(false);
        receiver.visit_expression(&property.value);
        if receiver.0 {
            return None;
        }
        names.push(name);
    }
    Some(names)
}

struct ReceiverUse(bool);

impl<'a> Visit<'a> for ReceiverUse {
    fn visit_this_expression(&mut self, _: &ThisExpression) {
        self.0 = true;
    }

    fn visit_super(&mut self, _: &oxc_ast::ast::Super) {
        self.0 = true;
    }
}
