//! Unexecuted source laws for contribution coverage, not graph/native validation.

use super::{
    PackageAggregateError, PackageContributionRef, package_aggregates,
    package_aggregates_match_old, record_editor_route_write, record_package_input_members,
};
use crate::PackageRoute;
use crate::package_route::stamp::{FactOwner, FactRole, InputStamp};
use std::{
    collections::hash_map::DefaultHasher,
    hash::{Hash, Hasher},
    path::{Path, PathBuf},
    sync::Arc,
};
use vize_carton::{FxHashMap, FxHashSet};

fn path(name: &str) -> PathBuf {
    std::env::temp_dir()
        .join("vize-membership-source-law")
        .join(name)
}
fn route(name: &str) -> PackageRoute {
    PackageRoute {
        source_paths: vec![path(name)],
        dependency_paths: vec![path("dependency.d.ts")],
        source_targets: Vec::new(),
        package_root: path("package"),
        package_link_root: path("linked-package"),
        manifest_path: path("package/package.json"),
        package_name: Some("authored-package".into()),
        workspace_source: true,
        nested_routes: Vec::new(),
    }
}
fn owner(path: &Path, role: FactRole) -> Arc<FactOwner> {
    Arc::new(FactOwner {
        path: path.to_path_buf(),
        role,
    })
}
fn body(path: &Path) -> InputStamp {
    InputStamp::observed_source(path.to_path_buf(), b"authored body")
        .with_owner(owner(path, FactRole::AuthoredSource))
}
fn owners(paths: &[PathBuf]) -> FxHashSet<PathBuf> {
    paths.iter().cloned().collect()
}
fn hash(stamp: &InputStamp) -> u64 {
    let mut hasher = DefaultHasher::new();
    stamp.hash(&mut hasher);
    hasher.finish()
}
fn input(importer: &Path, target: &Path) -> InputStamp {
    InputStamp::observed_package_input_member(target.to_path_buf())
        .with_owner(owner(importer, FactRole::LocalImporter))
}
fn write(importer: &Path, value: PackageRoute) -> InputStamp {
    InputStamp::observed_editor_route_write(
        importer.parent().unwrap().to_path_buf(),
        "#child".into(),
        Arc::new(value),
    )
    .with_owner(owner(importer, FactRole::LocalImporter))
}

#[test]
fn markers_are_pure_output_membership_without_filesystem_or_deletion_authority() {
    let importer = path("entry.ts");
    let invalid = path("never-observed\0.vue");
    let marker = input(&importer, &invalid);
    assert_eq!(
        marker.package_contribution(),
        Some(PackageContributionRef::Input(&invalid))
    );
    assert_eq!(marker.current_consumed_fact(), Some(marker.clone()));
    assert!(marker.is_current());
    assert!(marker.consumed_only);
    assert!(marker.modified.is_none() && marker.len.is_none() && marker.kind.is_none());
    assert!(marker.content_digest.is_none() && marker.symlink_target.is_none());
    assert!(!marker.source_content);
    assert!(marker.retained_consumed_source().is_none());
    let current = InputStamp::observed_is_file(invalid.clone(), false);
    assert!(!marker.changed_only_by_deleted_target(&current, &invalid));
    let stamps = vec![marker];
    assert_eq!(
        package_aggregates(&stamps, true, &owners(std::slice::from_ref(&importer))),
        Err(PackageAggregateError::MissingSourceBody(importer))
    );
}

#[test]
fn whole_route_equality_resolves_coarse_hash_collisions_without_pointer_authority() {
    let importer = path("entry.ts");
    let first = write(&importer, route("first.vue"));
    let equal = write(&importer, route("first.vue"));
    let different = write(&importer, route("second.vue"));
    assert_eq!(first, equal);
    assert_ne!(first, different);
    assert_eq!(hash(&first), hash(&equal));
    assert_eq!(hash(&first), hash(&different));
    let mut stamps = vec![body(&importer), first, equal];
    assert_eq!(
        package_aggregates(&stamps, true, &owners(std::slice::from_ref(&importer)))
            .unwrap()
            .routes
            .len(),
        1
    );
    stamps.push(different);
    assert_eq!(
        package_aggregates(&stamps, true, &owners(std::slice::from_ref(&importer))),
        Err(PackageAggregateError::RouteConflict(
            importer.parent().unwrap().into(),
            "#child".into()
        ))
    );
}

#[test]
fn missing_wrong_or_noncurrent_owners_and_incomplete_body_coverage_refuse() {
    let importer = path("entry.ts");
    let target = path("target.vue");
    let registry = owners(std::slice::from_ref(&importer));
    let valid_body = body(&importer);
    let marker = InputStamp::observed_package_input_member(target.clone());
    assert_eq!(
        package_aggregates(&[valid_body.clone(), marker.clone()], true, &registry),
        Err(PackageAggregateError::MissingOwner(target.clone()))
    );
    let wrong = marker
        .clone()
        .with_owner(owner(&importer, FactRole::Configuration));
    assert_eq!(
        package_aggregates(&[valid_body.clone(), wrong], true, &registry),
        Err(PackageAggregateError::WrongOwnerRole(importer.clone()))
    );
    let other = path("unregistered.ts");
    let unknown = marker.with_owner(owner(&other, FactRole::LocalImporter));
    assert_eq!(
        package_aggregates(&[valid_body.clone(), unknown], true, &registry),
        Err(PackageAggregateError::UnknownOwner(other))
    );
    assert_eq!(
        package_aggregates(&[valid_body.clone()], false, &registry),
        Err(PackageAggregateError::Unqualified)
    );
    assert_eq!(
        package_aggregates(&[], true, &FxHashSet::default()),
        Err(PackageAggregateError::NoSources)
    );
    let missing = path("not-covered.ts");
    assert_eq!(
        package_aggregates(&[valid_body], true, &owners(&[importer, missing.clone()])),
        Err(PackageAggregateError::MissingSourceBody(missing))
    );
}

#[test]
fn relative_paths_and_route_directory_mismatch_are_unknown_cold() {
    let importer = path("entry.ts");
    let relative = PathBuf::from("relative.ts");
    assert_eq!(
        package_aggregates(
            &[body(&relative)],
            true,
            &owners(std::slice::from_ref(&relative))
        ),
        Err(PackageAggregateError::NonAbsolute(relative))
    );
    let mismatched = InputStamp::observed_editor_route_write(
        path("other"),
        "#child".into(),
        Arc::new(route("child.vue")),
    )
    .with_owner(owner(&importer, FactRole::LocalImporter));
    assert_eq!(
        package_aggregates(
            &[body(&importer), mismatched],
            true,
            &owners(std::slice::from_ref(&importer))
        ),
        Err(PackageAggregateError::DirectoryMismatch(importer))
    );
}

#[test]
fn old_join_requires_entire_input_union_and_entire_editor_written_route_value() {
    let importer = path("entry.ts");
    let target = path("target.vue");
    let value = route("child.vue");
    let registry = owners(std::slice::from_ref(&importer));
    let stamps = vec![
        body(&importer),
        input(&importer, &target),
        write(&importer, value.clone()),
    ];
    let original_routes =
        FxHashMap::from_iter([((importer.parent().unwrap().into(), "#child".into()), value)]);
    let original_inputs = vec![target];
    let joined =
        package_aggregates_match_old(&stamps, true, &registry, &original_routes, &original_inputs)
            .unwrap();
    assert_eq!(joined.routes, original_routes);
    assert_eq!(joined.inputs, original_inputs);
    assert_eq!(
        package_aggregates_match_old(&stamps, true, &registry, &original_routes, &[]),
        Err(PackageAggregateError::OldInputs)
    );
    let mut altered = original_routes.clone();
    altered
        .values_mut()
        .next()
        .unwrap()
        .nested_routes
        .push(route("nested.vue"));
    assert_eq!(
        package_aggregates_match_old(&stamps, true, &registry, &altered, &original_inputs),
        Err(PackageAggregateError::OldRoutes)
    );
}

#[test]
fn prepatch_deleted_owner_is_retained_until_actual_current_coverage_replaces_it() {
    let a = path("a.ts");
    let b = path("b.ts");
    let target = path("shared.vue");
    let value = route("shared.vue");
    let a_facts = vec![body(&a), input(&a, &target), write(&a, value.clone())];
    let b_facts = vec![body(&b), input(&b, &target), write(&b, value)];
    let all = a_facts.iter().chain(&b_facts).cloned().collect::<Vec<_>>();
    let old_owners = owners(&[a.clone(), b.clone()]);
    let old = package_aggregates(&all, true, &old_owners).unwrap();
    assert_eq!(old.inputs, vec![target.clone()]);
    assert_eq!(old.routes.len(), 1);
    package_aggregates_match_old(&all, true, &old_owners, &old.routes, &old.inputs).unwrap();
    let current = owners(std::slice::from_ref(&a));
    assert_eq!(
        package_aggregates(&all, true, &current),
        Err(PackageAggregateError::UnknownOwner(b))
    );
    let completed = package_aggregates(&a_facts, true, &current).unwrap();
    assert_eq!(completed, old);
    // Empty current outputs require removal of the actual owner's old marker set.
    let no_outputs = package_aggregates(&[body(&a)], true, &current).unwrap();
    assert!(no_outputs.routes.is_empty() && no_outputs.inputs.is_empty());
}

#[test]
fn record_helpers_use_exact_emitted_slices_and_same_whole_editor_write() {
    let importer = path("entry.ts");
    let target = path("decl.d.ts");
    let value = route("child.vue");
    let mut stamps = vec![body(&importer)];
    record_package_input_members(&mut stamps, &importer, &[target.clone(), target.clone()]);
    record_editor_route_write(
        &mut stamps,
        &importer,
        importer.parent().unwrap().into(),
        "#child".into(),
        &value,
    );
    assert_eq!(stamps.len(), 4);
    let route_marker = stamps.last().unwrap();
    assert_eq!(
        route_marker.package_contribution(),
        Some(PackageContributionRef::Route {
            directory: importer.parent().unwrap(),
            specifier: &"#child".into(),
            route: &value,
        })
    );
    assert!(stamps[1..].iter().all(|stamp| {
        stamp
            .owner()
            .is_some_and(|owner| owner.role == FactRole::LocalImporter && owner.path == importer)
    }));
    let result =
        package_aggregates(&stamps, true, &owners(std::slice::from_ref(&importer))).unwrap();
    assert_eq!(result.inputs, vec![target]);
    assert_eq!(result.routes.len(), 1);
}
