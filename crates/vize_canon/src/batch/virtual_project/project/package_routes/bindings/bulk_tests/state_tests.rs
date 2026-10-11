use super::{InputStamp, VirtualProject};
use vize_carton::cstr;

pub(super) fn assert_owner_sharing(before: &[InputStamp], after: &[InputStamp]) {
    for (i, left) in before.iter().enumerate() {
        for (j, right) in before[..i].iter().enumerate() {
            let shared = |left: &InputStamp, right: &InputStamp| match (left.owner(), right.owner())
            {
                (Some(left), Some(right)) => std::ptr::eq(left, right),
                (None, None) => true,
                _ => false,
            };
            assert_eq!(shared(&after[i], &after[j]), shared(left, right));
        }
    }
}

pub(super) fn assert_same_registry(left: &VirtualProject, right: &VirtualProject) {
    assert_eq!(left.package_routes, right.package_routes);
    assert_eq!(left.package_route_importers, right.package_route_importers);
    assert_eq!(left.package_route_reverse, right.package_route_reverse);
    assert_eq!(
        left.package_route_source_owners,
        right.package_route_source_owners
    );
    assert_eq!(left.package_route_manifests, right.package_route_manifests);
    assert_eq!(left.package_route_roots, right.package_route_roots);
    assert_eq!(left.package_source_index, right.package_source_index);
    assert_eq!(
        left.package_route_refresh_keys,
        right.package_route_refresh_keys
    );
    assert_eq!(
        left.package_routes_need_refresh,
        right.package_routes_need_refresh
    );
    assert_eq!(left.dependency_edges, right.dependency_edges);
    assert_eq!(left.dependency_inbound, right.dependency_inbound);
    assert_eq!(left.original_index, right.original_index);
    assert_eq!(left.original_contents, right.original_contents);
    assert_eq!(left.package_shadow_files, right.package_shadow_files);
    assert_eq!(
        left.package_shadow_manifests,
        right.package_shadow_manifests
    );
    assert_eq!(
        left.package_shadow_source_paths,
        right.package_shadow_source_paths
    );
    assert_eq!(left.package_shadow_scopes, right.package_shadow_scopes);
    assert_eq!(
        left.package_shadow_file_owners,
        right.package_shadow_file_owners
    );
    assert_eq!(
        left.package_shadow_manifest_owners,
        right.package_shadow_manifest_owners
    );
    assert_eq!(
        left.package_shadow_dirty_keys,
        right.package_shadow_dirty_keys
    );
    assert_eq!(
        left.retired_package_shadow_paths,
        right.retired_package_shadow_paths
    );
    assert_eq!(
        left.registered_original_paths_sorted(),
        right.registered_original_paths_sorted()
    );
    assert_eq!(left.package_route_metrics(), right.package_route_metrics());
    assert_eq!(
        left.package_shadows_initialized,
        right.package_shadows_initialized
    );
    assert_eq!(
        left.materialized_package_links,
        right.materialized_package_links
    );
    assert_eq!(
        left.materialized_package_link_scopes,
        right.materialized_package_link_scopes
    );
    assert_eq!(
        left.materialized_package_link_owners,
        right.materialized_package_link_owners
    );
    assert_eq!(
        left.package_link_scope_files,
        right.package_link_scope_files
    );
    assert_eq!(
        left.package_link_scope_targets,
        right.package_link_scope_targets
    );
    assert_eq!(
        left.package_shadow_link_scopes,
        right.package_shadow_link_scopes
    );
    assert_eq!(
        left.incremental_package_link_scopes,
        right.incremental_package_link_scopes
    );
    assert_eq!(
        left.incremental_materialized_candidates,
        right.incremental_materialized_candidates
    );
    assert_eq!(
        left.incremental_source_nodes_rebuilt,
        right.incremental_source_nodes_rebuilt
    );
    assert_eq!(
        left.incremental_dependency_nodes_reconciled,
        right.incremental_dependency_nodes_reconciled
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
        let actual = right.package_shadow_artifacts.get(key).unwrap();
        assert_eq!(topology.files, actual.files);
        assert_eq!(topology.manifests, actual.manifests);
        assert_eq!(topology.aliases, actual.aliases);
        assert_eq!(topology.install_roots, actual.install_roots);
    }
    assert_eq!(left.virtual_files.len(), right.virtual_files.len());
    for (path, file) in &left.virtual_files {
        let actual = right.virtual_files.get(path).unwrap();
        assert_eq!(file.content, actual.content);
        assert_eq!(file.original_path, actual.original_path);
        assert_eq!(file.virtual_path, actual.virtual_path);
        assert_eq!(
            cstr!("{:?}", file.source_map),
            cstr!("{:?}", actual.source_map)
        );
    }
}
