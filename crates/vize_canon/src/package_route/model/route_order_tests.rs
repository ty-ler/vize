//! Full borrowed route identity and order match the original recursive join.

use super::{PackageRoute, PackageRouteSource};
use std::path::{Path, PathBuf};

fn route(children: Vec<PackageRoute>) -> PackageRoute {
    // Equal-valued siblings must still have distinct positions and pointees.
    PackageRoute {
        source_paths: vec![PathBuf::from("same/source.ts")],
        dependency_paths: vec![PathBuf::from("same/dependency.ts")],
        source_targets: Vec::new(),
        package_root: PathBuf::from("same"),
        package_link_root: PathBuf::from("same/link"),
        manifest_path: PathBuf::from("same/package.json"),
        package_name: Some("same-package".into()),
        workspace_source: true,
        nested_routes: children,
    }
}

fn original_all_routes(route: &PackageRoute) -> Vec<&PackageRoute> {
    let mut routes = vec![route];
    for route in &route.nested_routes {
        routes.extend(original_all_routes(route));
    }
    routes
}

#[test]
fn one_route_collector_preserves_every_original_ordered_borrowed_pointee() {
    let mut deep = route(Vec::new());
    for _ in 0..128 {
        deep = route(vec![deep]);
    }
    let wide = route((0..64).map(|_| route(Vec::new())).collect());
    let mixed = route(vec![deep.clone(), wide.clone(), deep, wide]);
    for root in [route(Vec::new()), mixed] {
        let expected = original_all_routes(&root);
        let actual = root.all_routes();
        assert_eq!(actual, expected);
        assert_eq!(actual.len(), expected.len());
        for (left, right) in actual.into_iter().zip(expected) {
            assert!(std::ptr::eq(left, right));
        }
    }
}

fn assert_original_membership(root: &PackageRoute, paths: &[&Path]) {
    let before = root.clone();
    for path in paths {
        assert_eq!(
            root.contains_source_path(path),
            root.all_source_paths()
                .into_iter()
                .any(|source| source.as_path() == *path),
            "{path:?}"
        );
    }
    assert_eq!(root, &before);
}

#[test]
fn package_membership_preserves_the_whole_current_recursive_getter() {
    let mut nested = route(Vec::new());
    nested.source_paths.push(PathBuf::from("nested/source.vue"));
    nested
        .dependency_paths
        .push(PathBuf::from("nested/dependency.d.ts"));
    let mut deep = nested.clone();
    for _ in 0..128 {
        deep = route(vec![deep]);
    }
    let mut root = route(vec![nested.clone(), nested, deep]);
    root.source_paths.extend([
        PathBuf::from("same/source.ts"),
        PathBuf::from("same/./source.ts"),
        PathBuf::from("case/Source.ts"),
    ]);
    root.dependency_paths.push(PathBuf::from("same/source.ts"));
    root.source_targets.push(PackageRouteSource {
        target_path: PathBuf::from("target-only.ts"),
        source_path: PathBuf::from("candidate-only.ts"),
        native_probe_path: PathBuf::from("probe-only.ts"),
    });
    let paths = [
        "same/source.ts",
        "same//source.ts",
        "same/./source.ts",
        "same/a/../source.ts",
        "same/dependency.ts",
        "nested/source.vue",
        "nested/dependency.d.ts",
        "missing.ts",
        "case/Source.ts",
        "case/source.ts",
        "/same/source.ts",
        "same/package.json",
        "same/link",
        "target-only.ts",
        "candidate-only.ts",
        "probe-only.ts",
        "",
    ]
    .map(Path::new);
    assert_original_membership(&root, &paths);
    let mut empty = route(Vec::new());
    empty.source_paths.clear();
    empty.dependency_paths.clear();
    assert_original_membership(&empty, &paths);
    root.source_paths.clear();
    root.dependency_paths.clear();
    root.nested_routes.clear();
    assert_original_membership(&root, &paths);
    assert!(!root.contains_source_path(Path::new("nested/source.vue")));
    root.dependency_paths
        .push(PathBuf::from("nested/source.vue"));
    assert_original_membership(&root, &paths);
    assert!(root.contains_source_path(Path::new("nested/source.vue")));
}
