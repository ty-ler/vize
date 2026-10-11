//! Unexecuted whole current-registration/binding retirement controls.

use crate::batch::virtual_project::VirtualProject;
use crate::{PackageResolutionContext, PackageResolutionMode, PackageRoute, PackageRouteBinding};
use std::path::{Path, PathBuf};
use vize_carton::FxHashSet;

fn fixture(names: &[&str]) -> (tempfile::TempDir, PathBuf, VirtualProject, Vec<PathBuf>) {
    let storage = tempfile::tempdir().unwrap();
    let root = storage.path().canonicalize().unwrap();
    let mut project = VirtualProject::new(&root).unwrap();
    project.set_session_script_registration(true);
    let paths = names.iter().map(|name| root.join(name)).collect::<Vec<_>>();
    for path in &paths {
        std::fs::write(path, "export const value = 1;\n").unwrap();
        project.register_path(path).unwrap();
    }
    (storage, root, project, paths)
}
fn route(source: &Path) -> PackageRoute {
    let root = source.parent().unwrap();
    PackageRoute {
        source_paths: vec![source.to_path_buf()],
        dependency_paths: Vec::new(),
        source_targets: Vec::new(),
        package_root: root.to_path_buf(),
        package_link_root: root.to_path_buf(),
        manifest_path: root.join("package.json"),
        package_name: Some("retirement-law".into()),
        workspace_source: false,
        nested_routes: Vec::new(),
    }
}
fn binding(importer: &Path, route: Option<PackageRoute>) -> PackageRouteBinding {
    PackageRouteBinding {
        importer_path: importer.to_path_buf(),
        specifier: "retirement-law".into(),
        occurrence_mode: PackageResolutionMode::Import,
        context: PackageResolutionContext::default(),
        route,
        invalidation_paths: vec![importer.to_path_buf()],
    }
}

#[test]
fn full_registration_not_an_index_key_controls_negative_binding_retirement() {
    let (_storage, root, mut project, paths) = fixture(&["Live.ts"]);
    let ghost = root.join("Ghost.ts");
    project
        .original_index
        .insert(ghost.clone(), root.join("absent-virtual.ts"));
    assert!(project.original_index.contains_key(&ghost));
    assert!(project.find_by_original(&ghost).is_none());
    let live = binding(&paths[0], None);
    let absent = binding(&ghost, None);
    project.insert_package_route_binding(live.clone());
    project.insert_package_route_binding(absent.clone());
    assert_eq!(
        project.current_package_route_bindings(),
        project.package_routes_snapshot()
    );
    let result = project.retire_unregistered_package_route_bindings_observed(
        Vec::new(),
        &FxHashSet::from_iter(paths.clone()),
    );
    assert!(result.qualified);
    assert_eq!(result.value.retired_importers, vec![ghost]);
    assert_eq!(result.value.removed_bindings, vec![absent]);
    assert!(result.value.released_sources.is_empty() && result.value.pruned_sources.is_empty());
    assert_eq!(project.current_package_route_bindings(), vec![live]);
    assert_eq!(
        project.current_package_route_bindings(),
        project.package_routes_snapshot()
    );
}

#[test]
fn actual_orphan_prune_recursively_retires_newly_unregistered_importer_keys() {
    let (_storage, _root, mut project, paths) = fixture(&["A.ts", "T.ts", "U.ts"]);
    let first = binding(&paths[0], Some(route(&paths[1])));
    let nested = binding(&paths[1], Some(route(&paths[2])));
    project.insert_package_route_binding(first.clone());
    project.insert_package_route_binding(nested.clone());
    project.remove_registered_source(&paths[0]);
    let result = project
        .retire_unregistered_package_route_bindings_observed(Vec::new(), &FxHashSet::default());
    assert!(result.qualified);
    let mut expected = paths.clone();
    expected.sort();
    assert_eq!(result.value.retired_importers, expected);
    assert_eq!(result.value.removed_bindings, vec![first, nested]);
    let mut pruned = paths[1..].to_vec();
    pruned.sort();
    assert_eq!(result.value.pruned_sources, pruned);
    assert_eq!(result.value.released_sources, result.value.pruned_sources);
    assert!(project.current_package_route_bindings().is_empty());
    assert!(project.package_route_source_owners.is_empty());
    assert!(project.package_route_roots.is_empty());
    assert!(project.package_source_index.is_empty());
    assert!(
        paths
            .iter()
            .all(|path| project.find_by_original(path).is_none())
    );
    assert!(project.dependency_edges.is_empty() && project.dependency_inbound.is_empty());
    let repeated = project
        .retire_unregistered_package_route_bindings_observed(Vec::new(), &FxHashSet::default());
    assert!(repeated.qualified && repeated.value.removed_bindings.is_empty());
    assert!(
        repeated.value.retired_importers.is_empty() && repeated.value.removed_artifacts.is_empty()
    );
}

#[test]
fn final_rebind_shared_owner_keeps_actual_source_and_whole_current_binding() {
    let (_storage, _root, mut project, paths) = fixture(&["A.ts", "B.ts", "T.ts"]);
    let removed = binding(&paths[0], Some(route(&paths[2])));
    let live = binding(&paths[1], Some(route(&paths[2])));
    project.insert_package_route_binding(removed.clone());
    // The actual current rebind is completed before the retirement call.
    project.insert_package_route_binding(live.clone());
    project.remove_registered_source(&paths[0]);
    let result = project.retire_unregistered_package_route_bindings_observed(
        Vec::new(),
        &FxHashSet::from_iter([paths[1].clone()]),
    );
    assert!(result.qualified);
    assert_eq!(result.value.removed_bindings, vec![removed]);
    assert_eq!(result.value.retired_importers, vec![paths[0].clone()]);
    assert_eq!(result.value.released_sources, vec![paths[2].clone()]);
    assert!(result.value.pruned_sources.is_empty());
    assert!(project.find_by_original(&paths[2]).is_some());
    assert_eq!(project.package_route_source_owners.get(&paths[2]), Some(&1));
    assert_eq!(project.current_package_route_bindings(), vec![live]);
}

#[test]
fn protected_current_seed_refuses_pruning_and_never_reports_it_retired() {
    let (_storage, _root, mut project, paths) = fixture(&["A.ts", "T.ts"]);
    project.insert_package_route_binding(binding(&paths[0], Some(route(&paths[1]))));
    project.remove_registered_source(&paths[0]);
    let result = project.retire_unregistered_package_route_bindings_observed(
        Vec::new(),
        &FxHashSet::from_iter([paths[1].clone()]),
    );
    assert!(!result.qualified);
    assert_eq!(result.value.protected_refusals, vec![paths[1].clone()]);
    assert_eq!(result.value.retired_importers, vec![paths[0].clone()]);
    assert!(result.value.pruned_sources.is_empty());
    assert!(project.find_by_original(&paths[1]).is_some());
    assert!(project.current_package_route_bindings().is_empty());
}

#[test]
fn actual_missing_owner_edges_are_released_and_registered_visited_target_is_retained() {
    let (_storage, _root, mut project, paths) = fixture(&["A.ts", "B.ts", "T.ts"]);
    project.insert_package_route_binding(binding(&paths[0], None));
    project.replace_dependency_edges(&paths[0], FxHashSet::from_iter([paths[2].clone()]));
    project.replace_dependency_edges(&paths[1], FxHashSet::from_iter([paths[2].clone()]));
    project.remove_registered_source(&paths[0]);
    let result = project.retire_unregistered_package_route_bindings_observed(
        Vec::new(),
        &FxHashSet::from_iter([paths[1].clone()]),
    );
    assert!(result.qualified);
    assert_eq!(result.value.retired_importers, vec![paths[0].clone()]);
    assert!(!project.dependency_edges.contains_key(&paths[0]));
    assert_eq!(project.dependency_inbound.get(&paths[2]), Some(&1));
    assert!(project.find_by_original(&paths[2]).is_some());
    assert!(result.value.pruned_sources.is_empty());
}
