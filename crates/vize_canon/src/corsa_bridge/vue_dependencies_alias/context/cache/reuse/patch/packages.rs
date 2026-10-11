//! Actual scoped walks and package-root registration through existing owners.
use crate::batch::virtual_project::VirtualProject;
use crate::corsa_bridge::vue_dependencies_alias::context::{
    build::consumption::NativeFacts,
    routes::{PackageCallback, RouteDiscovery, package_specifiers_from_frontier},
};
use crate::package_route::stamp::FactRole;
use std::path::{Path, PathBuf};
use vize_carton::{FxHashMap, FxHashSet};

pub(super) fn reconcile(
    mirror: &mut VirtualProject,
    frontier: &[PathBuf],
    overlays: &FxHashMap<PathBuf, &str>,
    protected: &FxHashSet<PathBuf>,
    resolver: &mut crate::PackageRouteResolver,
    registration: (
        &mut NativeFacts,
        &crate::batch::virtual_project::package_source_index::RegisteredPackageGeneration,
    ),
) -> Option<Vec<PathBuf>> {
    let (facts, generation) = registration;
    let root = mirror.project_root().to_path_buf();
    let settings = facts.factory(
        mirror.package_resolution_settings_observed(),
        FactRole::Configuration,
        &root,
    );
    let aliases = facts.factory(
        mirror.dependency_alias_map_observed(),
        FactRole::Configuration,
        &root,
    );
    let mut bindings = mirror.current_package_route_bindings();
    let mut routes = FxHashMap::default();
    let mut inputs = Vec::new();
    let mut reachability = FxHashMap::default();
    let mut completed = Vec::new();
    let mut sources = frontier.to_vec();
    let mut scanned = mirror
        .registered_original_paths_sorted()
        .into_iter()
        .collect::<FxHashSet<_>>();
    for path in frontier {
        scanned.remove(path);
    }
    let mut registration = facts.with_witness(|inputs| {
        mirror
            .register_package_route_targets_observed_retaining_generation(inputs, generation)
            .ok()
    })?;
    loop {
        let specifiers = package_specifiers_from_frontier(mirror, &mut scanned);
        let phase =
            crate::corsa_bridge::preparation_trace::Phase::start("alias_reachable_dependencies", 1);
        let mut discovered = Vec::new();
        {
            let mut discovery = RouteDiscovery::new_observed(
                &settings,
                resolver,
                &mut routes,
                &mut reachability,
                &mut discovered,
                &mut inputs,
                &aliases,
            );
            let mut callback = |importer: &Path, specifier: &str, mode| {
                PackageCallback::into_shadow_result(
                    discovery.resolve_observed(importer, specifier, mode),
                )
            };
            let walk = mirror
                .register_reachable_dependencies_from_with_package_resolver_observed(
                    &sources,
                    overlays,
                    &specifiers,
                    &mut callback,
                    Some(&registration),
                )
                .ok()?;
            let done = facts.record_owned(walk);
            bindings.retain(|binding| !done.contains(&binding.importer_path));
            completed.extend(done);
        }
        phase.finish();
        facts.record_owned(registration);
        bindings.extend(discovered);
        bindings.sort_by_key(crate::PackageRouteBinding::key);
        bindings.dedup_by(|left, right| left == right);
        let previous_targets = mirror.package_route_source_paths();
        facts.record(
            mirror.set_package_routes_observed(bindings.clone()),
            FactRole::Configuration,
            &root,
        );
        let targets = mirror.package_route_source_paths();
        let released = previous_targets
            .difference(&targets)
            .cloned()
            .collect::<Vec<_>>();
        let retirement =
            mirror.retire_unregistered_package_route_bindings_observed(released, protected);
        if !retirement.qualified {
            return None;
        }
        let retirement = facts.record_owned(retirement);
        completed.extend(retirement.retired_importers);
        bindings = mirror.current_package_route_bindings();
        // Newly emitted bindings must register their actual target roots
        // before emptiness can prove closure. Carry that very token forward;
        // do not repeat the registration at the next wave's entry.
        registration = facts.with_witness(|inputs| {
            mirror
                .register_package_route_targets_observed_retaining_generation(inputs, generation)
                .ok()
        })?;
        // Newly reached modules and package entry sources use the same full
        // overlay scope on the next actual scoped walk. Known retained targets
        // keep their current edges, rather than a second parallel graph.
        sources = mirror
            .registered_original_paths_sorted()
            .into_iter()
            .filter(|path| !scanned.contains(path))
            .collect();
        if sources.is_empty() {
            facts.record_owned(registration);
            break;
        }
    }
    completed.sort();
    completed.dedup();
    Some(completed)
}
