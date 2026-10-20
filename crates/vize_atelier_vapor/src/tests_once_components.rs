//! A component under `v-once`, its own or an ancestor's, is created with the
//! runtime's `once` flag, so its props and slots are read a single time.

use super::{VaporCompilerOptions, compile_vapor};
use vize_carton::{Allocator, String};

fn compile(source: &str, davinci_retained_lane: bool) -> String {
    let allocator = Allocator::new();
    let result = compile_vapor(
        &allocator,
        source,
        VaporCompilerOptions {
            prefix_identifiers: true,
            davinci_retained_lane,
            ..Default::default()
        },
    );
    assert!(
        result.error_messages.is_empty(),
        "{:?}",
        result.error_messages
    );
    result.code
}

#[test]
fn a_component_with_v_once_is_created_once() {
    for retained in [false, true] {
        let code = compile(r#"<Child v-once :value="count"/>"#, retained);
        assert!(
            code.contains("{ value: () => (_ctx.count) }, null, true, true)"),
            "{code}"
        );
    }
}

#[test]
fn a_component_inside_a_v_once_element_is_created_once() {
    for retained in [false, true] {
        let code = compile(
            r#"<div v-once><p><Child :value="count"><template #label>{{ label }}</template></Child></p></div>"#,
            retained,
        );
        assert!(code.contains("}, false, true)"), "{code}");
    }
}

#[test]
fn a_component_outside_v_once_stays_reactive() {
    for retained in [false, true] {
        let code = compile(
            r#"<div v-once>static</div><Child :value="count"/>"#,
            retained,
        );
        assert!(
            code.contains("{ value: () => (_ctx.count) }, null, false)"),
            "{code}"
        );
    }
}

/// Upstream ignores `v-memo` (Vapor has no memo guard) and warns once per
/// element carrying it, nested ones and `v-memo="[]"` included.
#[test]
fn every_v_memo_element_warns_and_renders_as_if_absent() {
    let source =
        r#"<div><p v-memo="[a]">{{ a }}</p><i v-memo="[]">{{ b }}</i><Child v-memo="[c]"/></div>"#;
    for retained in [false, true] {
        let allocator = Allocator::new();
        let result = compile_vapor(
            &allocator,
            source,
            VaporCompilerOptions {
                prefix_identifiers: true,
                davinci_retained_lane: retained,
                ..Default::default()
            },
        );
        let warning = "v-memo is not supported in Vapor mode and will be ignored.";
        assert_eq!(
            result.warning_messages,
            vec![String::from(warning); 3],
            "retained: {retained}"
        );
        assert_eq!(
            result.code.trim_end(),
            r#"import { resolveComponent as _resolveComponent, createComponentWithFallback as _createComponentWithFallback, child as _child, next as _next, txt as _txt, toDisplayString as _toDisplayString, setText as _setText, setInsertionState as _setInsertionState, renderEffect as _renderEffect, template as _template } from 'vue';
const t0 = _template("<div><p> </p><i> </i></div>", true)

export function render(_ctx) {
  const n3 = t0()
  const n0 = _child(n3)
  const n1 = _next(n0)
  const x0 = _txt(n0)
  const x1 = _txt(n1)
  _renderEffect(() => {
    _setText(x0, _toDisplayString(_ctx.a))
    _setText(x1, _toDisplayString(_ctx.b))
  })
  const _component_Child = _resolveComponent("Child")
  _setInsertionState(n3, 2)
  const n2 = _createComponentWithFallback(_component_Child, null, null, false)
  return n3
}"#,
            "retained: {retained}"
        );
    }
}
