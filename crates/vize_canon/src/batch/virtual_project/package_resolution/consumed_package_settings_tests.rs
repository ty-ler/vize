// PRIVATE source laws only: never compiled or executed in this preparation.
// Proposed scope: package_resolution/consumed_package_settings_tests.rs.
use super::{PackageResolutionSettings, VirtualProject};
use std::fs;

#[test]
fn actual_compiler_and_governing_packet_preserve_whole_options_and_context() {
    let root = std::env::temp_dir()
        .join(vize_carton::cstr!("vize-config-package-settings-{}", std::process::id()).as_str());
    fs::create_dir_all(&root).unwrap();
    let root = fs::canonicalize(root).unwrap();
    let config = root.join("tsconfig.json");
    fs::write(&config, r#"{"compilerOptions":{"module":"NodeNext","customConditions":["browser","development"],"allowJs":true}}"#).unwrap();
    let project = VirtualProject::new(&root).unwrap();
    let legacy = project.package_resolution_settings();
    let packet = project.package_resolution_settings_observed();
    assert_eq!(packet.value.options, legacy.options);
    assert_eq!(packet.value.config_paths, legacy.config_paths);
    let importer = root.join("index.cts");
    fs::write(&importer, "export {};").unwrap();
    let (expected, expected_paths) = legacy.context(
        &mut crate::PackageRouteResolver::default(),
        &importer,
        crate::PackageResolutionMode::Contextual,
    );
    let context = PackageResolutionSettings::context_with_configuration_observed(
        &packet,
        &mut crate::PackageRouteResolver::default(),
        &importer,
        crate::PackageResolutionMode::Contextual,
    );
    assert_eq!(context.value.0, expected);
    assert_eq!(context.value.1, expected_paths);
    fs::write(
        &config,
        r#"{"compilerOptions":{"module":"Preserve","customConditions":["changed"]}}"#,
    )
    .unwrap();
    assert!(context.stamps.iter().any(|stamp| !stamp.is_current()));
    let _ = fs::remove_dir_all(root);
}

#[test]
fn failed_compiler_factory_keeps_whole_default_options_and_stays_cold() {
    let root = std::env::temp_dir()
        .join(vize_carton::cstr!("vize-config-package-error-{}", std::process::id()).as_str());
    fs::create_dir_all(&root).unwrap();
    let config = root.join("tsconfig.json");
    fs::write(&config, "{").unwrap();
    let project = VirtualProject::new(&root).unwrap();
    let legacy = project.package_resolution_settings();
    let observed = project.package_resolution_settings_observed();
    assert_eq!(observed.value.options, legacy.options);
    assert_eq!(observed.value.config_paths, legacy.config_paths);
    assert!(observed.value.options.is_empty());
    assert!(!observed.qualified);
    let _ = fs::remove_dir_all(root);
}
