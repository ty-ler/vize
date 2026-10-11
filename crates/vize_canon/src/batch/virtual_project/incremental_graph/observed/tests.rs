//! Unexecuted actual-operation controls; no native diagnostic/runtime credit.

use crate::batch::virtual_project::VirtualProject;
use crate::package_route::stamp::FactRole;
use std::path::{Path, PathBuf};
use vize_carton::FxHashSet;

fn project(root: &Path) -> (VirtualProject, Vec<PathBuf>) {
    let mut project = VirtualProject::new(root).unwrap();
    project.set_session_script_registration(true);
    let paths = ["A.ts", "T.ts", "U.ts"].map(|name| root.join(name));
    for path in &paths {
        std::fs::write(path, "export const value = 1;\n").unwrap();
        project.register_path(path).unwrap();
    }
    project.replace_dependency_edges(&paths[0], FxHashSet::from_iter([paths[1].clone()]));
    project.replace_dependency_edges(&paths[1], FxHashSet::from_iter([paths[2].clone()]));
    (project, paths.to_vec())
}

#[expect(clippy::disallowed_types, reason = "whole source fixture packet")]
#[expect(clippy::disallowed_macros, reason = "whole source fixture packet")]
fn whole(project: &VirtualProject) -> std::string::String {
    let files = project
        .virtual_files_sorted()
        .into_iter()
        .map(|file| {
            (
                file.original_path.clone(),
                file.virtual_path.clone(),
                file.content.clone(),
                format!("{:?}", file.source_map),
            )
        })
        .collect::<Vec<_>>();
    format!(
        "{:?}",
        (
            files,
            &project.original_index,
            &project.original_contents,
            &project.dependency_edges,
            &project.dependency_inbound,
            project.diagnostics(),
            project.package_routes_snapshot(),
            &project.package_route_roots,
            &project.package_route_source_owners,
            &project.package_source_index,
            project.source_patch_work(),
        )
    )
}

#[test]
fn observed_removal_keeps_whole_original_result_graph_maps_and_work_counts() {
    let storage = tempfile::tempdir().unwrap();
    let root = storage.path().canonicalize().unwrap();
    let (mut legacy, paths) = project(&root);
    let (mut observed, _) = project(&root);
    assert_eq!(whole(&legacy), whole(&observed));
    let original = legacy.remove_source_and_dependencies(&paths[0]);
    let packet = observed.remove_source_and_dependencies_observed(&paths[0]);
    assert_eq!(packet.value, original);
    assert_eq!(whole(&observed), whole(&legacy));
    assert!(packet.qualified && !packet.stamps.is_empty());
    assert!(
        packet
            .stamps
            .iter()
            .all(
                |stamp| stamp.owner().is_some_and(|owner| owner.path.is_absolute()
                    && matches!(
                        owner.role,
                        FactRole::AuthoredSource | FactRole::LocalImporter
                    ))
            )
    );
    assert!(
        paths
            .iter()
            .all(|path| observed.find_by_original(path).is_none())
    );
}

#[test]
fn duplicate_prune_candidates_keep_original_queue_result_and_actual_canonical_owner_facts() {
    let storage = tempfile::tempdir().unwrap();
    let root = storage.path().canonicalize().unwrap();
    let (mut legacy, paths) = project(&root);
    let (mut observed, _) = project(&root);
    legacy.replace_dependency_edges(&paths[0], FxHashSet::default());
    observed.replace_dependency_edges(&paths[0], FxHashSet::default());
    let candidates = vec![paths[1].clone(), paths[1].clone()];
    let original = legacy.prune_unowned_sources(candidates.clone());
    let packet = observed.prune_unowned_sources_observed(candidates);
    assert_eq!(packet.value, original);
    assert_eq!(whole(&observed), whole(&legacy));
    assert!(packet.qualified);
    assert_eq!(
        packet
            .stamps
            .iter()
            .filter(|stamp| stamp.owner().is_some_and(
                |owner| owner.path == paths[1] && owner.role == FactRole::AuthoredSource
            ))
            .count(),
        4
    );
    assert!(observed.find_by_original(&paths[0]).is_some());
    assert!(observed.find_by_original(&paths[1]).is_none());
    assert!(observed.find_by_original(&paths[2]).is_none());
}

#[test]
fn protected_descendant_is_refused_in_the_same_actual_prune_queue() {
    let storage = tempfile::tempdir().unwrap();
    let root = storage.path().canonicalize().unwrap();
    let (mut project, paths) = project(&root);
    project.replace_dependency_edges(&paths[0], FxHashSet::default());
    let protected = FxHashSet::from_iter([paths[2].clone()]);
    let packet = project
        .prune_unowned_sources_preserving_observed(std::iter::once(paths[1].clone()), &protected);
    assert!(!packet.qualified);
    let (artifacts, blocked, actual_pruned) = packet.value;
    assert!(!artifacts.is_empty());
    assert_eq!(blocked, vec![paths[2].clone()]);
    assert_eq!(actual_pruned, vec![paths[1].clone()]);
    assert!(project.find_by_original(&paths[1]).is_none());
    assert!(project.find_by_original(&paths[2]).is_some());
    assert!(!project.dependency_edges.contains_key(&paths[1]));
}

#[test]
fn relative_importer_preserves_original_edge_result_but_refuses_observed_authority() {
    let storage = tempfile::tempdir().unwrap();
    let root = storage.path().canonicalize().unwrap();
    let mut legacy = VirtualProject::new(&root).unwrap();
    let mut observed = VirtualProject::new(&root).unwrap();
    let importer = PathBuf::from("unregistered-relative-source.ts");
    let original = legacy.replace_dependency_edges(&importer, FxHashSet::default());
    let packet = observed.replace_dependency_edges_observed(&importer, FxHashSet::default());
    assert_eq!(packet.value, original);
    assert_eq!(whole(&observed), whole(&legacy));
    assert!(!packet.qualified);
}
