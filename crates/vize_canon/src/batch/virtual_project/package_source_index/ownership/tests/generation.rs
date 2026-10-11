use super::{FxHashSet, PathBuf, VirtualProject, binding, registry, route, take};
use crate::package_route::stamp::Consumed;

const BODY: &str = "export const value = 1;\n";

fn fixture() -> (tempfile::TempDir, VirtualProject, Consumed<()>, PathBuf) {
    let storage = tempfile::tempdir().unwrap();
    let root = storage.path().canonicalize().unwrap();
    let config = root.join("tsconfig.json");
    std::fs::write(&config, "{}").unwrap();
    let package = root.join("package");
    std::fs::create_dir(&package).unwrap();
    let source = package.join("entry.ts");
    std::fs::write(&source, BODY).unwrap();
    let mut value = route(&package);
    value.source_paths.push(source.clone());
    let mut project = VirtualProject::new(&root).unwrap();
    let mut inputs = project.set_tsconfig_path_observed(Some(config));
    take(&mut inputs, project.package_resolution_settings_observed());
    take(&mut inputs, project.dependency_alias_map_observed());
    take(
        &mut inputs,
        project.insert_package_route_binding_observed(binding(&root.join("app.ts"), Some(value))),
    );
    assert!(inputs.qualified);
    (storage, project, inputs, source)
}

#[test]
fn actual_package_generation_keeps_whole_body_and_registry_without_rebuilding() {
    let (_storage, mut project, mut inputs, source) = fixture();
    let package = take(
        &mut inputs,
        project
            .register_path_with_package_generation_observed(&source, BODY)
            .unwrap(),
    );
    assert!(package);
    assert!(inputs.qualified);
    let generation =
        project.snapshot_regenerated_package_generation(FxHashSet::from_iter([source.clone()]));
    let before = registry(&project);
    project.discard_incremental_materialization();
    for _ in 0..2 {
        let proof = project
            .register_package_route_targets_observed_retaining_generation(&inputs, &generation)
            .unwrap();
        assert!(proof.qualified);
        assert!(project.registered_package_roots_are_current(&proof.value));
        assert_eq!(project.incremental_source_nodes_rebuilt, 0);
        assert_eq!(registry(&project), before);
        let file = project.find_by_original(&source).unwrap();
        assert_eq!(
            project.original_content_for_virtual(&file.virtual_path),
            Some(BODY)
        );
    }
}

#[test]
fn root_snapshot_never_substitutes_for_actual_package_body_completion() {
    for missing in ["completion", "body", "qualification", "registry"] {
        let (_storage, mut project, mut inputs, source) = fixture();
        let package = take(
            &mut inputs,
            project
                .register_path_with_package_generation_observed(&source, BODY)
                .unwrap(),
        );
        assert!(package);
        let completed = if missing == "completion" {
            FxHashSet::default()
        } else {
            FxHashSet::from_iter([source.clone()])
        };
        let generation = project.snapshot_regenerated_package_generation(completed);
        match missing {
            "body" => inputs
                .stamps
                .retain(|stamp| !stamp.has_registered_body(&source, BODY.as_bytes())),
            "qualification" => inputs.qualified = false,
            "registry" => {
                let root = project.project_root().to_path_buf();
                project.insert_package_route_binding(binding(&root.join("another.ts"), None));
            }
            _ => {}
        }
        project.discard_incremental_materialization();
        project
            .register_package_route_targets_observed_retaining_generation(&inputs, &generation)
            .unwrap();
        assert_eq!(project.incremental_source_nodes_rebuilt, 1, "{missing}");
        let file = project.find_by_original(&source).unwrap();
        assert_eq!(
            project.original_content_for_virtual(&file.virtual_path),
            Some(BODY)
        );
    }
}

#[test]
fn first_party_generation_cannot_skip_a_later_package_classification() {
    let (_storage, mut project, mut inputs, source) = fixture();
    let route = project.current_package_route_bindings();
    project.replace_package_route_bindings([]);
    let package = take(
        &mut inputs,
        project
            .register_path_with_package_generation_observed(&source, BODY)
            .unwrap(),
    );
    assert!(!package);
    project.replace_package_route_bindings(route);
    let generation = project.snapshot_regenerated_package_generation(FxHashSet::default());
    project.discard_incremental_materialization();
    project
        .register_package_route_targets_observed_retaining_generation(&inputs, &generation)
        .unwrap();
    assert_eq!(project.incremental_source_nodes_rebuilt, 1);
    assert!(project.is_package_route_path(&source));
}
