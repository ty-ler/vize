// PRIVATE source laws only: never compiled or executed in this preparation.
// Proposed scope: project/consumed_configuration_tests.rs.
use super::{PathBuf, VirtualProject};
use std::fs;
use std::sync::atomic::{AtomicUsize, Ordering};

fn case(name: &str) -> PathBuf {
    static NEXT: AtomicUsize = AtomicUsize::new(0);
    let path = std::env::temp_dir().join(
        vize_carton::cstr!(
            "vize-config-current-{name}-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        )
        .as_str(),
    );
    fs::create_dir_all(&path).unwrap();
    fs::canonicalize(path).unwrap()
}

fn same_configuration(left: &VirtualProject, right: &VirtualProject) {
    assert_eq!(left.project_root, right.project_root);
    assert_eq!(left.virtual_root, right.virtual_root);
    assert_eq!(left.tsconfig_path, right.tsconfig_path);
    assert_eq!(
        left.preserve_unused_diagnostics,
        right.preserve_unused_diagnostics
    );
    assert_eq!(left.source_policy, right.source_policy);
    assert_eq!(
        vize_carton::cstr!("{:?}", left.alias_rewrite_policy),
        vize_carton::cstr!("{:?}", right.alias_rewrite_policy)
    );
    assert_eq!(
        vize_carton::cstr!("{:?}", left.virtual_ts_check_options),
        vize_carton::cstr!("{:?}", right.virtual_ts_check_options)
    );
    assert_eq!(left.typed_router.root, right.typed_router.root);
    assert_eq!(left.declaration_roots, right.declaration_roots);
}

#[test]
fn constructor_and_setter_preserve_full_policy_alias_and_vue_defaults() {
    let root = case("whole-defaults");
    for body in [
        r#"{"compilerOptions":{"allowJs":true,"checkJs":false,"noUnusedLocals":true,"paths":{"@/*":["src/*"]}},"vueCompilerOptions":{"strictTemplates":true,"checkUnknownProps":false,"strictCssModules":true}}"#,
        r#"{}"#,
        "{",
        "",
    ] {
        let config = root.join("tsconfig.json");
        fs::write(&config, body).unwrap();
        let mut legacy = VirtualProject::new(&root).unwrap();
        let mut observed = VirtualProject::new_observed(&root).unwrap();
        same_configuration(&legacy, &observed.value);
        assert!(!observed.qualified); // Whole native/session owner is deliberately unsupported.
        legacy.set_tsconfig_path(Some(config.clone()));
        let packet = observed.value.set_tsconfig_path_observed(Some(config));
        same_configuration(&legacy, &observed.value);
        if body == "{" || body.is_empty() {
            assert!(!packet.qualified);
        }
    }
    let _ = fs::remove_dir_all(root);
}

#[test]
fn declaration_negative_predicate_and_positive_canonical_selection_keep_whole_roots() {
    let root = case("declarations");
    let source = root.join("Host.vue");
    fs::write(&source, "<template/>").unwrap();
    let paths = [root.join("absent.d.ts"), source.clone(), root.clone()];
    let mut legacy = VirtualProject::new(&root).unwrap();
    let mut observed = VirtualProject::new(&root).unwrap();
    legacy.set_declaration_roots(&paths);
    let packet = observed.set_declaration_roots_observed(&paths);
    assert_eq!(legacy.declaration_roots, observed.declaration_roots);
    assert!(packet.stamps.iter().all(|stamp| stamp.is_current()));
    fs::write(&paths[0], "export {};").unwrap();
    assert!(packet.stamps.iter().any(|stamp| !stamp.is_current()));
    let _ = fs::remove_dir_all(root);
}

#[test]
fn each_original_constructor_and_setter_body_is_retained_and_rejects_late_change() {
    let root = case("repeated-body");
    let config = root.join("tsconfig.json");
    fs::write(&config, r#"{"compilerOptions":{"checkJs":false}}"#).unwrap();
    let mut constructed = VirtualProject::new_observed(&root).unwrap();
    assert!(constructed.stamps.len() >= 3);
    let setter = constructed
        .value
        .set_tsconfig_path_observed(Some(config.clone()));
    assert!(setter.stamps.len() >= 4);
    fs::write(config, r#"{"compilerOptions":{"checkJs":true }}"#).unwrap();
    assert!(constructed.stamps.iter().any(|stamp| !stamp.is_current()));
    assert!(setter.stamps.iter().any(|stamp| !stamp.is_current()));
    let _ = fs::remove_dir_all(root);
}
