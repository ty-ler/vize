use super::{FxHashSet, VirtualProject};
use crate::batch::virtual_project::package_source_index::{empty, finish};
use crate::package_route::stamp::{Consumed, FactRole};

impl VirtualProject {
    pub(crate) fn replace_package_route_bindings(
        &mut self,
        bindings: impl IntoIterator<Item = crate::PackageRouteBinding>,
    ) {
        let mut facts = empty(false);
        self.replace_package_route_bindings_with_consumption(bindings, false, &mut facts)
    }

    pub(crate) fn replace_package_route_bindings_observed(
        &mut self,
        bindings: impl IntoIterator<Item = crate::PackageRouteBinding>,
    ) -> Consumed<()> {
        let mut facts = empty(true);
        let value =
            self.replace_package_route_bindings_with_consumption(bindings, true, &mut facts);
        finish(facts, value)
    }

    pub(in crate::batch::virtual_project) fn replace_package_route_bindings_with_consumption(
        &mut self,
        bindings: impl IntoIterator<Item = crate::PackageRouteBinding>,
        observe: bool,
        facts: &mut Consumed<()>,
    ) {
        let previous_roots = self
            .package_route_roots
            .keys()
            .cloned()
            .collect::<FxHashSet<_>>();
        self.package_routes.clear();
        self.package_route_reverse.clear();
        self.package_route_importers.clear();
        self.package_route_source_owners.clear();
        self.package_route_manifests.clear();
        self.package_route_roots.clear();
        self.package_shadow_dirty_keys.clear();
        for binding in bindings {
            self.insert_package_route_binding_with_consumption(binding, observe, facts);
        }
        let current_roots = self
            .package_route_roots
            .keys()
            .cloned()
            .collect::<FxHashSet<_>>();
        self.package_source_index
            .retain(|root, _| current_roots.contains(root));
        let added_roots = current_roots
            .difference(&previous_roots)
            .cloned()
            .collect::<Vec<_>>();
        if !added_roots.is_empty() {
            let registered = self
                .original_index
                .iter()
                .map(|(source, virtual_path)| (source.clone(), virtual_path.clone()))
                .collect::<Vec<_>>();
            for (source, virtual_path) in registered {
                for root in &added_roots {
                    let Ok(relative) = source.strip_prefix(root) else {
                        continue;
                    };
                    self.package_source_index
                        .entry(root.clone())
                        .or_default()
                        .insert(
                            source.clone(),
                            (relative.to_path_buf(), virtual_path.clone()),
                        );
                }
            }
        }
    }

    pub(crate) fn insert_route_binding_inner(&mut self, binding: crate::PackageRouteBinding) {
        let mut facts = empty(false);
        self.insert_route_binding_inner_with_consumption(binding, false, &mut facts)
    }

    pub(in crate::batch::virtual_project) fn insert_route_binding_inner_with_consumption(
        &mut self,
        binding: crate::PackageRouteBinding,
        observe: bool,
        facts: &mut Consumed<()>,
    ) {
        let key = binding.key();
        self.remove_package_route_binding_with_consumption(&key, observe, facts);
        for path in &binding.invalidation_paths {
            self.package_route_reverse
                .entry(path.clone())
                .or_default()
                .insert(key.clone());
        }
        self.package_route_importers
            .entry(binding.importer_path.clone())
            .or_default()
            .insert(key.clone());
        if let Some(route) = binding.route.as_ref() {
            for route in route.all_routes() {
                let package_root = Self::root_owner_canonical(
                    &route.package_root,
                    Some((&binding.importer_path, FactRole::LocalImporter)),
                    observe,
                    facts,
                );
                self.package_route_roots
                    .entry(package_root)
                    .or_default()
                    .insert(key.clone());
                if let Some(keys) = self.package_route_manifests.get(&route.manifest_path) {
                    self.package_shadow_dirty_keys.extend(keys.iter().cloned());
                }
                self.package_route_manifests
                    .entry(route.manifest_path.clone())
                    .or_default()
                    .insert(key.clone());
            }
            for source in route.all_source_paths() {
                let source = Self::root_owner_canonical(
                    source,
                    Some((&binding.importer_path, FactRole::LocalImporter)),
                    observe,
                    facts,
                );
                *self.package_route_source_owners.entry(source).or_default() += 1;
            }
            self.index_existing_package_route_sources_with_consumption(
                route,
                Some(&binding.importer_path),
                observe,
                facts,
            );
        }
        self.package_shadow_dirty_keys.insert(key.clone());
        self.package_routes.insert(key, binding);
    }

    pub(crate) fn remove_route_binding_inner(
        &mut self,
        key: &crate::package_route::PackageRouteKey,
    ) -> Option<crate::PackageRouteBinding> {
        let mut facts = empty(false);
        self.remove_route_binding_inner_with_consumption(key, false, &mut facts)
    }

    pub(in crate::batch::virtual_project) fn remove_route_binding_inner_with_consumption(
        &mut self,
        key: &crate::package_route::PackageRouteKey,
        observe: bool,
        facts: &mut Consumed<()>,
    ) -> Option<crate::PackageRouteBinding> {
        let binding = self.package_routes.remove(key)?;
        self.package_shadow_dirty_keys.insert(key.clone());
        self.remove_route_reverse_indexes(key, &binding);
        self.remove_route_topology_indexes_with_consumption(key, &binding, observe, facts);
        Some(binding)
    }

    fn remove_route_reverse_indexes(
        &mut self,
        key: &crate::package_route::PackageRouteKey,
        binding: &crate::PackageRouteBinding,
    ) {
        for path in &binding.invalidation_paths {
            let remove = self
                .package_route_reverse
                .get_mut(path)
                .is_some_and(|keys| {
                    keys.remove(key);
                    keys.is_empty()
                });
            if remove {
                self.package_route_reverse.remove(path);
            }
        }
        let remove = self
            .package_route_importers
            .get_mut(&binding.importer_path)
            .is_some_and(|keys| {
                keys.remove(key);
                keys.is_empty()
            });
        if remove {
            self.package_route_importers.remove(&binding.importer_path);
        }
    }

    fn remove_route_topology_indexes(
        &mut self,
        key: &crate::package_route::PackageRouteKey,
        binding: &crate::PackageRouteBinding,
    ) {
        let mut facts = empty(false);
        self.remove_route_topology_indexes_with_consumption(key, binding, false, &mut facts)
    }

    pub(in crate::batch::virtual_project) fn remove_route_topology_indexes_with_consumption(
        &mut self,
        key: &crate::package_route::PackageRouteKey,
        binding: &crate::PackageRouteBinding,
        observe: bool,
        facts: &mut Consumed<()>,
    ) {
        let Some(route) = binding.route.as_ref() else {
            return;
        };
        for route in route.all_routes() {
            let root = Self::root_owner_canonical(
                &route.package_root,
                Some((&binding.importer_path, FactRole::LocalImporter)),
                observe,
                facts,
            );
            let remove = self.package_route_roots.get_mut(&root).is_some_and(|keys| {
                keys.remove(key);
                keys.is_empty()
            });
            if remove {
                self.package_route_roots.remove(&root);
                self.package_source_index.remove(&root);
            }
            if let Some(keys) = self.package_route_manifests.get(&route.manifest_path) {
                self.package_shadow_dirty_keys.extend(keys.iter().cloned());
            }
            let remove = self
                .package_route_manifests
                .get_mut(&route.manifest_path)
                .is_some_and(|keys| {
                    keys.remove(key);
                    keys.is_empty()
                });
            if remove {
                self.package_route_manifests.remove(&route.manifest_path);
            }
        }
        for source in route.all_source_paths() {
            let source = Self::root_owner_canonical(
                source,
                Some((&binding.importer_path, FactRole::LocalImporter)),
                observe,
                facts,
            );
            let remove = self
                .package_route_source_owners
                .get_mut(&source)
                .is_some_and(|count| {
                    *count = count.saturating_sub(1);
                    *count == 0
                });
            if remove {
                self.package_route_source_owners.remove(&source);
            }
        }
    }
}
