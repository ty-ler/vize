//! The template signal: `v-bind="$attrs"` in an eligible single-root template.
//!
//! # Why the AST, and the bounded single-root traversal
//!
//! A recovered `v-bind="$attrs"` *creates* a finding, so an over-match is a
//! false positive. Taking the evidence from the template AST excludes the cases
//! a raw scan over the template text cannot:
//!
//! * `<!-- v-bind="$attrs" -->` is a comment node;
//! * `<p>v-bind="$attrs"</p>` is a text node;
//! * `@click="log('$attrs')"` is a `v-on` expression, not a `v-bind`, and the
//!   occurrence is inside a string literal;
//! * inside a `v-pre` region the parser rewrites every directive to a plain
//!   attribute, so nothing there is a `DirectiveNode` at all.
//!
//! The pinned provider reports unbound `$attrs` references in argumentless
//! bindings throughout an eligible template, including descendants. This
//! producer keeps the exact-expression and single-root boundaries, then walks
//! existing AST elements in source order. With inheritance left at its default,
//! both root and descendant forwarding need the opt-out. Explicit scopes stop
//! new descendant inference; an unscoped slot wrapper does not introduce a
//! local `$attrs` binding and remains eligible for traversal.
//! A multi-root fragment still has no single fallthrough target here.
//!
//! # Direction of error
//!
//! * **Over-match** would be a false positive, so the directive must be a
//!   `bind` with **no argument** whose expression is exactly `$attrs`. `:x="$attrs"`
//!   carries an argument and binds one prop; `v-bind="$attrsExtra"` is a
//!   different identifier.
//! * **Under-match** loses a report: compound expressions, rendered-root
//!   `<template>` wrappers and new descendant scopes stay conservative.
//!   Existing root scope behavior is retained without new scope inference.

use vize_relief::{
    DirectiveNode, ElementNode, ExpressionNode, PropNode, RootNode, TemplateChildNode,
};

/// The `$attrs` value's location, relative to the validated template block.
pub(super) struct AttrsSpread {
    pub(super) start: u32,
    pub(super) end: u32,
    pub(super) is_root: bool,
}

/// Report exact `$attrs` values in the single root and its unscoped descendants.
///
/// No report when the template has no single root element or that root is a
/// `<template>` wrapper whose rendered root is unavailable. Reuse the existing
/// validated AST directly, without another parse or an intermediate collection.
pub(super) fn for_each_attrs_spread(root: &RootNode<'_>, mut report: impl FnMut(AttrsSpread)) {
    let Some(element) = single_root_element(root) else {
        return;
    };
    // A root `<template v-if>` / `<template v-for>` renders its children, so
    // the element that receives the fallthrough attributes is not this node.
    if element.tag == "template" {
        return;
    }
    visit_element(element, root.source, true, &mut report);
}

fn visit_element(
    element: &ElementNode<'_>,
    source: &str,
    is_root: bool,
    report: &mut impl FnMut(AttrsSpread),
) {
    // The original root producer stays eligible. New descendant reports cannot
    // establish an unbound $attrs through a loop or slot-parameter scope.
    let scoped = element.props.iter().any(|prop| {
        matches!(prop, PropNode::Directive(d) if d.name == "for"
        || (d.name == "slot" && d.exp.as_ref().is_some_and(|exp| {
            !expression_source(exp, source).trim().is_empty()
        })))
    });
    if scoped && !is_root {
        return;
    }
    for prop in &element.props {
        if let PropNode::Directive(directive) = prop
            && is_attrs_spread(directive, source)
            && let Some(exp) = &directive.exp
        {
            let raw = exp.loc().span.slice(source);
            let leading = raw.len() - raw.trim_start().len();
            let trailing = raw.len() - raw.trim_end().len();
            report(AttrsSpread {
                start: exp.loc().span.start + leading as u32,
                end: exp.loc().span.end - trailing as u32,
                is_root,
            });
        }
    }
    if !scoped {
        for child in &element.children {
            if let TemplateChildNode::Element(child) = child {
                visit_element(child, source, false, report);
            }
        }
    }
}

/// The template's single root element, if it has exactly one.
///
/// Whitespace-only text and comments are not rendered content, so they do not
/// make a template multi-root. Anything else that renders — a second element,
/// an interpolation, real text — does, and a fragment has no single element to
/// receive the fallthrough attributes.
fn single_root_element<'a, 'ast>(root: &'a RootNode<'ast>) -> Option<&'a ElementNode<'ast>> {
    let mut found = None;
    for child in root.children.iter() {
        match child {
            vize_relief::TemplateChildNode::Comment(_) => {}
            vize_relief::TemplateChildNode::Text(text) if text.content.trim().is_empty() => {}
            vize_relief::TemplateChildNode::Element(element) if found.is_none() => {
                found = Some(&**element);
            }
            _ => return None,
        }
    }
    found
}

/// Whether the directive is exactly `v-bind="$attrs"`.
///
/// An argument (`:id="$attrs"`) binds a single prop rather than spreading the
/// fallthrough attributes, so it does not count. The expression is compared as
/// a whole — trimmed — rather than searched: the construct *is* the entire
/// expression, so equality is exact, and anything richer
/// (`v-bind="{ ...$attrs }"`) is deliberately not matched.
fn is_attrs_spread(directive: &DirectiveNode<'_>, source: &str) -> bool {
    if directive.name != "bind" || directive.arg.is_some() {
        return false;
    }
    directive
        .exp
        .as_ref()
        .is_some_and(|exp| expression_source(exp, source).trim() == "$attrs")
}

fn expression_source<'a>(exp: &'a ExpressionNode<'a>, source: &'a str) -> &'a str {
    match exp {
        ExpressionNode::Simple(simple) => simple.content,
        ExpressionNode::Compound(compound) => compound.loc.span.slice(source),
    }
}
