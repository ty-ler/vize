//! Retained compiler authority remains executable without its live config chain.
use super::{Arc, CompilerConfigurationSnapshot, VirtualProject};
use serde_json::json;

#[test]
fn admitted_options_keep_package_path_anchors_vue_options_and_live_source_rebuilds() {
    let root = tempfile::tempdir().unwrap();
    let package = root.path().join("node_modules/@fixture/policy");
    std::fs::create_dir_all(package.join("types")).unwrap();
    let package = package.canonicalize().unwrap();
    std::fs::write(package.join("package.json"), r#"{"tsconfig":"base.json"}"#).unwrap();
    let base = package.join("base.json");
    std::fs::write(&base, r#"{
        "compilerOptions":{"strict":true,"baseUrl":".","paths":{"@policy/*":["types/*"]},"typeRoots":["types"]},
        "vueCompilerOptions":{"strictTemplates":true,"jsxSlots":true}
    }"#).unwrap();
    let config = root.path().join("tsconfig.json");
    std::fs::write(
        &config,
        r#"{"extends":"@fixture/policy","compilerOptions":{"strictNullChecks":true}}"#,
    )
    .unwrap();
    let snapshot =
        Arc::new(CompilerConfigurationSnapshot::capture(root.path(), Some(&config)).unwrap());
    let expected = snapshot.flattened.options.clone();
    let dependencies = snapshot.dependencies().to_vec();
    assert_eq!(expected["strict"], json!(true));
    assert_eq!(expected["strictNullChecks"], json!(true));
    let target = package.join("types/*").to_string_lossy().replace('\\', "/");
    let roots = package.join("types").to_string_lossy().replace('\\', "/");
    assert_eq!(
        crate::snapshot_tsconfig_compiler_options(root.path(), &config).unwrap()["paths"]["@policy/*"],
        json!([target])
    );
    assert_eq!(
        crate::snapshot_tsconfig_compiler_options(root.path(), &config).unwrap()["typeRoots"],
        json!([roots])
    );
    std::fs::remove_file(&base).unwrap();
    let mut project = VirtualProject::new(root.path()).unwrap();
    project
        .set_compiler_configuration_snapshot(Arc::clone(&snapshot))
        .unwrap();
    assert_eq!(
        project.load_compiler_options(Some(&config)).unwrap(),
        expected
    );
    assert_eq!(project.governing_config_paths(), dependencies);
    assert!(project.checks_unknown_props());
    assert!(project.virtual_ts_check_options.jsx_slots);
    let source = root.path().join("App.vue");
    let original = "<script setup lang='ts'>const value: string = 'disk';</script>";
    std::fs::write(&source, original).unwrap();
    let unsaved = "<script setup lang='ts'>const value: number = 42;</script>";
    project
        .register_path_with_content(&source, unsaved)
        .unwrap();
    project.materialize().unwrap();
    assert!(
        project
            .find_by_original(&source)
            .unwrap()
            .content
            .contains("const value: number = 42")
    );
    assert_eq!(std::fs::read_to_string(&source).unwrap(), original);
    let generated: serde_json::Value =
        serde_json::from_slice(&std::fs::read(project.generated_tsconfig_path()).unwrap()).unwrap();
    assert_eq!(
        generated["compilerOptions"]["strictNullChecks"],
        json!(true)
    );
    assert!(
        crate::snapshot_tsconfig_compiler_options(root.path(), &config).is_err(),
        "direct batch loading must still reject the missing dependency"
    );
}

#[test]
fn admitted_absence_does_not_adopt_a_new_invalid_live_config() {
    let root = tempfile::tempdir().unwrap();
    let snapshot = Arc::new(CompilerConfigurationSnapshot::capture(root.path(), None).unwrap());
    let config = root.path().join("tsconfig.json");
    std::fs::write(&config, r#"{"extends":"./missing.json"}"#).unwrap();
    let mut project = VirtualProject::new(root.path()).unwrap();
    project
        .set_compiler_configuration_snapshot(snapshot)
        .unwrap();
    assert!(project.effective_tsconfig_path().is_none());
    assert!(project.load_compiler_options(None).unwrap().is_empty());
    project.materialize().unwrap();
    assert!(
        VirtualProject::new(root.path())
            .unwrap()
            .materialize()
            .is_err()
    );
}

#[test]
fn same_directory_selected_reference_snapshots_stay_independent_and_recover() {
    let root = tempfile::tempdir().unwrap();
    std::fs::write(
        root.path().join("tsconfig.json"),
        r#"{"files":[],"references":[{"path":"./legacy.json"},{"path":"./modern.json"}]}"#,
    )
    .unwrap();
    let base = root.path().join("base.json");
    std::fs::write(&base, r#"{"compilerOptions":{"strictNullChecks":true},"vueCompilerOptions":{"strictTemplates":true}}"#).unwrap();
    let legacy = root.path().join("legacy.json");
    let modern = root.path().join("modern.json");
    std::fs::write(
        &legacy,
        r#"{"extends":"./base.json","compilerOptions":{"strict":false},"include":["Legacy.vue"]}"#,
    )
    .unwrap();
    std::fs::write(&modern, r#"{"compilerOptions":{"strict":true,"strictNullChecks":false},"vueCompilerOptions":{"strictTemplates":false},"include":["Modern.vue"]}"#).unwrap();
    let before =
        Arc::new(CompilerConfigurationSnapshot::capture(root.path(), Some(&legacy)).unwrap());
    let sibling =
        Arc::new(CompilerConfigurationSnapshot::capture(root.path(), Some(&modern)).unwrap());
    std::fs::write(&base, "{").unwrap();
    assert!(CompilerConfigurationSnapshot::capture(root.path(), Some(&legacy)).is_err());
    for (snapshot, config, strict, nulls, unknown) in [
        (before, &legacy, false, true, true),
        (sibling, &modern, true, false, false),
    ] {
        let mut project = VirtualProject::new(root.path()).unwrap();
        project
            .set_compiler_configuration_snapshot(snapshot)
            .unwrap();
        let options = project.load_compiler_options(Some(config)).unwrap();
        assert_eq!(options["strict"], json!(strict));
        assert_eq!(options["strictNullChecks"], json!(nulls));
        assert_eq!(project.checks_unknown_props(), unknown);
        assert_eq!(
            project.effective_tsconfig_path().as_deref(),
            Some(config.as_path())
        );
        project.materialize().unwrap();
    }
    std::fs::write(&base, r#"{"compilerOptions":{"strictNullChecks":false},"vueCompilerOptions":{"strictTemplates":false}}"#).unwrap();
    let repaired =
        Arc::new(CompilerConfigurationSnapshot::capture(root.path(), Some(&legacy)).unwrap());
    let mut project = VirtualProject::new(root.path()).unwrap();
    project
        .set_compiler_configuration_snapshot(repaired)
        .unwrap();
    assert_eq!(
        project.load_compiler_options(Some(&legacy)).unwrap()["strictNullChecks"],
        json!(false)
    );
    assert!(!project.checks_unknown_props());
}
