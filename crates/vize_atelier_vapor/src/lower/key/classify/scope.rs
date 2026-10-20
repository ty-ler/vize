//! Original once precedence, and the `v-memo` warning Vapor gives instead of
//! memoizing (upstream's `transformVMemo`).
use vize_atelier_core::{DirectiveNode, ElementNode, PropNode};

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
