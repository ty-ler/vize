//! Whole shadow values and facts from the actual original operations.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use super::super::VirtualProject;
use crate::package_route::stamp::{FactOwner, FactRole, InputStamp};
use crate::{PackageResolutionContext, PackageResolutionMode, PackageRoute, PackageRouteBinding};

struct Fixture {
    _storage: tempfile::TempDir,
    root: PathBuf,
    bindings: Vec<PackageRouteBinding>,
}

fn fixture() -> Fixture {
    let storage = tempfile::tempdir().unwrap();
    let root = storage.path().canonicalize().unwrap();
    std::fs::write(root.join("tsconfig.json"), "{}").unwrap();
    std::fs::write(root.join("package.json"), r#"{"name":"app"}"#).unwrap();
    let package_root = root.join("ui");
    std::fs::create_dir(&package_root).unwrap();
    let manifest_path = package_root.join("package.json");
    std::fs::write(&manifest_path, r#"{"name":"ui"}"#).unwrap();
    let route = PackageRoute {
        package_root: package_root.clone(),
        package_link_root: package_root,
        manifest_path,
        package_name: Some("ui".into()),
        workspace_source: false,
        source_paths: Vec::new(),
        dependency_paths: Vec::new(),
        source_targets: Vec::new(),
        nested_routes: Vec::new(),
    };
    let bindings = ["apps/a/main.ts", "apps/b/main.ts"]
        .into_iter()
        .map(|relative| {
            let importer_path = root.join(relative);
            std::fs::create_dir_all(importer_path.parent().unwrap()).unwrap();
            std::fs::write(&importer_path, "export const value = 1;").unwrap();
            PackageRouteBinding {
                importer_path,
                specifier: "ui".into(),
                occurrence_mode: PackageResolutionMode::Import,
                context: PackageResolutionContext::default(),
                route: Some(route.clone()),
                invalidation_paths: Vec::new(),
            }
        })
        .collect();
    Fixture {
        _storage: storage,
        root,
        bindings,
    }
}

fn project(fixture: &Fixture) -> VirtualProject {
    let mut project = VirtualProject::new(&fixture.root).unwrap();
    project.set_package_routes(fixture.bindings.clone());
    let sources = fixture
        .bindings
        .iter()
        .map(|binding| binding.importer_path.clone())
        .collect::<Vec<_>>();
    project.register_paths(&sources).unwrap();
    project
}

fn assert_same_shadow_values(left: &VirtualProject, right: &VirtualProject) {
    assert_eq!(left.package_shadow_files, right.package_shadow_files);
    assert_eq!(
        left.package_shadow_manifests,
        right.package_shadow_manifests
    );
    assert_eq!(
        left.package_shadow_file_owners,
        right.package_shadow_file_owners
    );
    assert_eq!(
        left.package_shadow_manifest_owners,
        right.package_shadow_manifest_owners
    );
    assert_eq!(
        left.package_shadow_source_paths,
        right.package_shadow_source_paths
    );
    assert_eq!(left.package_shadow_scopes, right.package_shadow_scopes);
    assert_eq!(
        left.package_shadow_dirty_keys,
        right.package_shadow_dirty_keys
    );
    assert_eq!(
        left.package_shadows_initialized,
        right.package_shadows_initialized
    );
    assert_eq!(
        left.incremental_shadow_bindings_rebuilt,
        right.incremental_shadow_bindings_rebuilt
    );
    assert_eq!(
        left.package_shadow_artifacts.len(),
        right.package_shadow_artifacts.len()
    );
    for (key, topology) in &left.package_shadow_artifacts {
        let other = &right.package_shadow_artifacts[key];
        assert_eq!(topology.files, other.files);
        assert_eq!(topology.manifests, other.manifests);
        assert_eq!(topology.aliases, other.aliases);
        assert_eq!(topology.install_roots, other.install_roots);
    }
}

#[test]
fn observed_initial_and_clean_passes_keep_whole_legacy_topology_and_counters() {
    let fixture = fixture();
    let mut legacy = project(&fixture);
    let mut observed = project(&fixture);
    legacy.rebuild_package_shadows().unwrap();
    let initial = observed.rebuild_package_shadows_observed().unwrap();
    assert!(initial.qualified);
    assert!(initial.stamps.iter().all(|stamp| stamp.owner().is_some()));
    assert_same_shadow_values(&legacy, &observed);
    let count = observed.incremental_shadow_bindings_rebuilt;
    legacy.rebuild_package_shadows().unwrap();
    let clean = observed.rebuild_package_shadows_observed().unwrap();
    assert!(clean.qualified);
    assert!(
        !clean.stamps.is_empty(),
        "original scope/plan selections still execute"
    );
    assert_eq!(count, observed.incremental_shadow_bindings_rebuilt);
    assert_same_shadow_values(&legacy, &observed);
}

#[test]
fn same_original_manifest_predicate_and_negative_shared_probe_refuse_late_drift() {
    let fixture = fixture();
    let mut project = project(&fixture);
    // This law consumes the authored scope-manifest predicate. The default
    // context deliberately has no scope and must not invent that operation.
    for binding in project.package_routes.values_mut() {
        binding.context.scope_manifest_path = Some(fixture.root.join("package.json"));
    }
    let packet = project.rebuild_package_shadows_observed().unwrap();
    let owner = Arc::new(FactOwner {
        path: fixture.root.clone(),
        role: FactRole::Configuration,
    });
    let modules = fixture.root.join("apps/node_modules");
    let negative = InputStamp::observed_exists(modules.clone(), false).with_owner(owner);
    assert!(packet.stamps.contains(&negative));
    std::fs::create_dir_all(modules).unwrap();
    assert!(!negative.is_current());
    let importer = &fixture.bindings[0].importer_path;
    let owner = Arc::new(FactOwner {
        path: importer.clone(),
        role: FactRole::LocalImporter,
    });
    let scope_manifest = fixture.root.join("package.json");
    let predicate = InputStamp::observed_is_file(scope_manifest.clone(), true).with_owner(owner);
    assert!(packet.stamps.contains(&predicate));
    std::fs::remove_file(scope_manifest).unwrap();
    assert!(!predicate.is_current());
}

#[test]
fn current_binding_owner_retirement_keeps_shared_configuration_selections() {
    let fixture = fixture();
    let mut project = project(&fixture);
    let packet = project.rebuild_package_shadows_observed().unwrap();
    let retired = fixture.bindings[0].importer_path.clone();
    assert!(packet.stamps.iter().any(|stamp| {
        stamp
            .owner()
            .is_some_and(|owner| owner.role == FactRole::LocalImporter && owner.path == retired)
    }));
    project.remove_package_route_binding(&fixture.bindings[0].key());
    let next = project.rebuild_package_shadows_observed().unwrap();
    assert!(next.stamps.iter().all(|stamp| {
        !stamp
            .owner()
            .is_some_and(|owner| owner.role == FactRole::LocalImporter && owner.path == retired)
    }));
    let retained = packet
        .stamps
        .into_iter()
        .filter(|stamp| {
            !stamp
                .owner()
                .is_some_and(|owner| owner.role == FactRole::LocalImporter && owner.path == retired)
        })
        .collect::<Vec<_>>();
    assert!(retained.iter().any(|stamp| {
        stamp.owner().is_some_and(|owner| {
            owner.role == FactRole::Configuration && owner.path == fixture.root
        })
    }));
    assert!(retained.iter().any(|stamp| {
        stamp.owner().is_some_and(|owner| {
            owner.role == FactRole::LocalImporter && owner.path == fixture.bindings[1].importer_path
        })
    }));
}

#[test]
fn absent_scope_manifest_short_circuits_its_canonical_selection() {
    let fixture = fixture();
    let mut project = project(&fixture);
    let absent = fixture.root.join("missing.json");
    for binding in project.package_routes.values_mut() {
        binding.context.scope_manifest_path = Some(absent.clone());
    }
    let packet = project.rebuild_package_shadows_observed().unwrap();
    let owner = Arc::new(FactOwner {
        path: fixture.bindings[0].importer_path.clone(),
        role: FactRole::LocalImporter,
    });
    assert!(
        packet.stamps.contains(
            &InputStamp::observed_is_file(absent.clone(), false).with_owner(owner.clone())
        )
    );
    assert!(!packet.stamps.contains(
        &InputStamp::observed_canonical_path(absent.clone(), absent.clone()).with_owner(owner)
    ));
    std::fs::write(&absent, "{}").unwrap();
    assert!(packet.stamps.iter().any(|stamp| !stamp.is_current()));
}

#[test]
#[cfg(unix)]
fn same_body_package_symlink_retarget_refuses_the_actual_shadow_selection() {
    let mut fixture = fixture();
    let first = fixture.root.join("ui");
    let second = fixture.root.join("ui-second");
    std::fs::create_dir(&second).unwrap();
    std::fs::write(second.join("package.json"), r#"{"name":"ui"}"#).unwrap();
    let selected = fixture.root.join("selected-ui");
    std::os::unix::fs::symlink(&first, &selected).unwrap();
    for binding in &mut fixture.bindings {
        let route = binding.route.as_mut().unwrap();
        route.package_root = selected.clone();
        route.manifest_path = selected.join("package.json");
    }
    let mut project = project(&fixture);
    let packet = project.rebuild_package_shadows_observed().unwrap();
    let owner = Arc::new(FactOwner {
        path: fixture.bindings[0].importer_path.clone(),
        role: FactRole::LocalImporter,
    });
    let canonical = InputStamp::observed_canonical_path(selected.clone(), first).with_owner(owner);
    assert!(packet.stamps.contains(&canonical));
    std::fs::remove_file(&selected).unwrap();
    std::os::unix::fs::symlink(&second, &selected).unwrap();
    assert!(!canonical.is_current());
    assert!(packet.stamps.iter().any(|stamp| !stamp.is_current()));
}

#[test]
fn relative_observation_remains_cold_and_the_legacy_disabled_sink_emits_no_facts() {
    let fixture = fixture();
    let project = project(&fixture);
    let mut observed = super::ShadowFacts::new(&project, true);
    observed.canonical(Path::new("relative-package"));
    assert!(!observed.finish().qualified);
    let mut disabled = super::ShadowFacts::new(&project, false);
    disabled.canonical(&fixture.root);
    disabled.is_file(&fixture.root.join("package.json"));
    disabled.exists(&fixture.root.join("missing"));
    let packet = disabled.finish();
    assert!(!packet.qualified);
    assert!(packet.stamps.is_empty());
}

#[test]
fn shadow_path_packet_never_claims_raw_manifest_body_authority() {
    let fixture = fixture();
    let mut project = project(&fixture);
    let packet = project.rebuild_package_shadows_observed().unwrap();
    assert!(packet.qualified);
    std::fs::write(
        fixture.root.join("package.json"),
        "different unparsed bytes",
    )
    .unwrap();
    std::fs::write(
        fixture.root.join("ui/package.json"),
        "different package bytes",
    )
    .unwrap();
    assert!(packet.stamps.iter().all(InputStamp::is_current));
    // The parent must retain actual constructor/context body facts separately.
    // This packet covers only this original path/predicate shadow operation.
}

#[test]
fn no_scope_manifest_keeps_the_original_predicate_and_canonical_absence() {
    let fixture = fixture();
    // The real setter resolves the nearest scope. Make that scope genuinely
    // absent before it runs instead of assuming fixture context survives it.
    std::fs::remove_file(fixture.root.join("package.json")).unwrap();
    let mut original = project(&fixture);
    let mut project = project(&fixture);
    assert!(
        project
            .package_routes
            .values()
            .all(|binding| binding.context.scope_manifest_path.is_none())
    );
    original.rebuild_package_shadows().unwrap();
    let packet = project.rebuild_package_shadows_observed().unwrap();
    assert_same_shadow_values(&project, &original);
    let scope_manifest = fixture.root.join("package.json");
    let owner = Arc::new(FactOwner {
        path: fixture.bindings[0].importer_path.clone(),
        role: FactRole::LocalImporter,
    });
    assert!(!packet.stamps.contains(
        &InputStamp::observed_is_file(scope_manifest.clone(), true).with_owner(owner.clone())
    ));
    assert!(
        !packet.stamps.contains(
            &InputStamp::observed_canonical_path(scope_manifest.clone(), scope_manifest)
                .with_owner(owner)
        )
    );
}
