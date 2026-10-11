use super::super::super::VirtualProject;
use super::check_unknown_props_enabled;
use serde_json::{Map, Value};
use std::fs;
use std::path::{Path, PathBuf};
use vize_carton::cstr;

fn unique_case_dir(name: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("target")
        .join("vize-tests")
        .join("tests")
        .join(cstr!("vue-compiler-options-{name}-{}", std::process::id()).as_str())
}

#[expect(clippy::disallowed_types, reason = "serde_json keys are std String")]
fn bool_map(pairs: &[(&str, bool)]) -> Map<std::string::String, Value> {
    pairs
        .iter()
        .map(|(key, value)| ((*key).to_owned(), Value::Bool(*value)))
        .collect()
}

#[test]
fn unknown_props_follow_vue_tsc_defaults() {
    assert!(!check_unknown_props_enabled(&Map::new()));
    assert!(check_unknown_props_enabled(&bool_map(&[(
        "strictTemplates",
        true
    )])));
    assert!(!check_unknown_props_enabled(&bool_map(&[
        ("strictTemplates", true),
        ("checkUnknownProps", false),
    ])));
    assert!(check_unknown_props_enabled(&bool_map(&[(
        "checkUnknownProps",
        true
    )])));
}

#[test]
fn tsconfig_without_vue_compiler_options_matches_vue_tsc() {
    let case_dir = unique_case_dir("default");
    let _ = fs::remove_dir_all(&case_dir);
    fs::create_dir_all(&case_dir).unwrap();
    fs::write(
        case_dir.join("tsconfig.json"),
        r#"{ "compilerOptions": { "strict": true } }"#,
    )
    .unwrap();
    let mut project = VirtualProject::new(&case_dir).unwrap();
    project.set_tsconfig_path(Some(case_dir.join("tsconfig.json")));
    assert!(!project.checks_unknown_props());
    let _ = fs::remove_dir_all(&case_dir);
}

#[test]
fn extended_strict_templates_enables_unknown_props() {
    let case_dir = unique_case_dir("extends");
    let _ = fs::remove_dir_all(&case_dir);
    fs::create_dir_all(&case_dir).unwrap();
    fs::write(
        case_dir.join("tsconfig.base.json"),
        r#"{ "vueCompilerOptions": { "strictTemplates": true } }"#,
    )
    .unwrap();
    fs::write(
        case_dir.join("tsconfig.json"),
        r#"{ "extends": "./tsconfig.base.json", "compilerOptions": { "strict": true } }"#,
    )
    .unwrap();
    let mut project = VirtualProject::new(&case_dir).unwrap();
    project.set_tsconfig_path(Some(case_dir.join("tsconfig.json")));
    assert!(project.checks_unknown_props());
    let _ = fs::remove_dir_all(&case_dir);
}

#[test]
fn no_tsconfig_keeps_generated_virtual_ts_strict() {
    let case_dir = unique_case_dir("none");
    let _ = fs::remove_dir_all(&case_dir);
    fs::create_dir_all(&case_dir).unwrap();
    let project = VirtualProject::new(&case_dir).unwrap();
    assert!(project.checks_unknown_props());
    let _ = fs::remove_dir_all(&case_dir);
}

#[test]
fn relative_existing_vue_config_retains_value_without_cwd_qualification() {
    let cwd = std::env::current_dir().unwrap();
    let storage = tempfile::tempdir_in(&cwd).unwrap();
    let root = storage.path();
    let absolute = root.join("entry.json");
    std::fs::write(
        &absolute,
        r#"{"vueCompilerOptions":{"strictTemplates":true}}"#,
    )
    .unwrap();
    let relative = absolute.strip_prefix(&cwd).unwrap();
    assert!(relative.exists());
    let project = VirtualProject::new(root).unwrap();
    let original = project.load_vue_compiler_options(Some(relative)).unwrap();
    let observed = project
        .load_vue_compiler_options_observed(Some(relative))
        .unwrap();
    assert_eq!(observed.value, original);
    assert!(!observed.qualified);
}

#[test]
fn unresolved_vue_extends_retains_value_without_complete_chain_qualification() {
    let storage = tempfile::tempdir().unwrap();
    let root = storage.path().canonicalize().unwrap();
    let entry = root.join("tsconfig.json");
    std::fs::write(
        &entry,
        r#"{"extends":"./missing-parent","vueCompilerOptions":{"strictTemplates":true}}"#,
    )
    .unwrap();
    let project = VirtualProject::new(&root).unwrap();
    let original = project.load_vue_compiler_options(Some(&entry)).unwrap();
    let observed = project
        .load_vue_compiler_options_observed(Some(&entry))
        .unwrap();
    assert_eq!(observed.value, original);
    assert!(!observed.qualified);
}

#[test]
fn vue_read_and_parse_errors_propagate_without_complete_authority() {
    let storage = tempfile::tempdir().unwrap();
    let root = storage.path().canonicalize().unwrap();
    let project = VirtualProject::new(&root).unwrap();
    for bytes in [b"not a JSON config".as_slice(), &[0xff, 0xfe]] {
        let path = root.join("invalid.json");
        std::fs::write(&path, bytes).unwrap();
        let original = project
            .load_vue_compiler_options(Some(&path))
            .err()
            .unwrap();
        let observed = project
            .load_vue_compiler_options_observed(Some(&path))
            .err()
            .unwrap();
        assert_eq!(original.to_string(), observed.to_string());
    }
}
