//! Uncompiled native configuration value/default and late-body controls.

use super::{configured_project, configured_project_observed};
use crate::corsa_bridge::vue_document::{CorsaProjectEnvironment, CorsaVueVirtualDocumentOptions};

#[test]
fn actual_native_configured_values_match_legacy_and_missing_or_parse_defaults_are_cold() {
    let holder = tempfile::tempdir().unwrap();
    let root = holder.path().canonicalize().unwrap();
    let config = root.join("tsconfig.json");
    let source = root.join("Host.vue");
    std::fs::write(&source, "<template/>").unwrap();
    let virtual_options = crate::virtual_ts::VirtualTsOptions::default();
    let resolver = crate::PackageRouteResolver::default();
    let session = crate::corsa_bridge::EditorMirrorSession::new();
    let environment = CorsaProjectEnvironment {
        virtual_ts_options: &virtual_options,
        package_routes: &resolver,
        project_root: Some(&root),
        tsconfig_path: Some(&config),
        editor_session: &session,
    };
    let options = CorsaVueVirtualDocumentOptions {
        options_api: true,
        jsx_typecheck: true,
        experimental_patterned_template: true,
        preserve_event_navigation: true,
        ..Default::default()
    };
    for body in [
        Some(
            r#"{"compilerOptions":{"checkJs":true},"vueCompilerOptions":{"strictTemplates":true}}"#,
        ),
        Some("{"),
        None,
    ] {
        if let Some(body) = body {
            std::fs::write(&config, body).unwrap();
        } else {
            std::fs::remove_file(&config).unwrap();
        }
        let legacy = configured_project(&source, options, environment).unwrap();
        let observed = configured_project_observed(&source, options, environment).unwrap();
        assert_eq!(legacy.project_root(), observed.value.project_root());
        assert_eq!(legacy.virtual_root(), observed.value.virtual_root());
        assert_eq!(
            legacy.effective_tsconfig_path(),
            observed.value.effective_tsconfig_path()
        );
        assert_eq!(
            legacy.source_file_policy(),
            observed.value.source_file_policy()
        );
        legacy.assert_same_configuration(&observed.value);
        assert_eq!(
            legacy.package_resolution_settings(),
            observed.value.package_resolution_settings()
        );
        assert_eq!(
            legacy.dependency_alias_map(),
            observed.value.dependency_alias_map()
        );
        if body.is_some_and(|body| body != "{") {
            assert!(observed.qualified); // Configuration scope only, not native graph authority.
            std::fs::write(&config, "{\"compilerOptions\":{\"checkJs\":false}}").unwrap();
            assert!(observed.stamps.iter().any(|stamp| !stamp.is_current()));
        } else {
            assert!(!observed.qualified);
        }
    }
}

#[test]
fn bare_config_package_is_qualified_only_after_its_actual_chain_is_installed() {
    let holder = tempfile::tempdir().unwrap();
    let root = holder.path().canonicalize().unwrap();
    let editor = root.join("packages/editor");
    std::fs::create_dir_all(&editor).unwrap();
    std::fs::write(root.join("tsconfig.json"), "{}").unwrap();
    let config = editor.join("tsconfig.json");
    std::fs::write(
        &config,
        r#"{"extends":"@fixture/typescript-config/tsconfig.frontend.json"}"#,
    )
    .unwrap();
    let source = editor.join("Host.vue");
    std::fs::write(&source, "<template/>").unwrap();
    let virtual_options = crate::virtual_ts::VirtualTsOptions::default();
    let resolver = crate::PackageRouteResolver::default();
    let session = crate::corsa_bridge::EditorMirrorSession::new();
    let environment = CorsaProjectEnvironment {
        virtual_ts_options: &virtual_options,
        package_routes: &resolver,
        project_root: Some(&root),
        tsconfig_path: None,
        editor_session: &session,
    };
    let options = CorsaVueVirtualDocumentOptions::default();
    let cold_legacy = configured_project(&source, options, environment).unwrap();
    let cold = configured_project_observed(&source, options, environment).unwrap();
    assert!(!cold.qualified, "a missing selected bare chain stays cold");
    let cold_aliases = cold.value.dependency_alias_map();
    assert_eq!(cold_aliases, cold_legacy.dependency_alias_map());

    let installed = editor.join("node_modules/@fixture/typescript-config");
    std::fs::create_dir_all(&installed).unwrap();
    let parent = installed.join("tsconfig.common.json");
    std::fs::write(
        &parent,
        r#"{"compilerOptions":{"allowJs":true,"checkJs":true,"noUnusedLocals":true,"paths":{"installed/*":["src/*"]}}}"#,
    )
    .unwrap();
    std::fs::write(
        installed.join("tsconfig.frontend.json"),
        r#"{"extends":"./tsconfig.common.json","vueCompilerOptions":{"strictTemplates":true}}"#,
    )
    .unwrap();
    let complete_legacy = configured_project(&source, options, environment).unwrap();
    let complete = configured_project_observed(&source, options, environment).unwrap();
    assert!(
        complete.qualified,
        "only the complete actual selected chain is known"
    );
    assert_ne!(
        cold.value.source_file_policy(),
        complete.value.source_file_policy()
    );
    assert_ne!(cold_aliases, complete.value.dependency_alias_map());
    for (actual, legacy) in [(&cold, &cold_legacy), (&complete, &complete_legacy)] {
        assert_eq!(legacy.project_root(), actual.value.project_root());
        assert_eq!(legacy.virtual_root(), actual.value.virtual_root());
        assert_eq!(
            legacy.effective_tsconfig_path(),
            actual.value.effective_tsconfig_path()
        );
        assert_eq!(
            legacy.source_file_policy(),
            actual.value.source_file_policy()
        );
        legacy.assert_same_configuration(&actual.value);
        assert_eq!(
            legacy.package_resolution_settings(),
            actual.value.package_resolution_settings()
        );
        assert_eq!(
            legacy.dependency_alias_map(),
            actual.value.dependency_alias_map()
        );
    }
    std::fs::write(&parent, r#"{"compilerOptions":{"checkJs":false}}"#).unwrap();
    assert!(complete.stamps.iter().any(|stamp| !stamp.is_current()));
}
