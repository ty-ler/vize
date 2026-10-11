//! Complete original bulk output and dirty ownership, including duplicate keys.

use super::{Consumed, FxHashSet, VirtualProject};
use crate::package_route::stamp::{FactOwner, FactRole, InputStamp};
use crate::{PackageResolutionContext, PackageResolutionMode, PackageRoute, PackageRouteBinding};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use vize_carton::cstr;

#[path = "bulk_tests/state_tests.rs"]
mod state;

fn route(root: &Path, nested_routes: Vec<PackageRoute>) -> PackageRoute {
    PackageRoute {
        source_paths: vec![root.join("value.ts")],
        dependency_paths: vec![root.join("entry0.ts")],
        source_targets: Vec::new(),
        package_root: root.to_path_buf(),
        package_link_root: root.to_path_buf(),
        manifest_path: root.join("package.json"),
        package_name: Some("shared-package".into()),
        workspace_source: true,
        nested_routes,
    }
}

fn binding(root: &Path, index: usize, route: Option<PackageRoute>) -> PackageRouteBinding {
    PackageRouteBinding {
        importer_path: root.join(cstr!("entry{index}.ts").as_str()),
        specifier: "shared-package".into(),
        occurrence_mode: PackageResolutionMode::Import,
        context: PackageResolutionContext::default(),
        invalidation_paths: route
            .as_ref()
            .map_or_else(Vec::new, PackageRoute::invalidation_paths),
        route,
    }
}

fn project(root: &Path, paths: &[PathBuf]) -> VirtualProject {
    let mut project = VirtualProject::new(root).unwrap();
    project.set_session_script_registration(true);
    for path in paths {
        project.register_path(path).unwrap();
    }
    project
        .retired_package_shadow_paths
        .insert(root.join("retired.ts"));
    project
        .package_shadow_dirty_keys
        .insert(binding(root, 99, None).key());
    project
}

#[test]
fn bulk_known_dirty_owners_preserve_whole_original_packets_and_all_indexes() {
    for mode in 0..4 {
        let storage = tempfile::tempdir().unwrap();
        let root = vize_carton::path::canonicalize_non_verbatim(storage.path());
        let first = root.join("first");
        let second = root.join("second");
        let mut paths = Vec::new();
        for directory in [&first, &second] {
            std::fs::create_dir(directory).unwrap();
            std::fs::write(
                directory.join("package.json"),
                r#"{"name":"shared-package"}"#,
            )
            .unwrap();
            for name in (0..12)
                .map(|index| cstr!("entry{index}.ts"))
                .chain(["value.ts".into()])
            {
                let path = directory.join(name.as_str());
                std::fs::write(&path, "export const value = 1;\n").unwrap();
                paths.push(path);
            }
        }
        let nested = route(&second, Vec::new());
        let shared = route(&first, vec![nested.clone(), nested]);
        let mut original = project(&root, &paths);
        let mut candidate = project(&root, &paths);
        let owner = Arc::new(FactOwner {
            path: paths[0].clone(),
            role: FactRole::EditorImporter,
        });
        let stamp = InputStamp::observed_source(paths[0].clone(), b"export const value = 1;\n")
            .with_owner(Arc::clone(&owner));
        for round in 0..5 {
            let mut bindings = match round {
                0 | 1 => (0..12)
                    .map(|index| binding(&first, index, Some(shared.clone())))
                    .collect::<Vec<_>>(),
                2 => (4..12)
                    .map(|index| binding(&first, index, Some(route(&second, Vec::new()))))
                    .collect(),
                3 => Vec::new(),
                _ => vec![
                    binding(&first, 0, Some(shared.clone())),
                    binding(&second, 4, None),
                ],
            };
            if round < 3 {
                // Same-key replacement exercises the unchanged ordinary remove path.
                bindings.push(binding(&first, 4, None));
                bindings.push(binding(&first, 4, Some(shared.clone())));
            }
            let packet = || Consumed {
                value: (),
                stamps: vec![stamp.clone(), stamp.clone()],
                qualified: mode & 1 != 0,
            };
            let mut before = packet();
            let mut after = packet();
            original.original_bulk_replace(bindings.clone(), mode & 2 != 0, &mut before);
            candidate.replace_package_route_bindings_with_consumption(
                bindings,
                mode & 2 != 0,
                &mut after,
            );
            assert_eq!(after.qualified, before.qualified);
            assert_eq!(after.stamps, before.stamps, "mode={mode};round={round}");
            assert!(std::ptr::eq(
                after.stamps[0].owner().unwrap(),
                owner.as_ref()
            ));
            state::assert_owner_sharing(&before.stamps, &after.stamps);
            state::assert_same_registry(&original, &candidate);
            let key = binding(&first, 4, None).key();
            let before = original.remove_package_route_binding_observed(&key);
            let after = candidate.remove_package_route_binding_observed(&key);
            assert_eq!(after.value, before.value);
            assert_eq!(after.qualified, before.qualified);
            assert_eq!(after.stamps, before.stamps);
            state::assert_owner_sharing(&before.stamps, &after.stamps);
            state::assert_same_registry(&original, &candidate);
            let replacement = binding(&first, 4, Some(shared.clone()));
            let before = original.insert_package_route_binding_observed(replacement.clone());
            let after = candidate.insert_package_route_binding_observed(replacement);
            assert_eq!(after.qualified, before.qualified);
            assert_eq!(after.stamps, before.stamps);
            state::assert_owner_sharing(&before.stamps, &after.stamps);
            state::assert_same_registry(&original, &candidate);
            // The next replacement consumes genuine retained warm shadow state,
            // including old artifacts, owner maps and materialization candidates.
            let before = original.rebuild_package_shadows_observed().unwrap();
            let after = candidate.rebuild_package_shadows_observed().unwrap();
            assert_eq!(after.qualified, before.qualified);
            assert_eq!(after.stamps, before.stamps);
            state::assert_owner_sharing(&before.stamps, &after.stamps);
            state::assert_same_registry(&original, &candidate);
            assert!(candidate.package_shadows_initialized);
            assert!(!candidate.package_shadow_artifacts.is_empty());
            assert!(!candidate.package_shadow_files.is_empty());
            assert!(!candidate.package_shadow_manifests.is_empty());
            // Already-removed keys may still require the next original retirement.
            let retired = binding(&root, 99, None).key();
            original.package_shadow_dirty_keys.insert(retired.clone());
            candidate.package_shadow_dirty_keys.insert(retired);
        }
    }
}

impl VirtualProject {
    fn original_bulk_replace(
        &mut self,
        bindings: impl IntoIterator<Item = crate::PackageRouteBinding>,
        observe: bool,
        facts: &mut Consumed<()>,
    ) {
        let previous_roots = self
            .package_route_roots
            .keys()
            .cloned()
            .collect::<FxHashSet<_>>();
        // Every replaced old owner must reach the original shadow retirement,
        // including keys already removed by a preceding source/route operation.
        self.package_shadow_dirty_keys
            .extend(self.package_routes.keys().cloned());
        self.package_routes.clear();
        self.package_route_reverse.clear();
        self.package_route_importers.clear();
        self.package_route_source_owners.clear();
        self.package_route_manifests.clear();
        self.package_route_roots.clear();
        for binding in bindings {
            self.insert_package_route_binding_with_consumption::<false>(binding, observe, facts);
        }
        let current_roots = self
            .package_route_roots
            .keys()
            .cloned()
            .collect::<FxHashSet<_>>();
        self.package_source_index
            .retain(|root, _| current_roots.contains(root));
        let added_roots = current_roots
            .difference(&previous_roots)
            .cloned()
            .collect::<Vec<_>>();
        if !added_roots.is_empty() {
            let registered = self
                .original_index
                .iter()
                .map(|(source, virtual_path)| (source.clone(), virtual_path.clone()))
                .collect::<Vec<_>>();
            for (source, virtual_path) in registered {
                for root in &added_roots {
                    let Ok(relative) = source.strip_prefix(root) else {
                        continue;
                    };
                    self.package_source_index
                        .entry(root.clone())
                        .or_default()
                        .insert(
                            source.clone(),
                            (relative.to_path_buf(), virtual_path.clone()),
                        );
                }
            }
        }
    }
}
