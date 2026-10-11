//! Draft source laws only: not compiled or executed.

use super::super::{
    FactRole, FxHashMap, FxHashSet, PackageRouteKey, PackageSources, Path, PathBuf, VirtualProject,
    take,
};
use crate::{PackageResolutionContext, PackageRoute, PackageRouteBinding};

fn route(root: &Path) -> PackageRoute {
    PackageRoute {
        source_paths: Vec::new(),
        dependency_paths: Vec::new(),
        source_targets: Vec::new(),
        package_root: root.to_path_buf(),
        package_link_root: root.to_path_buf(),
        manifest_path: root.join("package.json"),
        package_name: Some("owner-law".into()),
        workspace_source: true,
        nested_routes: Vec::new(),
    }
}

fn binding(importer: &Path, route: Option<PackageRoute>) -> PackageRouteBinding {
    PackageRouteBinding {
        importer_path: importer.to_path_buf(),
        specifier: "owner-law".into(),
        occurrence_mode: crate::PackageResolutionMode::Import,
        context: PackageResolutionContext::default(),
        route,
        invalidation_paths: vec![importer.to_path_buf()],
    }
}

#[derive(Debug, Eq, PartialEq)]
struct Registry {
    bindings: FxHashMap<PackageRouteKey, PackageRouteBinding>,
    reverse: FxHashMap<PathBuf, FxHashSet<PackageRouteKey>>,
    importers: FxHashMap<PathBuf, FxHashSet<PackageRouteKey>>,
    owners: FxHashMap<PathBuf, usize>,
    manifests: FxHashMap<PathBuf, FxHashSet<PackageRouteKey>>,
    roots: FxHashMap<PathBuf, FxHashSet<PackageRouteKey>>,
    sources: FxHashMap<PathBuf, PackageSources>,
    dirty: FxHashSet<PackageRouteKey>,
}

fn registry(p: &VirtualProject) -> Registry {
    Registry {
        bindings: p.package_routes.clone(),
        reverse: p.package_route_reverse.clone(),
        importers: p.package_route_importers.clone(),
        owners: p.package_route_source_owners.clone(),
        manifests: p.package_route_manifests.clone(),
        roots: p.package_route_roots.clone(),
        sources: p.package_source_index.clone(),
        dirty: p.package_shadow_dirty_keys.clone(),
    }
}

#[test]
fn duplicate_binding_and_negative_replacement_keep_whole_registry() {
    let storage = tempfile::tempdir().unwrap();
    let root = storage.path().canonicalize().unwrap();
    let importer = root.join("app.ts");
    let one = binding(&importer, Some(route(&root.join("one"))));
    let two = binding(&importer, Some(route(&root.join("two"))));
    let negative = binding(&importer, None);
    let mut legacy = VirtualProject::new(&root).unwrap();
    let mut observed = VirtualProject::new(&root).unwrap();
    legacy.replace_package_route_bindings([one.clone(), two.clone(), negative.clone()]);
    observed.replace_package_route_bindings_observed([one, two, negative]);
    assert_eq!(registry(&legacy), registry(&observed));
    assert_eq!(observed.package_routes.len(), 1);
    assert!(observed.package_route_roots.is_empty());
    assert!(observed.package_route_source_owners.is_empty());
}

#[test]
fn setter_observed_keeps_actual_context_and_whole_registry() {
    let storage = tempfile::tempdir().unwrap();
    let root = storage.path().canonicalize().unwrap();
    std::fs::write(
        root.join("tsconfig.json"),
        "{\"compilerOptions\":{\"moduleResolution\":\"nodenext\"}}",
    )
    .unwrap();
    let value = binding(&root.join("app.ts"), Some(route(&root.join("package"))));
    let mut legacy = VirtualProject::new(&root).unwrap();
    let mut observed = VirtualProject::new(&root).unwrap();
    legacy.set_package_routes([value.clone()]);
    let packet = observed.set_package_routes_observed([value]);
    assert_eq!(registry(&legacy), registry(&observed));
    assert!(!packet.stamps.is_empty());
}

#[test]
fn registering_new_source_keeps_exact_root_proof() {
    let storage = tempfile::tempdir().unwrap();
    let root = storage.path().canonicalize().unwrap();
    let package = root.join("package");
    std::fs::create_dir(&package).unwrap();
    let source = package.join("new.ts");
    std::fs::write(&source, "export const value = 1;\n").unwrap();
    let mut project = VirtualProject::new(&root).unwrap();
    project.insert_package_route_binding(binding(&root.join("app.ts"), Some(route(&package))));
    let proof = project.register_package_route_targets_observed().unwrap();
    assert!(project.registered_package_roots_are_current(&proof.value));
    assert!(proof.qualified);
    let before = project.package_source_index.clone();
    project.register_path(&source).unwrap();
    assert_ne!(project.package_source_index, before);
    assert!(project.registered_package_roots_are_current(&proof.value));
    assert_eq!(project.package_roots_for_importer(&source, true), [package]);
}

#[test]
fn root_and_binding_mutations_refuse_the_old_proof() {
    let storage = tempfile::tempdir().unwrap();
    let root = storage.path().canonicalize().unwrap();
    let mut project = VirtualProject::new(&root).unwrap();
    let value = binding(&root.join("app.ts"), Some(route(&root.join("package"))));
    project.insert_package_route_binding(value.clone());
    let proof = project.register_package_route_targets_observed().unwrap();
    project.package_route_roots.clear();
    assert!(!project.registered_package_roots_are_current(&proof.value));
    project.insert_package_route_binding(value.clone());
    let proof = project.register_package_route_targets_observed().unwrap();
    project.remove_package_route_binding(&value.key());
    assert!(!project.registered_package_roots_are_current(&proof.value));
}

#[test]
fn source_index_insertion_and_removal_match_whole_legacy_values() {
    let storage = tempfile::tempdir().unwrap();
    let root = storage.path().canonicalize().unwrap();
    let source = root.join("package/source.ts");
    let virtual_path = root.join("virtual.ts");
    let value = binding(&root.join("app.ts"), Some(route(&root.join("package"))));
    let mut legacy = VirtualProject::new(&root).unwrap();
    let mut observed = VirtualProject::new(&root).unwrap();
    legacy.insert_package_route_binding(value.clone());
    observed.insert_package_route_binding_observed(value.clone());
    legacy.index_package_source(&source, &virtual_path);
    let packet = observed.index_package_source_observed(&source, &virtual_path);
    assert_eq!(registry(&legacy), registry(&observed));
    assert!(packet.stamps.iter().all(|s| {
        s.owner()
            .is_some_and(|o| o.path == source && o.role == FactRole::AuthoredSource)
    }));
    legacy.remove_package_source_from_index(&source);
    observed.remove_package_source_from_index_observed(&source);
    assert_eq!(registry(&legacy), registry(&observed));
    assert_eq!(
        legacy.remove_package_route_binding(&value.key()),
        observed
            .remove_package_route_binding_observed(&value.key())
            .value
    );
    assert_eq!(registry(&legacy), registry(&observed));
    // The same complete original operation preserves an absent binding result.
    assert_eq!(legacy.remove_package_route_binding(&value.key()), None);
    let absent = observed.remove_package_route_binding_observed(&value.key());
    assert_eq!(absent.value, None);
    assert_eq!(registry(&legacy), registry(&observed));
}

#[cfg(unix)]
#[test]
fn retarget_before_registration_records_the_selected_index_root() {
    let storage = tempfile::tempdir().unwrap();
    let root = storage.path().canonicalize().unwrap();
    let a = root.join("a");
    let b = root.join("b");
    let link = root.join("link");
    std::fs::create_dir(&a).unwrap();
    std::fs::create_dir(&b).unwrap();
    std::os::unix::fs::symlink(&a, &link).unwrap();
    let pending = binding(&root.join("app.ts"), Some(route(&link)));
    std::fs::remove_file(&link).unwrap();
    std::os::unix::fs::symlink(&b, &link).unwrap();
    let mut project = VirtualProject::new(&root).unwrap();
    let packet = project.insert_package_route_binding_observed(pending);
    assert!(project.package_route_roots.contains_key(&b));
    assert!(!project.package_route_roots.contains_key(&a));
    assert!(!project.raw_package_roots_are_indexed().0);
    assert!(packet.stamps.iter().all(|s| s.is_current()));
    std::fs::remove_file(&link).unwrap();
    std::os::unix::fs::symlink(&a, &link).unwrap();
    assert!(packet.stamps.iter().any(|s| !s.is_current()));
}

#[test]
fn empty_registration_returns_exact_root_owner_without_body_authority() {
    let storage = tempfile::tempdir().unwrap();
    let root = storage.path().canonicalize().unwrap();
    let mut project = VirtualProject::new(&root).unwrap();
    project.insert_package_route_binding(binding(&root.join("app.ts"), None));
    let before = registry(&project);
    let proof = project.register_package_route_targets_observed().unwrap();
    assert_eq!(registry(&project), before);
    assert!(project.registered_package_roots_are_current(&proof.value));
    assert!(proof.qualified);
}

#[cfg(unix)]
#[test]
fn canonical_source_outside_the_root_keeps_the_original_empty_index_result() {
    let storage = tempfile::tempdir().unwrap();
    let root = storage.path().canonicalize().unwrap();
    let package = root.join("package");
    std::fs::create_dir(&package).unwrap();
    let outside = root.join("outside.ts");
    let logical = package.join("source.ts");
    std::fs::write(&outside, "export {};\n").unwrap();
    std::os::unix::fs::symlink(&outside, &logical).unwrap();
    let value = binding(&root.join("app.ts"), Some(route(&package)));
    let mut legacy = VirtualProject::new(&root).unwrap();
    let mut observed = VirtualProject::new(&root).unwrap();
    legacy.insert_package_route_binding(value.clone());
    observed.insert_package_route_binding_observed(value);
    legacy.index_package_source(&logical, &root.join("virtual.ts"));
    let packet = observed.index_package_source_observed(&logical, &root.join("virtual.ts"));
    assert_eq!(registry(&legacy), registry(&observed));
    assert!(
        observed
            .package_source_index
            .values()
            .all(|sources| sources.is_empty())
    );
    assert!(packet.stamps.iter().all(|stamp| stamp.is_current()));
}

#[test]
fn actual_registration_read_is_retained_and_missing_input_witness_stays_cold() {
    let storage = tempfile::tempdir().unwrap();
    let root = storage.path().canonicalize().unwrap();
    let package = root.join("package");
    std::fs::create_dir(&package).unwrap();
    let source = package.join("entry.ts");
    let body = "export const value = 1;\n";
    std::fs::write(&source, body).unwrap();
    let mut value = route(&package);
    value.source_paths.push(source.clone());
    let mut project = VirtualProject::new(&root).unwrap();
    project.insert_package_route_binding(binding(&root.join("app.ts"), Some(value)));
    let proof = project.register_package_route_targets_observed().unwrap();
    assert!(!proof.qualified);
    assert!(project.registered_package_roots_are_current(&proof.value));
    let virtual_path = project.original_index.get(&source).unwrap();
    assert_eq!(
        project
            .original_contents
            .get(virtual_path)
            .unwrap()
            .as_str(),
        body
    );
    assert!(proof.stamps.iter().any(|stamp| {
        stamp
            .owner()
            .is_some_and(|owner| owner.path == source && owner.role == FactRole::AuthoredSource)
    }));
}

#[test]
fn ordinary_registration_consumes_actual_policy_settings_and_alias_witness() {
    let storage = tempfile::tempdir().unwrap();
    let root = storage.path().canonicalize().unwrap();
    let config = root.join("tsconfig.json");
    std::fs::write(
        &config,
        "{\"compilerOptions\":{\"moduleResolution\":\"bundler\"}}",
    )
    .unwrap();
    let package = root.join("package");
    std::fs::create_dir(&package).unwrap();
    let source = package.join("entry.ts");
    std::fs::write(&source, "export const value = 1;\n").unwrap();
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
    let proof = project
        .register_package_route_targets_observed_with_inputs(&inputs)
        .unwrap();
    assert!(proof.qualified);
    assert!(project.registered_package_roots_are_current(&proof.value));
    assert_eq!(project.package_roots_for_importer(&source, true), [package]);
    // This is the bounded registry/scanner packet, not native host/codegen completion.
}
