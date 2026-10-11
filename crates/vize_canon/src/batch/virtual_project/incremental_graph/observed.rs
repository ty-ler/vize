//! Temporary facts from the same original graph mutation operations.

use super::{FxHashSet, Path, PathBuf, VirtualProject};
use crate::batch::virtual_project::package_source_index::{empty, finish};
use crate::package_route::stamp::Shared;
use crate::package_route::stamp::{Consumed, FactOwner, FactRole};

impl VirtualProject {
    pub(super) fn graph_owner_path(
        path: &Path,
        role: FactRole,
        observe: bool,
        facts: &mut Consumed<()>,
    ) -> PathBuf {
        if !observe {
            return vize_carton::path::canonicalize_non_verbatim(path);
        }
        let mut consumed = Self::canonical_configuration_path(path, true);
        let owner = Shared::new(FactOwner {
            path: path.to_path_buf(),
            role,
        });
        for stamp in &mut consumed.stamps {
            *stamp = stamp.clone().with_owner(owner.clone());
        }
        Self::consume_configuration(facts, consumed)
    }

    pub(crate) fn replace_dependency_edges_observed(
        &mut self,
        importer: &Path,
        targets: FxHashSet<PathBuf>,
    ) -> Consumed<Vec<PathBuf>> {
        let mut facts = empty(true);
        let value =
            self.replace_dependency_edges_with_consumption(importer, targets, true, &mut facts);
        finish(facts, value)
    }

    #[cfg(test)]
    pub(crate) fn prune_unowned_sources_observed(
        &mut self,
        candidates: impl IntoIterator<Item = PathBuf>,
    ) -> Consumed<Vec<PathBuf>> {
        let mut facts = empty(true);
        let value = self.prune_unowned_sources_with_consumption(
            candidates,
            true,
            &mut facts,
            None,
            &mut Vec::new(),
            &mut Vec::new(),
        );
        finish(facts, value)
    }

    /// The same original queue detects protected descendants. Refusal leaves
    /// those current supplied sources registered; the caller must cold-discard.
    pub(crate) fn prune_unowned_sources_preserving_observed(
        &mut self,
        candidates: impl IntoIterator<Item = PathBuf>,
        protected: &FxHashSet<PathBuf>,
    ) -> Consumed<(Vec<PathBuf>, Vec<PathBuf>, Vec<PathBuf>)> {
        let mut facts = empty(true);
        let mut blocked = Vec::new();
        let mut pruned = Vec::new();
        let artifacts = self.prune_unowned_sources_with_consumption(
            candidates,
            true,
            &mut facts,
            Some(protected),
            &mut blocked,
            &mut pruned,
        );
        blocked.sort();
        blocked.dedup();
        pruned.sort();
        pruned.dedup();
        finish(facts, (artifacts, blocked, pruned))
    }

    pub(crate) fn remove_source_and_dependencies_observed(
        &mut self,
        path: &Path,
    ) -> Consumed<Vec<PathBuf>> {
        let mut facts = empty(true);
        let value = self.remove_source_and_dependencies_with_consumption(path, true, &mut facts);
        finish(facts, value)
    }
}

#[cfg(test)]
mod tests;
