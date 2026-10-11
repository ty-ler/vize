//! Borrow actual registered routes while retaining complete original shadow operations.
use super::VirtualProject;
use crate::package_route::stamp::InputStamp;
use crate::{PackageResolutionContext, PackageResolutionMode, PackageRoute, PackageRouteBinding};
use std::path::{Path, PathBuf};

#[path = "borrowed_routes_tests/original.rs"]
mod original;

fn fixture() -> (
    tempfile::TempDir,
    PathBuf,
    Vec<PackageRouteBinding>,
    Vec<PathBuf>,
) {
    let storage = tempfile::tempdir().unwrap();
    let root = storage.path().canonicalize().unwrap();
    std::fs::write(
        root.join("package.json"),
        r#"{"name":"app","type":"module"}"#,
    )
    .unwrap();
    std::fs::write(root.join("tsconfig.json"), "{}").unwrap();
    let mut sources = Vec::new();
    let mut routes = Vec::new();
    for name in ["p", "q", "r"] {
        let package = root.join(name);
        std::fs::create_dir(&package).unwrap();
        std::fs::write(
            package.join("package.json"),
            vize_carton::cstr!(r#"{{"name":"{name}"}}"#).as_bytes(),
        )
        .unwrap();
        let source = package.join("value.ts");
        std::fs::write(&source, "export const value = 1;\n").unwrap();
        sources.push(source.clone());
        routes.push(PackageRoute {
            package_root: package.clone(),
            package_link_root: package.clone(),
            manifest_path: package.join("package.json"),
            package_name: Some(name.into()),
            workspace_source: true,
            source_paths: vec![source.clone()],
            dependency_paths: vec![source],
            source_targets: Vec::new(),
            nested_routes: Vec::new(),
        });
    }
    let mut deep = routes[2].clone();
    for _ in 0..4 {
        deep = PackageRoute {
            nested_routes: vec![deep],
            ..routes[2].clone()
        };
    }
    let mut different = routes[1].clone();
    different.package_name = Some("different-same-manifest".into());
    routes[0].nested_routes = vec![deep, routes[1].clone(), different, routes[1].clone()];
    let mut bindings = Vec::new();
    for (index, specifier) in ["#first", "#second", "p", "#no-route"]
        .into_iter()
        .enumerate()
    {
        let importer_path = root.join(vize_carton::cstr!("app{index}.ts").as_str());
        std::fs::write(&importer_path, "export const app = 1;\n").unwrap();
        sources.push(importer_path.clone());
        bindings.push(PackageRouteBinding {
            importer_path,
            specifier: specifier.into(),
            occurrence_mode: PackageResolutionMode::Import,
            context: PackageResolutionContext::default(),
            invalidation_paths: Vec::new(),
            route: (index != 3).then(|| routes[0].clone()),
        });
    }
    (storage, root, bindings, sources)
}

fn project(root: &Path, bindings: &[PackageRouteBinding], sources: &[PathBuf]) -> VirtualProject {
    let mut project = VirtualProject::new(root).unwrap();
    project.set_session_script_registration(true);
    project.set_package_routes(bindings.iter().cloned());
    project.register_paths(sources).unwrap();
    project
}

#[expect(
    clippy::disallowed_macros,
    reason = "complete original state rendering"
)]
fn assert_whole_state(left: &VirtualProject, right: &VirtualProject) {
    macro_rules! fields {
        ($($field:ident),* $(,)?) => {
            // No wildcard: adding any project field must extend this complete law.
            let VirtualProject { $($field: _,)* typed_router: _, source_artifacts: _,
                package_shadow_artifacts: _, package_route_resolver: _, rewriter: _ } = left;
            $(assert_eq!(format!("{:?}", left.$field), format!("{:?}", right.$field), stringify!($field));)*
        };
    }
    fields!(
        project_root,
        virtual_root,
        tsconfig_path,
        preserve_unused_diagnostics,
        source_policy,
        alias_rewrite_policy,
        virtual_ts_options,
        diagnostic_paths,
        declaration_roots,
        virtual_ts_check_options,
        package_routes,
        package_route_reverse,
        package_route_importers,
        package_route_source_owners,
        package_route_manifests,
        package_route_roots,
        package_source_index,
        dependency_edges,
        dependency_inbound,
        package_routes_need_refresh,
        package_route_refresh_keys,
        package_shadow_files,
        package_shadow_manifests,
        retired_package_shadow_paths,
        package_shadow_file_owners,
        package_shadow_manifest_owners,
        package_shadow_source_paths,
        package_shadow_dirty_keys,
        package_shadows_initialized,
        package_shadow_scopes,
        incremental_materialized_candidates,
        incremental_source_nodes_rebuilt,
        incremental_dependency_nodes_reconciled,
        incremental_shadow_bindings_rebuilt,
        materialized_package_links,
        materialized_package_link_scopes,
        materialized_package_link_owners,
        package_link_scope_files,
        package_link_scope_targets,
        package_shadow_link_scopes,
        incremental_package_link_scopes,
        incremental_link_topology_dirty,
        options_api,
        session_scripts,
        editor_document_options,
        pre_rewrite_code,
        legacy_vue2,
        jsx_typecheck,
        dialect,
        template_syntax,
        experimental_in_tag_comments,
        experimental_patterned_template,
        experimental_strict_slot_children,
        virtual_files,
        shared_helper_source_count,
        passthrough_files,
        original_index,
        original_contents,
        unchecked_javascript_files,
        diagnostics
    );
    assert_eq!(left.typed_router.root, right.typed_router.root);
    assert_eq!(
        left.typed_router.import_files,
        right.typed_router.import_files
    );
    assert_eq!(left.source_artifacts.len(), right.source_artifacts.len());
    for (key, value) in &left.source_artifacts {
        let actual = &right.source_artifacts[key];
        assert_eq!(value.virtual_paths, actual.virtual_paths);
        assert_eq!(value.passthrough_paths, actual.passthrough_paths);
    }
    assert_eq!(
        left.package_shadow_artifacts.len(),
        right.package_shadow_artifacts.len()
    );
    for (key, value) in &left.package_shadow_artifacts {
        let actual = &right.package_shadow_artifacts[key];
        assert_eq!(value.files, actual.files);
        assert_eq!(value.manifests, actual.manifests);
        assert_eq!(value.aliases, actual.aliases);
        assert_eq!(value.install_roots, actual.install_roots);
    }
    assert_eq!(left.package_route_metrics(), right.package_route_metrics());
    assert_eq!(std::mem::size_of_val(&left.rewriter), 0);
    assert_eq!(std::mem::size_of_val(&right.rewriter), 0);
}

fn assert_owner_sharing(before: &[InputStamp], after: &[InputStamp]) {
    assert_eq!(before, after);
    for (i, left) in before.iter().enumerate() {
        for (j, right) in before.iter().enumerate() {
            let shared = |a: &InputStamp, b: &InputStamp| {
                a.owner()
                    .zip(b.owner())
                    .is_some_and(|(a, b)| std::ptr::eq(a, b))
            };
            assert_eq!(shared(left, right), shared(&after[i], &after[j]));
        }
    }
}

#[test]
fn private_route_borrows_keep_every_original_value_order_and_registered_pointer() {
    let (_storage, root, bindings, sources) = fixture();
    let mut project = project(&root, &bindings, &sources);
    for wave in 0..3 {
        let manifest = root.join("p/package.json");
        let before = project.original_private_dependencies_for(&manifest);
        let after = project.private_dependencies_for(&manifest);
        assert_eq!(
            before,
            after
                .iter()
                .map(|route| (*route).clone())
                .collect::<Vec<_>>()
        );
        let mut pointers = project
            .package_route_manifests
            .get(&manifest)
            .into_iter()
            .flatten()
            .filter_map(|key| project.package_routes.get(key))
            .filter(|binding| binding.specifier.starts_with('#'))
            .filter_map(|binding| binding.route.as_ref())
            .flat_map(|route| route.nested_routes.iter())
            .collect::<Vec<_>>();
        pointers.sort_by(|left, right| left.manifest_path.cmp(&right.manifest_path));
        pointers.dedup();
        assert_eq!(pointers.len(), after.len());
        for (expected, actual) in pointers.into_iter().zip(after) {
            assert!(std::ptr::eq(expected, actual));
        }
        if wave == 0 {
            assert!(
                before
                    .windows(3)
                    .any(|routes| routes[0] == routes[2] && routes[0] != routes[1])
            );
        }
        if wave == 0 {
            project.remove_package_route_binding(&bindings[0].key());
        } else {
            project.remove_package_route_binding(&bindings[1].key());
        }
    }
    assert!(
        project
            .private_dependencies_for(&root.join("absent/package.json"))
            .is_empty()
    );
}

#[test]
fn borrowed_binding_keeps_whole_original_shadow_packets_and_all_project_fields() {
    let (_storage, root, bindings, sources) = fixture();
    for observe in [false, true] {
        let mut original = project(&root, &bindings, &sources);
        let mut candidate = project(&root, &bindings, &sources);
        let original_resolver = original.package_route_resolver.clone();
        let candidate_resolver = candidate.package_route_resolver.clone();
        for wave in 0..6 {
            for project in [&mut original, &mut candidate] {
                match wave {
                    2 => {
                        project.remove_package_route_binding(&bindings[0].key());
                    }
                    3 => {
                        project
                            .register_path_with_content(&sources[0], "export const value = 2;\n")
                            .unwrap();
                    }
                    4 => {
                        project.set_package_routes(bindings.iter().cloned());
                    }
                    5 => {
                        project.set_package_routes(Vec::new());
                    }
                    _ => {}
                }
            }
            let before = original.original_rebuild_package_shadows(observe).unwrap();
            let after = candidate
                .rebuild_package_shadows_with_consumption(observe)
                .unwrap();
            assert_eq!(before.value, after.value);
            assert_eq!(before.qualified, after.qualified);
            assert_owner_sharing(&before.stamps, &after.stamps);
            assert_whole_state(&original, &candidate);
            assert!(std::ptr::eq(
                original.package_route_resolver.as_ref(),
                original_resolver.as_ref()
            ));
            assert!(std::ptr::eq(
                candidate.package_route_resolver.as_ref(),
                candidate_resolver.as_ref()
            ));
        }
    }
}
