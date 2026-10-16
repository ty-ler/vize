//! Editor admission validates the existing compiler-option dependency graph.
use crate::VirtualProject;
use vize_carton::cstr;

#[test]
fn missing_relative_and_package_extends_reject_only_checked_editor_admission() {
    for extends in ["./missing.json", "@fixture/missing/tsconfig.json"] {
        let root = tempfile::tempdir().unwrap();
        let config = root.path().join("tsconfig.json");
        std::fs::write(
            &config,
            serde_json::to_vec(&serde_json::json!({"extends":extends})).unwrap(),
        )
        .unwrap();
        let mut project = VirtualProject::new(root.path()).unwrap();
        project.set_tsconfig_path(Some(config.clone()));
        assert_eq!(project.governing_config_paths(), vec![config.clone()]);
        let error = project.checked_governing_config_paths().unwrap_err();
        assert_eq!(
            cstr!("{error}"),
            cstr!(
                "Configuration error: cannot resolve tsconfig extends {extends:?} from {}",
                config.display()
            )
        );
    }
}

#[test]
fn checked_admission_uses_array_and_package_resolution_and_reports_the_whole_graph() {
    let root = tempfile::tempdir().unwrap();
    let package = root.path().join("node_modules/@fixture/base");
    std::fs::create_dir_all(&package).unwrap();
    std::fs::write(
        package.join("package.json"),
        r#"{"tsconfig":"policy.json"}"#,
    )
    .unwrap();
    std::fs::write(
        package.join("policy.json"),
        r#"{"compilerOptions":{"strict":true}}"#,
    )
    .unwrap();
    let relative = root.path().join("relative.json");
    std::fs::write(&relative, "{} ").unwrap();
    let config = root.path().join("tsconfig.json");
    std::fs::write(
        &config,
        r#"{"extends":["./relative.json","@fixture/base"]}"#,
    )
    .unwrap();
    let mut project = VirtualProject::new(root.path()).unwrap();
    project.set_tsconfig_path(Some(config.clone()));
    let mut expected = vec![
        config,
        relative,
        vize_carton::path::canonicalize_non_verbatim(&package.join("policy.json")),
    ];
    expected.sort();
    assert_eq!(project.checked_governing_config_paths().unwrap(), expected);
    std::fs::remove_file(package.join("policy.json")).unwrap();
    assert!(project.checked_governing_config_paths().is_err());
}

#[test]
fn malformed_inherited_json_rejects_checked_admission_and_recreation_repairs_it() {
    let root = tempfile::tempdir().unwrap();
    let base = root.path().join("base.json");
    let config = root.path().join("tsconfig.json");
    std::fs::write(&config, r#"{"extends":"./base.json"}"#).unwrap();
    std::fs::write(&base, "{").unwrap();
    let mut project = VirtualProject::new(root.path()).unwrap();
    project.set_tsconfig_path(Some(config.clone()));
    assert!(project.checked_governing_config_paths().is_err());
    std::fs::write(&base, "{}").unwrap();
    let mut expected = vec![config, base];
    expected.sort();
    assert_eq!(project.checked_governing_config_paths().unwrap(), expected);
}
