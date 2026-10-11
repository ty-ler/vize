//! Full borrowed route identity and order match the original recursive join.

use super::PackageRoute;
use std::path::PathBuf;

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
