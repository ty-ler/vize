//! Retirement from current registration, after the caller's final rebind.

use super::VirtualProject;
use crate::PackageRouteBinding;
use crate::batch::virtual_project::package_source_index::{empty, finish, take};
use crate::package_route::stamp::Consumed;
use std::path::PathBuf;
use vize_carton::FxHashSet;

#[derive(Default)]
pub(crate) struct PackageBindingRetirement {
    pub(crate) retired_importers: Vec<PathBuf>,
    pub(crate) released_sources: Vec<PathBuf>,
    pub(crate) removed_bindings: Vec<PackageRouteBinding>,
    pub(crate) pruned_sources: Vec<PathBuf>,
    pub(crate) removed_artifacts: Vec<PathBuf>,
    pub(crate) protected_refusals: Vec<PathBuf>,
}

impl VirtualProject {
    /// Actual graph bindings only; this cannot reconstruct editor route output.
    pub(crate) fn current_package_route_bindings(&self) -> Vec<PackageRouteBinding> {
        let mut bindings = self.package_routes.values().cloned().collect::<Vec<_>>();
        bindings.sort_by_key(PackageRouteBinding::key);
        bindings
    }

    /// Call only AFTER original scoped rebind/registration is complete. Each
    /// round consumes actual removed keys and actual newly-unregistered sources.
    pub(crate) fn retire_unregistered_package_route_bindings_observed(
        &mut self,
        released: impl IntoIterator<Item = PathBuf>,
        protected_sources: &FxHashSet<PathBuf>,
    ) -> Consumed<super::PackageBindingRetirement> {
        let mut facts = empty(true);
        let mut outcome = PackageBindingRetirement::default();
        let mut pending = released.into_iter().collect::<Vec<_>>();
        loop {
            let mut keys = self
                .package_routes
                .values()
                .filter(|binding| self.find_by_original(&binding.importer_path).is_none())
                .map(PackageRouteBinding::key)
                .collect::<Vec<_>>();
            keys.sort();
            if keys.is_empty() && pending.is_empty() {
                break;
            }
            for key in keys {
                if let Some(binding) =
                    take(&mut facts, self.remove_package_route_binding_observed(&key))
                {
                    let importer = binding.importer_path.clone();
                    outcome.retired_importers.push(importer.clone());
                    if self.dependency_edges.contains_key(&importer) {
                        pending.extend(take(
                            &mut facts,
                            self.replace_dependency_edges_observed(&importer, FxHashSet::default()),
                        ));
                        self.dependency_edges.remove(&importer);
                    }
                    if let Some(route) = &binding.route {
                        pending.extend(route.all_source_paths().into_iter().cloned());
                    }
                    outcome.removed_bindings.push(binding);
                }
            }
            pending.sort();
            pending.dedup();
            outcome.released_sources.extend(pending.iter().cloned());
            if !pending.is_empty() {
                let (artifacts, blocked, newly_pruned) = take(
                    &mut facts,
                    self.prune_unowned_sources_preserving_observed(
                        std::mem::take(&mut pending),
                        protected_sources,
                    ),
                );
                outcome.removed_artifacts.extend(artifacts);
                outcome.protected_refusals.extend(blocked);
                outcome
                    .retired_importers
                    .extend(newly_pruned.iter().cloned());
                outcome.pruned_sources.extend(newly_pruned);
            }
            if !outcome.protected_refusals.is_empty() {
                break;
            }
        }
        // A refused candidate may still contain a newly-pruned owner's keys.
        // Report completion only after BOTH edge and binding ownership are gone.
        outcome.retired_importers.retain(|importer| {
            self.find_by_original(importer).is_none()
                && !self.dependency_edges.contains_key(importer)
                && !self
                    .package_routes
                    .values()
                    .any(|binding| binding.importer_path == *importer)
        });
        outcome.retired_importers.sort();
        outcome.retired_importers.dedup();
        outcome.released_sources.sort();
        outcome.released_sources.dedup();
        outcome.pruned_sources.sort();
        outcome.pruned_sources.dedup();
        outcome.removed_artifacts.sort();
        outcome.removed_artifacts.dedup();
        outcome.protected_refusals.sort();
        outcome.protected_refusals.dedup();
        outcome
            .removed_bindings
            .sort_by_key(PackageRouteBinding::key);
        finish(facts, outcome)
    }
}

#[cfg(test)]
mod tests;
