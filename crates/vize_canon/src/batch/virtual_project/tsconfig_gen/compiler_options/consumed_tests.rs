use super::super::super::VirtualProject;
use std::path::{Path, PathBuf};

fn write(root: &Path, name: &str, source: &str) -> PathBuf {
    let path = root.join(name);
    std::fs::write(&path, source).unwrap();
    path
}

#[test]
fn diamond_merge_keeps_the_whole_original_flattened_value_and_actual_body_facts() {
    let storage = tempfile::tempdir().unwrap();
    let root = storage.path().canonicalize().unwrap();
    let base = write(
        &root,
        "base.json",
        r#"{"compilerOptions":{"strict":false,"baseUrl":".","paths":{"@/*":["base/*"]}},"vueCompilerOptions":{"strictTemplates":true}}"#,
    );
    write(
        &root,
        "left.json",
        r#"{"extends":"./base","compilerOptions":{"checkJs":true,"paths":{"@/*":["left/*"]}}}"#,
    );
    write(
        &root,
        "right.json",
        r#"{"extends":"./base","compilerOptions":{"checkJs":false}}"#,
    );
    let entry = write(
        &root,
        "tsconfig.json",
        r#"{"extends":["./left","./right"],"compilerOptions":{"strict":true}}"#,
    );
    let project = VirtualProject::new(&root).unwrap();
    let original = project
        .load_compiler_options_flattened(Some(&entry))
        .unwrap();
    let observed = project
        .load_compiler_options_flattened_observed(Some(&entry))
        .unwrap();
    assert_eq!(observed.value.options, original.options);
    assert_eq!(observed.value.base_url, original.base_url);
    assert_eq!(observed.value.input_paths, original.input_paths);
    assert_eq!(
        observed.value.options.get("strict"),
        Some(&serde_json::Value::Bool(true))
    );
    assert_eq!(
        observed.value.options.get("checkJs"),
        Some(&serde_json::Value::Bool(false))
    );
    assert!(observed.qualified);
    assert!(observed.stamps.iter().all(|stamp| stamp.is_current()));
    let vue = project
        .load_vue_compiler_options_observed(Some(&entry))
        .unwrap();
    assert_eq!(
        vue.value.get("strictTemplates"),
        Some(&serde_json::Value::Bool(true))
    );
    assert!(vue.qualified);
    assert!(vue.stamps.iter().all(|stamp| stamp.is_current()));
    std::fs::write(&base, r#"{"compilerOptions":{"strict":false,"baseUrl":".","paths":{"@/*":["changed/*"]}},"vueCompilerOptions":{"strictTemplates":false}}"#).unwrap();
    assert!(observed.stamps.iter().any(|stamp| !stamp.is_current()));
    assert!(vue.stamps.iter().any(|stamp| !stamp.is_current()));
}

#[test]
fn a_cycle_cut_is_not_promoted_to_complete_configuration_authority() {
    let storage = tempfile::tempdir().unwrap();
    let root = storage.path().canonicalize().unwrap();
    let entry = write(
        &root,
        "tsconfig.json",
        r#"{"extends":"./other","compilerOptions":{"strict":true}}"#,
    );
    write(
        &root,
        "other.json",
        r#"{"extends":"./tsconfig","compilerOptions":{"allowJs":true}}"#,
    );
    let project = VirtualProject::new(&root).unwrap();
    let original = project
        .load_compiler_options_flattened(Some(&entry))
        .unwrap();
    let observed = project
        .load_compiler_options_flattened_observed(Some(&entry))
        .unwrap();
    assert_eq!(observed.value.options, original.options);
    assert_eq!(observed.value.base_url, original.base_url);
    assert_eq!(observed.value.input_paths, original.input_paths);
    assert!(!observed.qualified);
    let vue = project
        .load_vue_compiler_options_observed(Some(&entry))
        .unwrap();
    assert!(!vue.qualified);
}

#[test]
fn legacy_dispatch_does_not_collect_native_consumed_metadata() {
    let storage = tempfile::tempdir().unwrap();
    let root = storage.path().canonicalize().unwrap();
    let entry = write(
        &root,
        "tsconfig.json",
        r#"{"compilerOptions":{"strict":true}}"#,
    );
    let project = VirtualProject::new(&root).unwrap();
    let plain = project
        .load_compiler_options_flattened_consumed(Some(&entry), false)
        .unwrap();
    let observed = project
        .load_compiler_options_flattened_observed(Some(&entry))
        .unwrap();
    assert!(plain.stamps.is_empty());
    assert!(!observed.stamps.is_empty());
    assert_eq!(plain.value.options, observed.value.options);
    assert_eq!(plain.value.base_url, observed.value.base_url);
    assert_eq!(plain.value.input_paths, observed.value.input_paths);
}

#[test]
fn relative_existing_entries_preserve_values_without_qualifying_cwd_authority() {
    let cwd = std::env::current_dir().unwrap();
    let storage = tempfile::tempdir_in(&cwd).unwrap();
    let root = storage.path();
    let absolute = write(
        root,
        "entry.json",
        r#"{"compilerOptions":{"strict":true},"vueCompilerOptions":{"strictTemplates":true}}"#,
    );
    let relative = absolute.strip_prefix(&cwd).unwrap();
    assert!(relative.exists());
    let project = VirtualProject::new(root).unwrap();
    let original = project
        .load_compiler_options_flattened(Some(relative))
        .unwrap();
    let observed = project
        .load_compiler_options_flattened_observed(Some(relative))
        .unwrap();
    assert_eq!(observed.value.options, original.options);
    assert_eq!(observed.value.base_url, original.base_url);
    assert_eq!(observed.value.input_paths, original.input_paths);
    assert!(!observed.qualified);
    let original_verbatim = project
        .load_compiler_options_verbatim(Some(relative))
        .unwrap();
    let observed_verbatim = project
        .load_compiler_options_verbatim_observed(Some(relative))
        .unwrap();
    assert_eq!(observed_verbatim.value, original_verbatim);
    assert!(!observed_verbatim.qualified);
}

#[test]
fn unresolved_extends_preserves_defaults_but_refuses_complete_chain_authority() {
    let storage = tempfile::tempdir().unwrap();
    let root = storage.path().canonicalize().unwrap();
    let entry = write(
        &root,
        "tsconfig.json",
        r#"{"extends":"./missing-parent","compilerOptions":{"strict":true},"vueCompilerOptions":{"strictTemplates":true}}"#,
    );
    let project = VirtualProject::new(&root).unwrap();
    let original = project
        .load_compiler_options_flattened(Some(&entry))
        .unwrap();
    let observed = project
        .load_compiler_options_flattened_observed(Some(&entry))
        .unwrap();
    assert_eq!(observed.value.options, original.options);
    assert_eq!(observed.value.base_url, original.base_url);
    assert_eq!(observed.value.input_paths, original.input_paths);
    assert!(!observed.qualified);
    let original_verbatim = project
        .load_compiler_options_verbatim(Some(&entry))
        .unwrap();
    let observed_verbatim = project
        .load_compiler_options_verbatim_observed(Some(&entry))
        .unwrap();
    assert_eq!(observed_verbatim.value, original_verbatim);
    assert!(!observed_verbatim.qualified);
}

#[test]
fn invalid_config_read_and_parse_errors_remain_original_errors_without_authority() {
    let storage = tempfile::tempdir().unwrap();
    let root = storage.path().canonicalize().unwrap();
    let project = VirtualProject::new(&root).unwrap();
    for bytes in [b"not a JSON config".as_slice(), &[0xff, 0xfe]] {
        let path = root.join("invalid.json");
        std::fs::write(&path, bytes).unwrap();
        let original = project
            .load_compiler_options_flattened(Some(&path))
            .err()
            .unwrap();
        let observed = project
            .load_compiler_options_flattened_observed(Some(&path))
            .err()
            .unwrap();
        assert_eq!(original.to_string(), observed.to_string());
    }
}
