//! Uncompiled configuration-scope controls; graph/session authority is separate.

use super::VirtualProject;

pub(super) fn same_configuration(left: &VirtualProject, right: &VirtualProject) {
    assert_eq!(left.project_root, right.project_root);
    assert_eq!(left.virtual_root, right.virtual_root);
    assert_eq!(left.tsconfig_path, right.tsconfig_path);
    assert_eq!(
        left.preserve_unused_diagnostics,
        right.preserve_unused_diagnostics
    );
    assert_eq!(left.source_policy, right.source_policy);
    assert_eq!(left.declaration_roots, right.declaration_roots);
    assert_eq!(left.typed_router.root, right.typed_router.root);
    assert_eq!(left.options_api, right.options_api);
    assert_eq!(left.legacy_vue2, right.legacy_vue2);
    assert_eq!(left.jsx_typecheck, right.jsx_typecheck);
    assert_eq!(left.dialect, right.dialect);
    assert_eq!(
        left.experimental_in_tag_comments,
        right.experimental_in_tag_comments
    );
    assert_eq!(
        left.experimental_patterned_template,
        right.experimental_patterned_template
    );
    assert_eq!(
        left.experimental_strict_slot_children,
        right.experimental_strict_slot_children
    );
    assert_eq!(left.session_scripts, right.session_scripts);
    assert_eq!(
        vize_carton::cstr!("{:?}", left.alias_rewrite_policy),
        vize_carton::cstr!("{:?}", right.alias_rewrite_policy),
    );
    assert_eq!(
        vize_carton::cstr!("{:?}", left.virtual_ts_options),
        vize_carton::cstr!("{:?}", right.virtual_ts_options),
    );
    assert_eq!(
        vize_carton::cstr!("{:?}", left.virtual_ts_check_options),
        vize_carton::cstr!("{:?}", right.virtual_ts_check_options),
    );
    assert_eq!(
        vize_carton::cstr!("{:?}", left.editor_document_options),
        vize_carton::cstr!("{:?}", right.editor_document_options),
    );
    assert_eq!(
        vize_carton::cstr!("{:?}", left.template_syntax),
        vize_carton::cstr!("{:?}", right.template_syntax),
    );
}

#[test]
fn configuration_constructor_keeps_full_values_and_legacy_total_owner_cold() {
    let storage = tempfile::tempdir().unwrap();
    let root = storage.path().canonicalize().unwrap();
    let config = root.join("tsconfig.json");
    for (body, known) in [
        (
            r#"{"compilerOptions":{"allowJs":true,"checkJs":true,"noUnusedLocals":true,"paths":{"local/*":["src/*"]}}}"#,
            true,
        ),
        ("{}", true),
        ("{", false),
    ] {
        std::fs::write(&config, body).unwrap();
        let legacy = VirtualProject::new(&root).unwrap();
        let complete = VirtualProject::new_observed(&root).unwrap();
        let configuration = VirtualProject::new_configuration_observed(&root).unwrap();
        same_configuration(&legacy, &complete.value);
        same_configuration(&legacy, &configuration.value);
        assert!(!complete.qualified);
        assert_eq!(configuration.qualified, known);
        if known {
            std::fs::write(&config, "{\"compilerOptions\":{\"checkJs\":false}}").unwrap();
            assert!(configuration.stamps.iter().any(|stamp| !stamp.is_current()));
        }
    }
}

#[test]
fn observed_namespace_overwrites_only_the_original_virtual_root_with_two_facts() {
    let project_storage = tempfile::tempdir().unwrap();
    let root = project_storage.path().canonicalize().unwrap();
    let session = tempfile::tempdir().unwrap();
    let session = session.path().canonicalize().unwrap();
    std::fs::write(root.join("tsconfig.json"), "{}").unwrap();
    let mut legacy = VirtualProject::new(&root).unwrap();
    let mut observed = VirtualProject::new_configuration_observed(&root).unwrap();
    legacy.scope_editor_namespace(&session, 731);
    let namespace = observed
        .value
        .scope_editor_namespace_observed(&session, 731);
    assert!(namespace.qualified);
    assert_eq!(namespace.stamps.len(), 2);
    same_configuration(&legacy, &observed.value);
    assert!(namespace.stamps.iter().all(|stamp| stamp.is_current()));
}
