//! Bounded final admission over the existing authoritative owner graph.
use super::VirtualProject;
use crate::package_route::stamp::Consumed;
use std::path::{Path, PathBuf};
use vize_carton::{FxHashMap, FxHashSet};

impl VirtualProject {
    /// Inbound counts cannot prove root reachability: an orphan cycle can
    /// retain itself. Refuse such a candidate without changing the old prune
    /// algorithm or introducing another persistent graph/resolver owner.
    pub(crate) fn registered_sources_have_root_ownership(
        &self,
        protected: &FxHashSet<PathBuf>,
        inputs: &Consumed<()>,
    ) -> bool {
        if !inputs.qualified {
            return false;
        }
        // Transient selections from the SAME original operations only.
        // A/B conflict remains unknown, never a last-writer path choice.
        let mut selected = FxHashMap::<&Path, Option<&Path>>::default();
        for stamp in &inputs.stamps {
            if let Some((path, target)) = stamp.consumed_canonical_selection() {
                selected
                    .entry(path)
                    .and_modify(|old| {
                        if *old != Some(target) {
                            *old = None;
                        }
                    })
                    .or_insert(Some(target));
            }
        }
        let mut queue = protected.iter().cloned().collect::<Vec<_>>();
        if let Some(roots) = &self.declaration_roots {
            queue.extend(roots.iter().cloned());
        }
        let mut reachable = FxHashSet::default();
        while let Some(source) = queue.pop() {
            if self.find_by_original(&source).is_none() || !reachable.insert(source.clone()) {
                continue;
            }
            if let Some(targets) = self.dependency_edges.get(&source) {
                queue.extend(targets.iter().cloned());
            }
            // Use the current existing importer-key index; no whole binding
            // scan for every node, and no aggregate package count as a root.
            for key in self
                .package_route_importers
                .get(&source)
                .into_iter()
                .flatten()
            {
                let Some(binding) = self.package_routes.get(key) else {
                    return false;
                };
                if binding.importer_path != source {
                    return false;
                }
                let Some(route) = &binding.route else {
                    continue;
                };
                // Borrow each retained route member once. The normal sorted
                // public projection is unnecessary for a reachability guard.
                let mut routes = vec![route];
                while let Some(route) = routes.pop() {
                    routes.extend(route.nested_routes.iter());
                    for raw in route.source_paths.iter().chain(&route.dependency_paths) {
                        let target = match selected.get(raw.as_path()) {
                            Some(Some(target)) => *target,
                            Some(None) => return false,
                            None if self.find_by_original(raw).is_some() => raw.as_path(),
                            None => return false,
                        };
                        // Unregistered inferred targets keep the original failed
                        // inference policy. Actual registered members must reach
                        // one of the exact protected/declaration roots.
                        if self.find_by_original(target).is_some() {
                            queue.push(target.to_path_buf());
                        }
                    }
                }
            }
        }
        self.original_index
            .keys()
            .filter(|path| self.find_by_original(path).is_some())
            .all(|path| reachable.contains(path))
    }
}
