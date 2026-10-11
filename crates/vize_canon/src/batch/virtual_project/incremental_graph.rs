//! Incremental authored-source ownership.
//!
//! Roots, package-route targets, and resolved dependency edges are separate
//! owners.  Removing one importer therefore prunes only the now-unreachable
//! external/package closure instead of retaining stale files or rescanning the
//! whole project to rediscover reachability.

use std::path::{Path, PathBuf};

use vize_carton::FxHashSet;

use super::VirtualProject;
use super::package_source_index::empty;
use crate::package_route::stamp::{Consumed, FactRole};

mod observed;

impl VirtualProject {
    /// Source-derived ambient stubs must be recomputed when their graph leaves.
    pub(crate) fn source_options_match(&self, configured: &Self) -> bool {
        self.virtual_ts_options.auto_import_stubs == configured.virtual_ts_options.auto_import_stubs
    }

    pub(crate) fn source_patch_work(&self) -> (usize, usize) {
        (
            self.incremental_source_nodes_rebuilt,
            self.incremental_dependency_nodes_reconciled,
        )
    }

    /// Existing owners must resolve a deleted or changed dependency again.
    /// Keep this within the authoritative graph rather than another index.
    pub(crate) fn dependency_owners_for_sources(
        &self,
        sources: &FxHashSet<PathBuf>,
    ) -> Vec<PathBuf> {
        let mut owners = self
            .dependency_edges
            .iter()
            .filter(|(_, targets)| targets.iter().any(|target| sources.contains(target)))
            .map(|(owner, _)| owner.clone())
            .collect::<Vec<_>>();
        owners.sort();
        owners
    }

    pub(crate) fn reset_dependency_ownership(&mut self) {
        self.dependency_edges.clear();
        self.dependency_inbound.clear();
    }

    pub(crate) fn replace_dependency_edges(
        &mut self,
        importer: &Path,
        targets: FxHashSet<PathBuf>,
    ) -> Vec<PathBuf> {
        let mut facts = empty(false);
        self.replace_dependency_edges_with_consumption(importer, targets, false, &mut facts)
    }

    pub(super) fn replace_dependency_edges_with_consumption(
        &mut self,
        importer: &Path,
        targets: FxHashSet<PathBuf>,
        observe: bool,
        facts: &mut Consumed<()>,
    ) -> Vec<PathBuf> {
        self.incremental_dependency_nodes_reconciled += 1;
        let importer = Self::graph_owner_path(importer, FactRole::LocalImporter, observe, facts);
        let previous = self
            .dependency_edges
            .insert(importer, targets.clone())
            .unwrap_or_default();
        let mut released = Vec::new();
        for target in previous.difference(&targets) {
            let remove = self
                .dependency_inbound
                .get_mut(target)
                .is_some_and(|count| {
                    *count = count.saturating_sub(1);
                    *count == 0
                });
            if remove {
                self.dependency_inbound.remove(target);
                released.push(target.clone());
            }
        }
        for target in targets.difference(&previous) {
            *self.dependency_inbound.entry(target.clone()).or_default() += 1;
        }
        released
    }

    pub(crate) fn package_route_source_paths(&self) -> FxHashSet<PathBuf> {
        self.package_route_source_owners.keys().cloned().collect()
    }

    pub(crate) fn prune_unowned_sources(
        &mut self,
        candidates: impl IntoIterator<Item = PathBuf>,
    ) -> Vec<PathBuf> {
        let mut facts = empty(false);
        self.prune_unowned_sources_with_consumption(
            candidates,
            false,
            &mut facts,
            None,
            &mut Vec::new(),
            &mut Vec::new(),
        )
    }

    pub(super) fn prune_unowned_sources_with_consumption(
        &mut self,
        candidates: impl IntoIterator<Item = PathBuf>,
        observe: bool,
        facts: &mut Consumed<()>,
        protected: Option<&FxHashSet<PathBuf>>,
        blocked: &mut Vec<PathBuf>,
        pruned: &mut Vec<PathBuf>,
    ) -> Vec<PathBuf> {
        let mut queue = candidates.into_iter().collect::<Vec<_>>();
        let mut visited = FxHashSet::default();
        let mut removed_artifacts = Vec::new();
        while let Some(path) = queue.pop() {
            let path = Self::graph_owner_path(&path, FactRole::AuthoredSource, observe, facts);
            if protected.is_some_and(|sources| sources.contains(&path)) {
                facts.qualified = false;
                blocked.push(path);
                continue;
            }
            if !visited.insert(path.clone()) || self.source_is_owned(&path) {
                continue;
            }
            let released = self.replace_dependency_edges_with_consumption(
                &path,
                FxHashSet::default(),
                observe,
                facts,
            );
            self.dependency_edges.remove(&path);
            let was_registered = observe && self.find_by_original(&path).is_some();
            let removed = self.remove_registered_source_with_consumption(&path, observe, facts);
            if was_registered && self.find_by_original(&path).is_none() {
                pruned.push(path.clone());
            }
            if !removed.is_empty() {
                self.mark_incremental_config_file();
            }
            removed_artifacts.extend(removed);
            queue.extend(released);
        }
        removed_artifacts
    }

    pub(crate) fn remove_source_and_dependencies(&mut self, path: &Path) -> Vec<PathBuf> {
        let mut facts = empty(false);
        self.remove_source_and_dependencies_with_consumption(path, false, &mut facts)
    }

    pub(super) fn remove_source_and_dependencies_with_consumption(
        &mut self,
        path: &Path,
        observe: bool,
        facts: &mut Consumed<()>,
    ) -> Vec<PathBuf> {
        let path = Self::graph_owner_path(path, FactRole::AuthoredSource, observe, facts);
        let released = self.replace_dependency_edges_with_consumption(
            &path,
            FxHashSet::default(),
            observe,
            facts,
        );
        self.dependency_edges.remove(&path);
        let mut removed = self.remove_registered_source_with_consumption(&path, observe, facts);
        if !removed.is_empty() {
            self.mark_incremental_config_file();
        }
        removed.extend(self.prune_unowned_sources_with_consumption(
            released,
            observe,
            facts,
            None,
            &mut Vec::new(),
            &mut Vec::new(),
        ));
        removed
    }

    fn source_is_owned(&self, path: &Path) -> bool {
        self.declaration_roots
            .as_ref()
            .is_some_and(|roots| roots.contains(path))
            || self
                .package_route_source_owners
                .get(path)
                .is_some_and(|count| *count > 0)
            || self
                .dependency_inbound
                .get(path)
                .is_some_and(|count| *count > 0)
    }
}
