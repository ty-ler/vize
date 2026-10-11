use super::super::ParsedDependencySources;
use crate::batch::virtual_project::VirtualProject;
use crate::package_route::stamp::{Consumed, FactOwner, FactRole, InputStamp, Shared};
use std::path::{Path, PathBuf};
use vize_carton::{FxHashMap, String};

// Exhaustive field binding keeps the whole project-state oracle current.
// Opaque resolver input is represented by its complete public metrics; this
// fixture supplies its own callback and never invokes that unused resolver.
#[expect(
    clippy::disallowed_types,
    reason = "complete regression state rendering"
)]
#[expect(
    clippy::disallowed_macros,
    reason = "complete regression state rendering"
)]
fn state(project: &VirtualProject) -> Vec<(&'static str, std::string::String)> {
    let VirtualProject {
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
        typed_router,
        package_routes,
        package_route_reverse,
        package_route_importers,
        package_route_source_owners,
        package_route_manifests,
        package_route_roots,
        package_source_index,
        dependency_edges,
        dependency_inbound,
        package_route_resolver,
        package_routes_need_refresh,
        package_route_refresh_keys,
        package_shadow_files,
        package_shadow_manifests,
        package_shadow_artifacts,
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
        source_artifacts,
        passthrough_files,
        original_index,
        original_contents,
        unchecked_javascript_files,
        diagnostics,
        rewriter,
    } = project;
    macro_rules! records {
        ($($field:ident),* $(,)?) => {
            vec![$((stringify!($field), format!("{:?}", $field))),*]
        };
    }
    let mut packet = records!(
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
        diagnostics,
    );
    packet.push((
        "typed_router",
        format!("{:?}", (&typed_router.root, &typed_router.import_files)),
    ));
    packet.push((
        "source_artifacts",
        format!(
            "{:?}",
            source_artifacts
                .iter()
                .map(|(path, artifacts)| (
                    path,
                    &artifacts.virtual_paths,
                    &artifacts.passthrough_paths
                ))
                .collect::<Vec<_>>()
        ),
    ));
    packet.push((
        "package_shadow_artifacts",
        format!(
            "{:?}",
            package_shadow_artifacts
                .iter()
                .map(|(key, topology)| (
                    key,
                    &topology.files,
                    &topology.manifests,
                    &topology.aliases,
                    &topology.install_roots
                ))
                .collect::<Vec<_>>()
        ),
    ));
    packet.push((
        "package_route_resolver",
        format!(
            "{:?}",
            package_route_resolver
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .metrics()
        ),
    ));
    // The production ImportRewriter is a stateless unit struct.
    assert_eq!(std::mem::size_of_val(rewriter), 0);
    packet.push(("rewriter", "stateless".into()));
    packet
}

fn run(
    project: &mut VirtualProject,
    overlays: &FxHashMap<PathBuf, &str>,
    parsed: Option<&mut ParsedDependencySources>,
    callbacks: &mut Vec<(PathBuf, String, crate::PackageResolutionMode)>,
) -> Consumed<Vec<PathBuf>> {
    let mut resolver = |importer: &Path, specifier: &str, mode| {
        callbacks.push((importer.to_path_buf(), specifier.into(), mode));
        Consumed {
            value: false,
            qualified: true,
            stamps: vec![
                InputStamp::observed_exists(importer.with_extension("consulted.json"), false)
                    .with_owner(Shared::new(FactOwner {
                        path: importer.to_path_buf(),
                        role: FactRole::LocalImporter,
                    })),
            ],
        }
    };
    match parsed {
        None => project.register_reachable_dependencies_with_package_resolver_observed(
            overlays,
            &[],
            &mut resolver,
            None,
        ),
        Some(parsed) => project.register_reachable_dependencies_with_parsed_sources_observed(
            overlays,
            &[],
            &mut resolver,
            None,
            Some(parsed),
        ),
    }
    .unwrap()
}

fn equal_owner_sharing(left: &[InputStamp], right: &[InputStamp]) {
    assert_eq!(left, right);
    for (i, before) in left.iter().enumerate() {
        for (j, other) in left.iter().enumerate() {
            let shared = before
                .owner()
                .zip(other.owner())
                .is_some_and(|(a, b)| std::ptr::eq(a, b));
            let current = right[i]
                .owner()
                .zip(right[j].owner())
                .is_some_and(|(a, b)| std::ptr::eq(a, b));
            assert_eq!(shared, current);
        }
    }
}

#[test]
fn retained_parsing_preserves_every_actual_walk_callback_fact_edge_and_refusal() {
    let storage = tempfile::tempdir().unwrap();
    let root = storage.path().canonicalize().unwrap();
    let host = root.join("Host.ts");
    let child = root.join("Child.ts");
    let other = root.join("Other.ts");
    let unreadable = root.join("Unreadable.ts");
    let initial = "import './Child'; import './Other'; import './Missing'; import './Unreadable'; import 'bare'; const x = require('bare'); export {};";
    std::fs::write(&host, initial).unwrap();
    std::fs::write(&child, "export const child = 1;\n").unwrap();
    std::fs::write(&other, "export const other = 1;\n").unwrap();
    std::fs::write(&unreadable, [0xff, 0xfe]).unwrap();
    let mut original = VirtualProject::new(&root).unwrap();
    let mut candidate = VirtualProject::new(&root).unwrap();
    for project in [&mut original, &mut candidate] {
        project.set_session_script_registration(true);
        project.register_path(&host).unwrap();
    }
    let original_resolver = original.package_route_resolver.clone();
    let candidate_resolver = candidate.package_route_resolver.clone();
    let mut parsed = ParsedDependencySources::default();
    for wave in 0..6 {
        let mut overlays = FxHashMap::default();
        if wave == 2 {
            std::fs::write(&child, "export const child = 2;\n").unwrap();
            for project in [&mut original, &mut candidate] {
                project.register_path(&child).unwrap();
            }
        }
        if wave == 3 {
            std::fs::remove_file(&other).unwrap();
            overlays.insert(other.clone(), "export const unsaved = 1;\n");
            let source = "/// <reference path='./Other.ts' />\nimport './Child'; import './Other'; import 'bare'; export {};";
            for project in [&mut original, &mut candidate] {
                project.register_path_with_content(&host, source).unwrap();
            }
        }
        if wave == 4 {
            std::fs::write(&other, "export const repaired = 1;\n").unwrap();
            for project in [&mut original, &mut candidate] {
                project.register_path(&other).unwrap();
            }
        }
        let mut old_calls = Vec::new();
        let mut new_calls = Vec::new();
        let before = run(&mut original, &overlays, None, &mut old_calls);
        let after = run(&mut candidate, &overlays, Some(&mut parsed), &mut new_calls);
        assert_eq!(before.value, after.value);
        assert_eq!(before.qualified, after.qualified);
        equal_owner_sharing(&before.stamps, &after.stamps);
        assert_eq!(old_calls, new_calls);
        assert_eq!(state(&original), state(&candidate));
        assert!(std::ptr::eq(
            original.package_route_resolver.as_ref(),
            original_resolver.as_ref()
        ));
        assert!(std::ptr::eq(
            candidate.package_route_resolver.as_ref(),
            candidate_resolver.as_ref()
        ));
        if wave == 0 {
            assert!(!after.qualified);
            assert!(after.stamps.iter().any(|stamp| stamp.path() == unreadable));
            assert!(!new_calls.is_empty());
        }
    }
    assert!(parsed.hits > parsed.parses);
}
