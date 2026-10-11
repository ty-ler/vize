//! Complete original ordered callback packets and registry ownership after reconciliation.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use super::{VirtualProject, take};
use crate::package_route::stamp::{Consumed, FactOwner, FactRole, InputStamp};
use vize_carton::{FxHashSet, cstr};

const ENTRY: &str = "import type { Value } from 'typed-package';\n";

fn write(path: &Path, text: &str) {
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(path, text).unwrap();
}

fn project(root: &Path, importer: &Path) -> VirtualProject {
    let mut project = VirtualProject::new(root).unwrap();
    project.register_path(importer).unwrap();
    project
}

fn packet(stamp: &InputStamp, qualified: bool) -> Consumed<()> {
    Consumed {
        value: (),
        stamps: vec![stamp.clone(), stamp.clone()],
        qualified,
    }
}

#[test]
fn inherited_input_join_preserves_whole_ordered_packets_and_actual_registry() {
    for mode in 0..64 {
        let storage = tempfile::tempdir().unwrap();
        let root = vize_carton::path::canonicalize_non_verbatim(storage.path());
        let importer = root.join("entry.ts");
        write(&root.join("package.json"), r#"{"type":"module"}"#);
        write(
            &root.join("tsconfig.json"),
            if mode & 32 != 0 {
                r#"{"compilerOptions":{"moduleResolution":"Bundler","paths":{"typed-package":["./local.ts"]}}}"#
            } else {
                r#"{"compilerOptions":{"moduleResolution":"Bundler"}}"#
            },
        );
        write(&importer, ENTRY);
        write(&root.join("local.ts"), "export interface Value {}\n");
        write(
            &root.join("node_modules/typed-package/package.json"),
            r#"{"name":"typed-package","types":"./index.d.ts"}"#,
        );
        write(
            &root.join("node_modules/typed-package/index.d.ts"),
            "export interface Value {}\n",
        );
        let mut original = project(&root, &importer);
        let mut optimized = project(&root, &importer);
        let inherited_path = root.join("inherited.ts");
        let caller_path = root.join("caller.ts");
        write(&inherited_path, "export const inherited = 1;\n");
        write(&caller_path, "export const caller = 2;\n");
        let inherited_owner = Arc::new(FactOwner {
            path: inherited_path.clone(),
            role: FactRole::AuthoredSource,
        });
        let caller_owner = Arc::new(FactOwner {
            path: caller_path.clone(),
            role: FactRole::EditorImporter,
        });
        let inherited_stamp =
            InputStamp::observed_source(inherited_path, b"export const inherited = 1;\n")
                .with_owner(Arc::clone(&inherited_owner));
        let caller_stamp = InputStamp::observed_source(caller_path, b"export const caller = 2;\n")
            .with_owner(Arc::clone(&caller_owner));
        let inputs = packet(&inherited_stamp, mode & 1 != 0);
        let changes = if mode & 16 != 0 {
            Vec::new()
        } else {
            vec![importer.clone()]
        };
        for round in 0..3 {
            if round == 2 {
                let body = "export const noPackage = true;\n";
                write(&importer, body);
                original
                    .register_path_with_content(&importer, body)
                    .unwrap();
                optimized
                    .register_path_with_content(&importer, body)
                    .unwrap();
            }
            let mut before = packet(&caller_stamp, mode & 2 != 0);
            let mut after = packet(&caller_stamp, mode & 2 != 0);
            let inputs = (mode & 8 != 0).then_some(&inputs);
            original.original_reconcile(&changes, mode & 4 != 0, &mut before, inputs);
            optimized.reconcile_package_routes_for_importers_with_consumption(
                &changes,
                mode & 4 != 0,
                &mut after,
                inputs,
            );
            assert_eq!(
                after.qualified, before.qualified,
                "mode={mode};round={round}"
            );
            assert_eq!(after.stamps, before.stamps, "mode={mode};round={round}");
            for stamp in &after.stamps {
                if stamp == &inherited_stamp {
                    assert!(std::ptr::eq(
                        stamp.owner().unwrap(),
                        inherited_owner.as_ref()
                    ));
                }
                if stamp == &caller_stamp {
                    assert!(std::ptr::eq(stamp.owner().unwrap(), caller_owner.as_ref()));
                }
            }
            for (i, left) in before.stamps.iter().enumerate() {
                for (j, right) in before.stamps[..i].iter().enumerate() {
                    let shared = match (left.owner(), right.owner()) {
                        (Some(left), Some(right)) => std::ptr::eq(left, right),
                        (None, None) => true,
                        _ => false,
                    };
                    let actual = match (after.stamps[i].owner(), after.stamps[j].owner()) {
                        (Some(left), Some(right)) => std::ptr::eq(left, right),
                        (None, None) => true,
                        _ => false,
                    };
                    assert_eq!(
                        actual, shared,
                        "complete owner sharing at {i}/{j};mode={mode};round={round}"
                    );
                }
            }
            assert_same_registry(&original, &optimized);
        }
    }
}

fn assert_same_registry(left: &VirtualProject, right: &VirtualProject) {
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

impl VirtualProject {
    fn original_reconcile(
        &mut self,
        changed: &[PathBuf],
        observe: bool,
        facts: &mut Consumed<()>,
        inputs: Option<&Consumed<()>>,
    ) {
        let changed = changed
            .iter()
            .map(|path| {
                let absolute = if path.is_absolute() {
                    path.clone()
                } else {
                    self.project_root.join(path)
                };
                Self::root_owner_canonical(
                    &absolute,
                    Some((&absolute, FactRole::LocalImporter)),
                    observe,
                    facts,
                )
            })
            .collect::<FxHashSet<_>>();
        let keys = changed
            .iter()
            .flat_map(|importer| {
                self.package_route_importers
                    .get(importer)
                    .into_iter()
                    .flatten()
            })
            .cloned()
            .collect();
        let retained = self.take_rebound_package_sources_with_consumption(&keys, observe, facts);
        if observe {
            if let Some(inputs) = inputs {
                let mut witness = Consumed {
                    value: (),
                    stamps: inputs.stamps.clone(),
                    qualified: inputs.qualified && facts.qualified,
                };
                witness.stamps.extend(facts.stamps.iter().cloned());
                take(
                    facts,
                    self.reconcile_package_routes_for_importers_inner_observed_with_inputs(
                        &changed, &witness,
                    ),
                );
            } else {
                take(
                    facts,
                    self.reconcile_package_routes_for_importers_inner_observed(&changed),
                );
            }
        } else {
            self.reconcile_package_routes_for_importers_inner(&changed);
        }
        self.restore_rebound_package_sources(retained);
    }
}
