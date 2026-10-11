//! Unexecuted original-owner source controls; no native diagnostic credit.
use super::VirtualProject;
use crate::package_route::stamp::{FactOwner, FactRole, InputStamp};
use std::path::{Path, PathBuf};
use vize_carton::FxHashSet;

const ENTRY: &str = "import type { Value } from 'typed-package';\n";
const DECLARATION: &str = "export interface Value {}\n";

struct Fixture {
    _root: tempfile::TempDir,
    root: PathBuf,
    importer: PathBuf,
    declaration: PathBuf,
}

impl Fixture {
    fn new(paths: bool) -> Self {
        let temp = tempfile::tempdir().unwrap();
        let root = vize_carton::path::canonicalize_non_verbatim(temp.path());
        let importer = root.join("entry.ts");
        let package = root.join("node_modules/typed-package");
        let declaration = package.join("index.d.ts");
        write(&root.join("package.json"), r#"{"type":"module"}"#);
        write(
            &root.join("tsconfig.json"),
            if paths {
                r#"{"compilerOptions":{"allowJs":false,"moduleResolution":"Bundler","paths":{"typed-package":["./local.ts"]}}}"#
            } else {
                r#"{"compilerOptions":{"allowJs":false,"moduleResolution":"Bundler"}}"#
            },
        );
        write(&importer, ENTRY);
        write(
            &root.join("local.ts"),
            "export interface Value { local: true }\n",
        );
        write(
            &package.join("package.json"),
            r#"{"name":"typed-package","types":"./index.d.ts"}"#,
        );
        write(&declaration, DECLARATION);
        Self {
            _root: temp,
            root,
            importer,
            declaration,
        }
    }

    fn project(&self) -> VirtualProject {
        let mut project = VirtualProject::new(&self.root).unwrap();
        project.register_path(&self.importer).unwrap();
        project
    }

    fn changed(&self) -> FxHashSet<PathBuf> {
        FxHashSet::from_iter([self.importer.clone()])
    }
}

#[test]
fn observed_original_owner_matches_legacy_and_keeps_positive_non_vue_binding() {
    let fixture = Fixture::new(false);
    let mut legacy = fixture.project();
    let mut observed = fixture.project();
    assert!(!observed.source_file_policy().allows_javascript());
    assert!(!observed.jsx_typecheck);
    legacy.reconcile_package_routes_for_importers_inner(&fixture.changed());
    let facts = observed.reconcile_package_routes_for_importers_inner_observed(&fixture.changed());
    assert_same_owner(&legacy, &observed);
    let bindings = observed.package_routes_snapshot();
    assert_eq!(bindings.len(), 1);
    assert!(bindings[0].route.is_none());
    assert!(
        bindings[0]
            .invalidation_paths
            .contains(&fixture.declaration)
    );
    assert!(
        facts.stamps.contains(
            &InputStamp::observed_source(fixture.declaration.clone(), DECLARATION.as_bytes(),)
                .with_owner(std::sync::Arc::new(FactOwner {
                    path: fixture.importer.clone(),
                    role: FactRole::LocalImporter,
                }))
        )
    );
    // Returned same-operation facts do not establish source/root-owner completion.
    assert!(!facts.qualified);
    assert_eq!(observed.package_route_metrics().reachability_checks, 1);
}

#[test]
fn observed_owner_keeps_original_alias_local_short_circuit_and_zero_package_work() {
    let fixture = Fixture::new(true);
    let mut legacy = fixture.project();
    let mut observed = fixture.project();
    legacy.reconcile_package_routes_for_importers_inner(&fixture.changed());
    let facts = observed.reconcile_package_routes_for_importers_inner_observed(&fixture.changed());
    assert_same_owner(&legacy, &observed);
    assert!(observed.package_routes_snapshot().is_empty());
    assert_eq!(observed.package_route_metrics().reachability_checks, 0);
    assert!(facts.stamps.contains(
        &InputStamp::observed_is_file(fixture.root.join("local.ts"), true).with_owner(
            std::sync::Arc::new(FactOwner {
                path: fixture.importer.clone(),
                role: FactRole::LocalImporter,
            })
        )
    ));
    assert!(facts.stamps.contains(&InputStamp::observed_source(
        fixture.root.join("tsconfig.json"),
        r#"{"compilerOptions":{"allowJs":false,"moduleResolution":"Bundler","paths":{"typed-package":["./local.ts"]}}}"#.as_bytes(),
    ).with_owner(std::sync::Arc::new(FactOwner {
        path: fixture.root.clone(),
        role: FactRole::Configuration,
    }))));
    assert!(!facts.qualified);
}

#[test]
fn repeated_original_owner_removes_old_binding_without_an_extra_reachability_scan() {
    let fixture = Fixture::new(false);
    let mut legacy = fixture.project();
    let mut observed = fixture.project();
    legacy.reconcile_package_routes_for_importers_inner(&fixture.changed());
    observed.reconcile_package_routes_for_importers_inner_observed(&fixture.changed());
    assert_eq!(observed.package_routes_snapshot().len(), 1);
    let replacement = "export const noPackage = true;\n";
    write(&fixture.importer, replacement);
    legacy
        .register_path_with_content(&fixture.importer, replacement)
        .unwrap();
    observed
        .register_path_with_content(&fixture.importer, replacement)
        .unwrap();
    legacy.reconcile_package_routes_for_importers_inner(&fixture.changed());
    let facts = observed.reconcile_package_routes_for_importers_inner_observed(&fixture.changed());
    assert_same_owner(&legacy, &observed);
    assert!(observed.package_routes_snapshot().is_empty());
    assert_eq!(observed.package_route_metrics().reachability_checks, 1);
    assert!(observed.package_route_importers.is_empty());
    assert!(observed.package_route_reverse.is_empty());
    assert!(!observed.package_routes_need_refresh);
    assert!(!facts.qualified);
}

#[test]
fn actual_incomplete_constructor_witness_is_retained_without_promoting_owner_completion() {
    let fixture = Fixture::new(false);
    let constructor = VirtualProject::new_observed(&fixture.root).unwrap();
    let witness = crate::package_route::stamp::Consumed {
        value: (),
        stamps: constructor.stamps,
        qualified: constructor.qualified,
    };
    assert!(!witness.qualified);
    assert!(!witness.stamps.is_empty());
    let mut project = constructor.value;
    project.register_path(&fixture.importer).unwrap();
    let result = project.reconcile_package_routes_for_importers_inner_observed_with_inputs(
        &fixture.changed(),
        &witness,
    );
    assert!(!result.qualified);
    assert_eq!(
        &result.stamps[..witness.stamps.len()],
        witness.stamps.as_slice()
    );
    assert_eq!(project.package_routes_snapshot().len(), 1);
    let mut legacy = fixture.project();
    legacy.reconcile_package_routes_for_importers_inner(&fixture.changed());
    assert_same_owner(&legacy, &project);
}

#[test]
fn retiring_inner_importer_preserves_global_settings_and_original_cold_gap() {
    let fixture = Fixture::new(false);
    let mut legacy = fixture.project();
    let mut observed = fixture.project();
    legacy.reconcile_package_routes_for_importers_inner(&fixture.changed());
    let packet = observed.reconcile_package_routes_for_importers_inner_observed(&fixture.changed());
    assert_same_owner(&legacy, &observed);
    assert!(!packet.qualified); // The original mapped-input/policy witness is absent.
    let declaration =
        InputStamp::observed_source(fixture.declaration.clone(), DECLARATION.as_bytes())
            .with_owner(std::sync::Arc::new(FactOwner {
                path: fixture.importer.clone(),
                role: FactRole::LocalImporter,
            }));
    assert!(packet.stamps.contains(&declaration));
    let config = InputStamp::observed_source(
        fixture.root.join("tsconfig.json"),
        r#"{"compilerOptions":{"allowJs":false,"moduleResolution":"Bundler"}}"#.as_bytes(),
    )
    .with_owner(std::sync::Arc::new(FactOwner {
        path: fixture.root.clone(),
        role: FactRole::Configuration,
    }));
    assert!(packet.stamps.contains(&config));
    let retained = packet
        .stamps
        .into_iter()
        .filter(|stamp| {
            !stamp.owner().is_some_and(|owner| {
                owner.role == FactRole::LocalImporter && owner.path == fixture.importer
            })
        })
        .collect::<Vec<_>>();
    assert!(!retained.contains(&declaration));
    assert!(retained.contains(&config));
    assert_eq!(observed.package_route_metrics().reachability_checks, 1);
}

fn assert_same_owner(legacy: &VirtualProject, observed: &VirtualProject) {
    assert_eq!(
        legacy.package_routes_snapshot(),
        observed.package_routes_snapshot()
    );
    assert_eq!(
        legacy.package_route_importers,
        observed.package_route_importers
    );
    assert_eq!(legacy.package_route_reverse, observed.package_route_reverse);
    assert_eq!(
        legacy.package_route_source_owners,
        observed.package_route_source_owners
    );
    assert_eq!(
        legacy.package_route_manifests,
        observed.package_route_manifests
    );
    assert_eq!(legacy.package_route_roots, observed.package_route_roots);
    assert_eq!(legacy.package_source_index, observed.package_source_index);
    assert_eq!(
        legacy.package_route_refresh_keys,
        observed.package_route_refresh_keys
    );
    assert_eq!(
        legacy.package_routes_need_refresh,
        observed.package_routes_need_refresh
    );
    assert_eq!(legacy.dependency_edges, observed.dependency_edges);
    assert_eq!(legacy.dependency_inbound, observed.dependency_inbound);
    assert_eq!(
        legacy.registered_original_paths_sorted(),
        observed.registered_original_paths_sorted()
    );
    let left = legacy.package_route_metrics();
    let right = observed.package_route_metrics();
    assert_eq!(left.reachability_checks, right.reachability_checks);
    assert_eq!(
        left.reachability_budget_exceeded,
        right.reachability_budget_exceeded
    );
    assert_eq!(left.last_reachability_files, right.last_reachability_files);
    assert_eq!(left.last_reachability_bytes, right.last_reachability_bytes);
    assert_eq!(left.last_reachability_edges, right.last_reachability_edges);
    assert_eq!(
        left.last_reachability_parses,
        right.last_reachability_parses
    );
    assert_eq!(
        left.last_reachability_packages,
        right.last_reachability_packages
    );
    assert_eq!(
        left.last_refresh_total_routes,
        right.last_refresh_total_routes
    );
    assert_eq!(
        left.last_refresh_considered_routes,
        right.last_refresh_considered_routes
    );
    assert_eq!(
        left.last_refresh_affected_routes,
        right.last_refresh_affected_routes
    );
}

fn write(path: &Path, body: &str) {
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(path, body).unwrap();
}
