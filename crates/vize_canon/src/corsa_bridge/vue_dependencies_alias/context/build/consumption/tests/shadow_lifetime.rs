//! Actual shadow-return fact lifetimes; authored and unexecuted, without diagnostics.

use super::super::NativeFacts;
use crate::batch::virtual_project::VirtualProject;
use crate::corsa_bridge::vue_dependencies_alias::context::cache::reconciled_are_current;
use crate::package_route::stamp::{Consumed, FactOwner, FactRole, InputStamp};
use crate::{PackageResolutionContext, PackageResolutionMode, PackageRoute, PackageRouteBinding};
use std::{
    path::{Path, PathBuf},
    sync::Arc,
};
use vize_carton::{FxHashMap, FxHashSet};

const SOURCE: &str = "export const value = 1;";

struct Fixture {
    _storage: tempfile::TempDir,
    root: PathBuf,
    bindings: Vec<PackageRouteBinding>,
}

fn fixture(scope_manifest: &str) -> Fixture {
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
            std::fs::write(&importer_path, SOURCE).unwrap();
            let context = PackageResolutionContext {
                scope_manifest_path: Some(root.join(scope_manifest)),
                ..PackageResolutionContext::default()
            };
            PackageRouteBinding {
                importer_path,
                specifier: "ui".into(),
                occurrence_mode: PackageResolutionMode::Import,
                context,
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

fn project(fixture: &Fixture) -> (VirtualProject, Consumed<()>) {
    let mut project = VirtualProject::new(&fixture.root).unwrap();
    project.set_package_routes(fixture.bindings.clone());
    let sources = fixture
        .bindings
        .iter()
        .map(|binding| binding.importer_path.clone())
        .collect::<Vec<_>>();
    let registration = project.register_paths_observed(&sources).unwrap();
    assert!(registration.qualified);
    (project, registration)
}

fn scope_predicate(
    packet: &Consumed<()>,
    importer: &Path,
    manifest: &Path,
    value: bool,
) -> InputStamp {
    // This expected value selects a fact from the actual return packet; it is
    // never inserted into NativeFacts or used to grant qualification.
    let expected = InputStamp::observed_is_file(manifest.to_path_buf(), value).with_owner(
        Arc::new(FactOwner {
            path: importer.to_path_buf(),
            role: FactRole::LocalImporter,
        }),
    );
    packet
        .stamps
        .iter()
        .find(|stamp| **stamp == expected)
        .unwrap()
        .clone()
}

fn current(packet: &Consumed<()>, project: &VirtualProject, importer: &Path) -> bool {
    let known = project
        .registered_original_paths_sorted()
        .into_iter()
        .collect::<FxHashSet<_>>();
    reconciled_are_current(
        packet,
        &known,
        importer,
        SOURCE.as_bytes(),
        &FxHashMap::default(),
        &[],
    )
}

#[test]
fn clean_shadow_packet_keeps_a_completed_importers_unreobserved_manifest_fact() {
    let fixture = fixture("package.json");
    let (mut project, registration) = project(&fixture);
    let importer = &fixture.bindings[0].importer_path;
    let manifest = fixture.root.join("package.json");
    let initial = project.rebuild_package_shadows_observed().unwrap();
    assert!(initial.qualified);
    let predicate = scope_predicate(&initial, importer, &manifest, true);
    let mut previous = NativeFacts::new(true);
    previous.record_owned(registration);
    previous.record_owned(initial);
    let previous = previous.finish(());
    assert!(current(&previous, &project, importer));

    let clean = project.rebuild_package_shadows_observed().unwrap();
    assert!(clean.qualified);
    assert!(!clean.stamps.is_empty());
    assert!(!clean.stamps.contains(&predicate));
    let mut retained = NativeFacts::new(true);
    retained.record_owned(clean);
    // Completion is an explicit API input here, not a claimed executed
    // native callback campaign or proof that a shadow was reconstructed.
    retained.retain_previous(&previous.stamps, std::slice::from_ref(importer), &[], &[]);
    let retained = retained.finish(());
    assert!(retained.qualified);
    assert!(retained.stamps.contains(&predicate));
    assert!(current(&retained, &project, importer));

    std::fs::remove_file(&manifest).unwrap();
    assert!(!predicate.is_current());
    assert!(!current(&retained, &project, importer));
}

#[test]
fn completed_importer_retention_refuses_conflicting_actual_scope_predicates() {
    let fixture = fixture("missing.json");
    let (mut project, registration) = project(&fixture);
    let importer = &fixture.bindings[0].importer_path;
    let manifest = fixture.root.join("missing.json");
    let initial = project.rebuild_package_shadows_observed().unwrap();
    assert!(initial.qualified);
    let negative = scope_predicate(&initial, importer, &manifest, false);
    let mut previous = NativeFacts::new(true);
    previous.record_view(&registration, FactRole::Configuration, &fixture.root);
    previous.record_owned(initial);
    let previous = previous.finish(());
    assert!(current(&previous, &project, importer));

    std::fs::write(&manifest, "{}").unwrap();
    project.set_package_routes(fixture.bindings.clone());
    let rebuilt = project.rebuild_package_shadows_observed().unwrap();
    assert!(rebuilt.qualified);
    let positive = scope_predicate(&rebuilt, importer, &manifest, true);
    assert_ne!(negative, positive);
    assert!(negative.package_contribution().is_none());
    assert!(positive.package_contribution().is_none());
    let mut retained = NativeFacts::new(true);
    retained.record_owned(registration);
    retained.record_owned(rebuilt);
    assert!(current(&retained.witness(), &project, importer));
    retained.retain_previous(&previous.stamps, std::slice::from_ref(importer), &[], &[]);
    let retained = retained.finish(());
    assert!(retained.qualified);
    assert_eq!(
        retained
            .stamps
            .iter()
            .filter(|stamp| **stamp == positive || **stamp == negative)
            .cloned()
            .collect::<Vec<_>>(),
        vec![positive.clone(), negative.clone()]
    );
    assert!(positive.is_current());
    assert!(!negative.is_current());
    assert!(!current(&retained, &project, importer));
}
