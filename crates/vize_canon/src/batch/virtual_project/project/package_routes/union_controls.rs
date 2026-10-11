//! PRIVATE cross-owner controls: authored against the union, never executed.

use super::VirtualProject;
use crate::package_route::stamp::{FactOwner, FactRole, InputStamp};
use crate::{PackageResolutionContext, PackageResolutionMode, PackageRouteBinding};

#[test]
fn fresh_alias_settings_setter_and_root_owner_keep_the_legacy_values() {
    let storage = tempfile::tempdir().unwrap();
    let root = storage.path().canonicalize().unwrap();
    let config = root.join("tsconfig.json");
    std::fs::write(
        &config,
        r#"{"compilerOptions":{"module":"NodeNext","paths":{"local/*":["src/*"]}}}"#,
    )
    .unwrap();
    let mut legacy = VirtualProject::new(&root).unwrap();
    let mut observed = VirtualProject::new(&root).unwrap();
    let expected_aliases = legacy.dependency_alias_map();
    let aliases = observed.dependency_alias_map_observed();
    assert_eq!(aliases.value, expected_aliases);
    let expected_settings = legacy.package_resolution_settings();
    let settings = observed.package_resolution_settings_observed();
    assert_eq!(settings.value, expected_settings);
    let binding = PackageRouteBinding {
        importer_path: root.join("app.ts"),
        specifier: "missing-package".into(),
        occurrence_mode: PackageResolutionMode::Import,
        context: PackageResolutionContext::default(),
        route: None,
        invalidation_paths: vec![root.join("package.json")],
    };
    legacy.set_package_routes([binding.clone()]);
    let setter = observed.set_package_routes_observed([binding]);
    assert_eq!(observed.package_routes, legacy.package_routes);
    assert_eq!(observed.package_route_roots, legacy.package_route_roots);
    legacy.register_package_route_targets().unwrap();
    let roots = observed.register_package_route_targets_observed().unwrap();
    assert!(observed.registered_package_roots_are_current(&roots.value));
    assert_eq!(observed.package_routes, legacy.package_routes);
    assert_eq!(observed.package_route_roots, legacy.package_route_roots);
    // Root equality proves the current registry; it does not consume settings.
    std::fs::write(&config, r#"{"compilerOptions":{"module":"Preserve"}}"#).unwrap();
    assert!(settings.stamps.iter().any(|stamp| !stamp.is_current()));
    assert!(aliases.stamps.iter().any(|stamp| !stamp.is_current()));
    assert!(setter.stamps.iter().any(|stamp| !stamp.is_current()));
    assert!(observed.registered_package_roots_are_current(&roots.value));
}

#[test]
fn source_registration_keeps_authored_owner_and_does_not_widen_the_root_token() {
    let storage = tempfile::tempdir().unwrap();
    let root = storage.path().canonicalize().unwrap();
    std::fs::write(root.join("tsconfig.json"), "{}").unwrap();
    let mut project = VirtualProject::new(&root).unwrap();
    let roots = project.register_package_route_targets_observed().unwrap();
    let source = root.join("source.ts");
    std::fs::write(&source, "export const value = 1;").unwrap();
    let registration = project.register_path_observed(&source).unwrap();
    assert!(registration.stamps.iter().any(|stamp| {
        stamp
            .owner()
            .is_some_and(|owner| owner.path == source && owner.role == FactRole::AuthoredSource)
    }));
    assert!(project.registered_package_roots_are_current(&roots.value));
    std::fs::write(&source, "export const value = 2;").unwrap();
    assert!(registration.stamps.iter().any(|stamp| !stamp.is_current()));
    assert!(project.registered_package_roots_are_current(&roots.value));
    project.insert_package_route_binding(PackageRouteBinding {
        importer_path: source,
        specifier: "missing-package".into(),
        occurrence_mode: PackageResolutionMode::Import,
        context: PackageResolutionContext::default(),
        route: None,
        invalidation_paths: Vec::new(),
    });
    assert!(!project.registered_package_roots_are_current(&roots.value));
}

#[test]
fn retiring_binding_importer_drops_its_context_but_keeps_configuration_facts() {
    let storage = tempfile::tempdir().unwrap();
    let root = storage.path().canonicalize().unwrap();
    let scope = root.join("scope");
    std::fs::create_dir(&scope).unwrap();
    let config = root.join("tsconfig.json");
    let config_body = r#"{"compilerOptions":{"module":"NodeNext"}}"#;
    std::fs::write(&config, config_body).unwrap();
    let manifest = scope.join("package.json");
    let manifest_body = r#"{"type":"module"}"#;
    std::fs::write(&manifest, manifest_body).unwrap();
    let importer = scope.join("app.ts");
    let binding = PackageRouteBinding {
        importer_path: importer.clone(),
        specifier: "missing-package".into(),
        occurrence_mode: PackageResolutionMode::Contextual,
        context: PackageResolutionContext::default(),
        route: None,
        invalidation_paths: Vec::new(),
    };
    let mut legacy = VirtualProject::new(&root).unwrap();
    let mut observed = VirtualProject::new(&root).unwrap();
    legacy.set_package_routes([binding.clone()]);
    let packet = observed.set_package_routes_observed([binding]);
    assert_eq!(observed.package_routes, legacy.package_routes);
    let importer_owner = std::sync::Arc::new(FactOwner {
        path: importer.clone(),
        role: FactRole::LocalImporter,
    });
    assert!(packet.stamps.contains(
        &InputStamp::observed_source(manifest, manifest_body.as_bytes()).with_owner(importer_owner)
    ));
    // Model the parent's bounded fallback: only the separate unowned factory
    // facts receive Configuration; existing importer/source roles survive.
    let configuration_owner = std::sync::Arc::new(FactOwner {
        path: root,
        role: FactRole::Configuration,
    });
    let facts = packet
        .stamps
        .into_iter()
        .map(|stamp| {
            if stamp.owner().is_none() {
                stamp.with_owner(configuration_owner.clone())
            } else {
                stamp
            }
        })
        .collect::<Vec<_>>();
    let retained = facts
        .into_iter()
        .filter(|stamp| {
            !stamp.owner().is_some_and(|owner| {
                owner.role == FactRole::LocalImporter && owner.path == importer
            })
        })
        .collect::<Vec<_>>();
    assert!(
        retained.contains(
            &InputStamp::observed_source(config, config_body.as_bytes())
                .with_owner(configuration_owner)
        )
    );
    assert!(retained.iter().all(|stamp| {
        stamp
            .owner()
            .is_some_and(|owner| owner.role != FactRole::LocalImporter || owner.path != importer)
    }));
}
