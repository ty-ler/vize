//! Whole authored request transfer preserves all original projections and maps.

use super::*;

#[test]
fn owned_request_bytes_preserve_the_complete_actual_query_project() {
    let storage = tempfile::tempdir().unwrap();
    let root = vize_carton::path::canonicalize_non_verbatim(storage.path());
    let host = root.join("Host.vue");
    let child = root.join("Child.vue");
    let other = root.join("Other.vue");
    let host_source = "<script setup lang='ts'>import Child from './Child.vue'; const title = '日本語 🦀';</script><template><Child :title=\"title\" /></template>";
    let child_source = "<script setup lang='ts'>defineProps<{ title: string }>();</script><template>{{ title }}</template>";
    let other_source = "<script setup lang='ts'>const unrelated: number = 7;</script><template>{{ unrelated }}</template>";
    std::fs::write(&host, host_source).unwrap();
    std::fs::write(&child, "<template>old disk child</template>").unwrap();
    std::fs::write(&other, "<template>old disk unrelated</template>").unwrap();
    let session = crate::corsa_bridge::EditorMirrorSession::new();
    let routes = crate::PackageRouteResolver::default();
    let ts_options = VirtualTsOptions::default();
    let overlays = vec![
        (child.clone(), "<template>overridden duplicate</template>"),
        (child.clone(), child_source),
        (other.clone(), other_source),
    ];
    let requested = vec![(other.clone(), other_source), (host.clone(), host_source)];
    let environment = CorsaProjectEnvironment {
        virtual_ts_options: &ts_options,
        package_routes: &routes,
        project_root: Some(&root),
        tsconfig_path: None,
        editor_session: &session,
    };
    let before = build_vue_virtual_workspace_project(
        &host,
        host_source,
        Default::default(),
        &overlays,
        &requested,
        environment,
    )
    .unwrap();
    session.clear();
    let owned_overlays = own_sources(&overlays);
    let owned_requested = own_sources(&requested);
    assert_eq!(borrow_sources(&owned_overlays), overlays);
    assert_eq!(borrow_sources(&owned_requested), requested);
    let after = build_vue_virtual_workspace_project(
        &host.clone(),
        &String::from(host_source),
        Default::default(),
        &borrow_sources(&owned_overlays),
        &borrow_sources(&owned_requested),
        CorsaProjectEnvironment {
            virtual_ts_options: &ts_options.clone(),
            package_routes: &routes.clone(),
            editor_session: &session,
            ..environment
        },
    )
    .unwrap();
    assert_same_project(&after, &before);
}

fn assert_same_project(actual: &CorsaVueVirtualProject, expected: &CorsaVueVirtualProject) {
    let host = |project: &CorsaVueVirtualProject| {
        let host = &project.host;
        (
            host.request_uri.clone(),
            host.code.clone(),
            host.pre_rewrite_code.clone(),
            host.mapping.clone(),
            host.import_source_map.clone(),
            host.source_type,
            host.virtual_suffix,
            host.resolved_dependencies.clone(),
            host.session_project_root.clone(),
        )
    };
    assert_eq!(host(actual), host(expected));
    let dependencies = |project: &CorsaVueVirtualProject| {
        project
            .host
            .dependencies
            .iter()
            .map(|source| {
                (
                    source.source_path.clone(),
                    source.source.clone(),
                    source.request_uri.clone(),
                    source.code.clone(),
                    source.mapping.clone(),
                    source.import_source_map.clone(),
                    source.source_type,
                    source.virtual_suffix,
                )
            })
            .collect::<Vec<_>>()
    };
    assert_eq!(dependencies(actual), dependencies(expected));
    let sources = |project: &CorsaVueVirtualProject| {
        project
            .host
            .materialized_sources
            .iter()
            .map(|source| {
                (
                    source.materialized_path.clone(),
                    source.source_path.clone(),
                    source.source.clone(),
                    source.code.clone(),
                    source.mapping.clone(),
                    source.import_source_map.clone(),
                    source.mapping_kind,
                )
            })
            .collect::<Vec<_>>()
    };
    assert_eq!(sources(actual), sources(expected));
    assert_eq!(actual.documents, expected.documents);
    assert_eq!(actual.session_project_root, expected.session_project_root);
    assert_eq!(actual.session_config_path, expected.session_config_path);
    assert_eq!(actual.materialized_changes, expected.materialized_changes);
    for source in &actual.host.materialized_sources {
        let actual_catalog = actual
            .host
            .source_catalog
            .get(&source.materialized_path)
            .unwrap();
        let expected_catalog = expected
            .host
            .source_catalog
            .get(&source.materialized_path)
            .unwrap();
        let complete = |source: &crate::corsa_bridge::CorsaMaterializedSource| {
            (
                source.materialized_path.clone(),
                source.source_path.clone(),
                source.source.clone(),
                source.code.clone(),
                source.mapping.clone(),
                source.import_source_map.clone(),
                source.mapping_kind,
            )
        };
        assert_eq!(complete(&actual_catalog), complete(&expected_catalog));
    }
}
