//! Same parser/callback/short-circuit source laws, never executed here.
use super::ImportRewriter;
use crate::batch::import_rewriter::{
    rewrite_relative_vue_specifier, rewrite_relative_vue_specifier_consumed,
};
use crate::package_route::stamp::{Consumed, InputStamp};
use oxc_span::SourceType;
use std::cell::RefCell;

#[test]
fn callback_order_count_and_whole_code_maps_remain_the_original_producer() {
    let source = "import a from './a'; import b from './b'; export { a, b };";
    let old_calls = RefCell::new(Vec::new());
    let resolver = |path: &str, mode| {
        old_calls.borrow_mut().push((path.to_owned(), mode));
        Some(path.to_owned())
    };
    let rewriter = ImportRewriter::new();
    let old = rewriter.rewrite_with_alias_resolver_and_missing_vue_policy(
        source,
        SourceType::ts(),
        None,
        &resolver,
        true,
    );
    let mut new_calls = Vec::new();
    let observed = rewriter.rewrite_with_alias_resolver_consumed(
        source,
        SourceType::ts(),
        None,
        |path, mode| {
            new_calls.push((path.to_owned(), mode));
            Consumed {
                value: Some(path.to_owned()),
                stamps: Vec::new(),
                qualified: true,
            }
        },
        true,
        true,
    );
    assert_eq!(new_calls, *old_calls.borrow());
    assert_eq!(new_calls.len(), 2);
    assert_eq!(old.code, observed.value.code);
    assert_eq!(old.source_map, observed.value.source_map);
    assert!(observed.qualified && observed.stamps.is_empty());
}

#[test]
fn actual_sfc_and_ordinary_companion_probes_keep_their_original_priority() {
    let storage = tempfile::tempdir().unwrap();
    let root = storage.path().canonicalize().unwrap();
    let sfc = root.join("Choice.vue");
    let ordinary = root.join("Choice.ts");
    std::fs::write(&sfc, "<template />").unwrap();
    std::fs::write(&ordinary, "export default 1;").unwrap();
    let original = rewrite_relative_vue_specifier("./Choice", &root);
    let old = rewrite_relative_vue_specifier_consumed("./Choice", &root, true);
    assert_eq!(old.value, original);
    assert!(old.value.is_none() && old.qualified);
    assert_eq!(
        old.stamps,
        vec![
            InputStamp::observed_is_file(sfc, true),
            InputStamp::observed_is_file(ordinary.clone(), true),
        ]
    );
    std::fs::remove_file(&ordinary).unwrap();
    assert!(old.stamps.iter().any(|stamp| !stamp.is_current()));
    let current = rewrite_relative_vue_specifier_consumed("./Choice", &root, true);
    assert_eq!(
        current.value,
        rewrite_relative_vue_specifier("./Choice", &root)
    );
    assert_eq!(current.value.as_deref(), Some("./Choice.vue.ts"));
    assert!(current.qualified);
}
