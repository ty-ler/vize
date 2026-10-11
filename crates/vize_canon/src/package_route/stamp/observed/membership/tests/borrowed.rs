//! Whole original outputs and refusal order remain the borrowed join oracle.

use super::super::{
    PackageAggregateError, package_aggregates_match_old, verify_package_aggregates_match_old,
};
use super::{body, input, owner, owners, path, route, write};
use crate::package_route::stamp::{FactRole, InputStamp};
use crate::{PackageRoute, PackageRouteSource};
use std::path::PathBuf;
use vize_carton::{FxHashMap, FxHashSet, String};

type Routes = FxHashMap<(PathBuf, String), PackageRoute>;

fn verify(
    stamps: &[InputStamp],
    qualified: bool,
    registry: &FxHashSet<PathBuf>,
    original: (&Routes, &[PathBuf]),
    expected: Result<(), PackageAggregateError>,
) {
    let owned = package_aggregates_match_old(stamps, qualified, registry, original.0, original.1);
    if let Ok(outputs) = &owned {
        assert_eq!(&outputs.routes, original.0);
        assert_eq!(outputs.inputs.as_slice(), original.1);
    }
    assert_eq!(owned.map(|_| ()), expected);
    assert_eq!(
        verify_package_aggregates_match_old(stamps, qualified, registry, original.0, original.1,),
        expected,
    );
}

#[test]
fn borrowed_join_retains_every_route_field_and_original_refusal_priority() {
    let importer = path("borrowed-entry.ts");
    let first = path("a-input.vue");
    let second = path("z-input.vue");
    let registry = owners(std::slice::from_ref(&importer));
    let mut complete = route("child.vue");
    complete.source_targets.push(PackageRouteSource {
        target_path: path("dist/child.js"),
        source_path: path("child.vue"),
        native_probe_path: path("dist/child.d.ts"),
    });
    complete.nested_routes.push(route("nested.vue"));
    let key = (importer.parent().unwrap().to_path_buf(), "#child".into());
    let original = FxHashMap::from_iter([(key.clone(), complete.clone())]);
    let inputs = vec![first.clone(), second.clone()];
    let stamps = vec![
        body(&importer),
        input(&importer, &second),
        write(&importer, complete.clone()),
        input(&importer, &first),
        input(&importer, &second),
        write(&importer, complete.clone()),
    ];
    verify(&stamps, true, &registry, (&original, &inputs), Ok(()));
    let mutations: [fn(&mut PackageRoute); 12] = [
        |route| route.source_paths.push(path("extra.vue")),
        |route| route.dependency_paths.clear(),
        |route| route.source_targets[0].target_path = path("different.js"),
        |route| route.source_targets[0].source_path = path("different.vue"),
        |route| route.source_targets[0].native_probe_path = path("different.d.ts"),
        |route| route.package_root = path("different-package"),
        |route| route.package_link_root = path("different-link"),
        |route| route.manifest_path = path("different/package.json"),
        |route| route.package_name = None,
        |route| route.workspace_source = false,
        |route| route.nested_routes[0].dependency_paths.clear(),
        |route| route.nested_routes.clear(),
    ];
    for mutate in mutations {
        let mut altered = complete.clone();
        mutate(&mut altered);
        let routes = FxHashMap::from_iter([(key.clone(), altered)]);
        verify(
            &stamps,
            true,
            &registry,
            (&routes, &inputs),
            Err(PackageAggregateError::OldRoutes),
        );
        verify(
            &stamps,
            true,
            &registry,
            (&routes, &[]),
            Err(PackageAggregateError::OldInputs),
        );
    }
    let reversed = vec![second, first];
    verify(
        &stamps,
        true,
        &registry,
        (&original, &reversed),
        Err(PackageAggregateError::OldInputs),
    );
    verify(
        &stamps,
        false,
        &registry,
        (&original, &[]),
        Err(PackageAggregateError::Unqualified),
    );
    verify(
        &stamps,
        true,
        &FxHashSet::default(),
        (&original, &[]),
        Err(PackageAggregateError::NoSources),
    );
    verify(
        &stamps[1..],
        true,
        &registry,
        (&original, &[]),
        Err(PackageAggregateError::MissingSourceBody(importer.clone())),
    );
    let wrong = InputStamp::observed_package_input_member(path("input.vue"))
        .with_owner(owner(&importer, FactRole::Configuration));
    verify(
        &[body(&importer), wrong],
        true,
        &registry,
        (&original, &[]),
        Err(PackageAggregateError::WrongOwnerRole(importer.clone())),
    );
    let mut conflicting = stamps;
    conflicting.push(write(&importer, route("conflicting.vue")));
    verify(
        &conflicting,
        true,
        &registry,
        (&original, &[]),
        Err(PackageAggregateError::RouteConflict(key.0, key.1)),
    );
}
