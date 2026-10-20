//! Original once precedence, and the `v-memo` warning Vapor gives instead of
//! memoizing (upstream's `transformVMemo`).
use vize_atelier_core::{DirectiveNode, ElementNode, PropNode, TemplateChildNode};
use vize_carton::ensure_sufficient_stack;

/// `@vue/compiler-vapor`'s warning for a `v-memo` it ignores.
pub(crate) const MEMO_IGNORED: &str = "v-memo is not supported in Vapor mode and will be ignored.";

pub(in crate::lower) struct ScopeDirectives {
    has_once: bool,
    key_non_reactive: bool,
}

impl ScopeDirectives {
    pub(in crate::lower) fn new(inherited: bool) -> Self {
        Self {
            has_once: false,
            key_non_reactive: inherited,
        }
    }

    pub(in crate::lower) fn observe(&mut self, dir: &DirectiveNode<'_>) {
        if dir.name == "once" {
            self.has_once = true;
            self.key_non_reactive = true;
        }
    }

    pub(in crate::lower) fn finish(self) -> (bool, bool) {
        (self.has_once, self.key_non_reactive)
    }
}

/// The warning for an element carrying `v-memo`, which renders as if absent:
/// Vapor has no memo guard, whatever the dependencies (`[]` included).
pub(in crate::lower) fn memo_warning(el: &ElementNode<'_>) -> Option<&'static str> {
    el.props
        .iter()
        .any(|prop| matches!(prop, PropNode::Directive(dir) if dir.name == "memo"))
        .then_some(MEMO_IGNORED)
}

/// One [`memo_warning`] per element, in document order, as upstream reports
/// them while it enters each element.
pub(in crate::lower) fn memo_warnings(
    children: &[TemplateChildNode<'_>],
    warnings: &mut std::vec::Vec<vize_carton::String>,
) {
    ensure_sufficient_stack(|| {
        for child in children {
            match child {
                TemplateChildNode::Element(el) => {
                    if let Some(warning) = memo_warning(el) {
                        warnings.push(warning.into());
                    }
                    memo_warnings(&el.children, warnings);
                }
                TemplateChildNode::If(node) => {
                    for branch in node.branches.iter() {
                        memo_warnings(&branch.children, warnings);
                    }
                }
                TemplateChildNode::For(node) => memo_warnings(&node.children, warnings),
                _ => {}
            }
        }
    });
}
