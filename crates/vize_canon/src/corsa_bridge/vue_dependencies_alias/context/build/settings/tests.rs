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
        assert!(legacy.source_options_match(&observed.value));
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
