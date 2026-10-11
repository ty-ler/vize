use super::{Consumed, FactRole, Path, VirtualProject};
#[cfg(test)]
use super::{empty, finish};

impl VirtualProject {
    #[cfg(test)]
    pub(in super::super) fn index_package_source(&mut self, source: &Path, virtual_path: &Path) {
        let mut facts = empty(false);
        self.index_package_source_with_consumption(source, virtual_path, false, &mut facts)
    }

    #[cfg(test)]
    pub(crate) fn index_package_source_observed(
        &mut self,
        source: &Path,
        virtual_path: &Path,
    ) -> Consumed<()> {
        let mut facts = empty(true);
        self.index_package_source_with_consumption(source, virtual_path, true, &mut facts);
        finish(facts, ())
    }

    pub(in crate::batch::virtual_project) fn index_package_source_with_consumption(
        &mut self,
        source: &Path,
        virtual_path: &Path,
        observe: bool,
        facts: &mut Consumed<()>,
    ) {
        let source = Self::root_owner_canonical(
            source,
            Some((source, FactRole::AuthoredSource)),
            observe,
            facts,
        );
        let roots = source
            .ancestors()
            .filter(|ancestor| self.package_route_roots.contains_key(*ancestor))
            .map(Path::to_path_buf)
            .collect::<Vec<_>>();
        for root in roots {
            let Ok(relative) = source.strip_prefix(&root) else {
                continue;
            };
            let indexed = (relative.to_path_buf(), virtual_path.to_path_buf());
            let changed = self
                .package_source_index
                .entry(root.clone())
                .or_default()
                .insert(source.clone(), indexed.clone())
                .as_ref()
                != Some(&indexed);
            if changed
                && self.package_shadows_initialized
                && let Some(keys) = self.package_route_roots.get(&root)
            {
                let keys = keys.iter().cloned().collect::<Vec<_>>();
                self.mark_package_shadow_dependents(keys);
            }
        }
    }

    #[cfg(test)]
    pub(in super::super) fn remove_package_source_from_index(&mut self, source: &Path) {
        let mut facts = empty(false);
        self.remove_package_source_from_index_with_consumption(source, false, &mut facts)
    }

    #[cfg(test)]
    pub(crate) fn remove_package_source_from_index_observed(
        &mut self,
        source: &Path,
    ) -> Consumed<()> {
        let mut facts = empty(true);
        self.remove_package_source_from_index_with_consumption(source, true, &mut facts);
        finish(facts, ())
    }

    pub(in crate::batch::virtual_project) fn remove_package_source_from_index_with_consumption(
        &mut self,
        source: &Path,
        observe: bool,
        facts: &mut Consumed<()>,
    ) {
        let source = Self::root_owner_canonical(
            source,
            Some((source, FactRole::AuthoredSource)),
            observe,
            facts,
        );
        for ancestor in source.ancestors() {
            if self
                .package_source_index
                .get_mut(ancestor)
                .is_some_and(|sources| sources.remove(&source).is_some())
                && self.package_shadows_initialized
                && let Some(keys) = self.package_route_roots.get(ancestor)
            {
                let keys = keys.iter().cloned().collect::<Vec<_>>();
                self.mark_package_shadow_dependents(keys);
            }
        }
    }

    pub(in crate::batch::virtual_project) fn index_existing_package_route_sources_with_consumption(
        &mut self,
        route: &crate::PackageRoute,
        importer: Option<&Path>,
        observe: bool,
        facts: &mut Consumed<()>,
    ) {
        for route in route.all_routes() {
            let root = Self::root_owner_canonical(
                &route.package_root,
                importer.map(|path| (path, FactRole::LocalImporter)),
                observe,
                facts,
            );
            self.package_route_roots.entry(root.clone()).or_default();
            for source in route.all_source_paths() {
                let source = Self::root_owner_canonical(
                    source,
                    Some((source, FactRole::AuthoredSource)),
                    observe,
                    facts,
                );
                let Some(virtual_path) = self.original_index.get(&source).cloned() else {
                    continue;
                };
                let Ok(relative) = source.strip_prefix(&root) else {
                    continue;
                };
                let relative = relative.to_path_buf();
                self.package_source_index
                    .entry(root.clone())
                    .or_default()
                    .insert(source, (relative, virtual_path));
            }
        }
    }
}
