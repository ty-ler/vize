//! Physical package-root -> generated source topology index.

use std::path::{Path, PathBuf};

use vize_carton::{FxHashMap, FxHashSet};

use crate::package_route::PackageRouteKey;

use super::VirtualProject;
use crate::package_route::stamp::Shared;
use crate::package_route::stamp::{Consumed, FactOwner, FactRole, InputStamp};

mod ownership;
pub(crate) use ownership::{RegisteredPackageGeneration, RegisteredPackageRoots};

pub(super) fn empty(observe: bool) -> Consumed<()> {
    Consumed {
        value: (),
        stamps: Vec::new(),
        qualified: observe,
    }
}

pub(super) fn take<T>(facts: &mut Consumed<()>, child: Consumed<T>) -> T {
    facts.qualified &= child.qualified;
    facts.stamps.extend(child.stamps);
    child.value
}

pub(super) fn finish<T>(facts: Consumed<()>, value: T) -> Consumed<T> {
    Consumed {
        value,
        stamps: facts.stamps,
        qualified: facts.qualified,
    }
}

type PackageSources = FxHashMap<PathBuf, (PathBuf, PathBuf)>;

mod sources;

impl VirtualProject {
    pub(super) fn assign_root_importer<T>(consumed: &mut Consumed<T>, importer: &Path) {
        consumed.qualified &= importer.is_absolute();
        let owner = Shared::new(FactOwner {
            path: importer.to_path_buf(),
            role: FactRole::LocalImporter,
        });
        for stamp in &mut consumed.stamps {
            if stamp.owner().is_none() {
                *stamp = stamp.clone().with_owner(owner.clone());
            }
        }
    }

    pub(super) fn observe_registered_source(
        path: &Path,
        content: &str,
        observe: bool,
        facts: &mut Consumed<()>,
    ) {
        if observe {
            facts.qualified &= path.is_absolute();
            let owner = Shared::new(FactOwner {
                path: path.to_path_buf(),
                role: FactRole::AuthoredSource,
            });
            facts.stamps.push(
                InputStamp::observed_source(path.to_path_buf(), content.as_bytes())
                    .with_owner(owner),
            );
        }
    }

    pub(super) fn root_owner_canonical(
        path: &Path,
        owner: Option<(&Path, FactRole)>,
        observe: bool,
        facts: &mut Consumed<()>,
    ) -> PathBuf {
        let mut consumed = Self::canonical_configuration_path(path, observe);
        if observe {
            if let Some((path, role)) = owner {
                consumed.qualified &= path.is_absolute();
                let owner = Shared::new(FactOwner {
                    path: path.to_path_buf(),
                    role,
                });
                for stamp in &mut consumed.stamps {
                    *stamp = stamp.clone().with_owner(owner.clone());
                }
            } else {
                consumed.qualified = false;
            }
        }
        take(facts, consumed)
    }

    pub(crate) fn insert_package_route_binding(&mut self, binding: crate::PackageRouteBinding) {
        let mut facts = empty(false);
        self.insert_package_route_binding_with_consumption(binding, false, &mut facts)
    }

    pub(crate) fn insert_package_route_binding_observed(
        &mut self,
        binding: crate::PackageRouteBinding,
    ) -> Consumed<()> {
        let mut facts = empty(true);
        self.insert_package_route_binding_with_consumption(binding, true, &mut facts);
        finish(facts, ())
    }

    pub(in crate::batch::virtual_project) fn insert_package_route_binding_with_consumption(
        &mut self,
        binding: crate::PackageRouteBinding,
        observe: bool,
        facts: &mut Consumed<()>,
    ) {
        let key = binding.key();
        let retained = self.take_rebound_package_sources_with_consumption(
            &FxHashSet::from_iter([binding.key()]),
            observe,
            facts,
        );
        self.insert_route_binding_inner_with_consumption(binding, observe, facts);
        self.restore_rebound_package_sources(retained);
        self.mark_package_shadow_dependents([key]);
    }

    pub(crate) fn remove_package_route_binding(
        &mut self,
        key: &PackageRouteKey,
    ) -> Option<crate::PackageRouteBinding> {
        let mut facts = empty(false);
        self.remove_package_route_binding_with_consumption(key, false, &mut facts)
    }

    pub(crate) fn remove_package_route_binding_observed(
        &mut self,
        key: &PackageRouteKey,
    ) -> Consumed<Option<crate::PackageRouteBinding>> {
        let mut facts = empty(true);
        let value = self.remove_package_route_binding_with_consumption(key, true, &mut facts);
        finish(facts, value)
    }

    pub(in crate::batch::virtual_project) fn remove_package_route_binding_with_consumption(
        &mut self,
        key: &PackageRouteKey,
        observe: bool,
        facts: &mut Consumed<()>,
    ) -> Option<crate::PackageRouteBinding> {
        self.mark_package_shadow_dependents([key.clone()]);
        self.remove_route_binding_inner_with_consumption(key, observe, facts)
    }

    pub(crate) fn reconcile_package_routes_for_importers(&mut self, changed: &[PathBuf]) {
        let mut facts = empty(false);
        self.reconcile_package_routes_for_importers_with_consumption(
            changed, false, &mut facts, None,
        )
    }

    pub(in crate::batch::virtual_project) fn reconcile_package_routes_for_importers_with_consumption(
        &mut self,
        changed: &[PathBuf],
        observe: bool,
        facts: &mut Consumed<()>,
        inputs: Option<&Consumed<()>>,
    ) {
        let changed = changed
            .iter()
            .map(|path| {
                let absolute = if path.is_absolute() {
                    path.clone()
                } else {
                    self.project_root.join(path)
                };
                Self::root_owner_canonical(
                    &absolute,
                    Some((&absolute, FactRole::LocalImporter)),
                    observe,
                    facts,
                )
            })
            .collect::<FxHashSet<_>>();
        let keys = changed
            .iter()
            .flat_map(|importer| {
                self.package_route_importers
                    .get(importer)
                    .into_iter()
                    .flatten()
            })
            .cloned()
            .collect();
        let retained = self.take_rebound_package_sources_with_consumption(&keys, observe, facts);
        if observe {
            if let Some(inputs) = inputs {
                let mut witness = Consumed {
                    value: (),
                    stamps: inputs.stamps.clone(),
                    qualified: inputs.qualified && facts.qualified,
                };
                witness.stamps.extend(facts.stamps.iter().cloned());
                take(
                    facts,
                    self.reconcile_package_routes_for_importers_inner_observed_with_inputs(
                        &changed, &witness,
                    ),
                );
            } else {
                take(
                    facts,
                    self.reconcile_package_routes_for_importers_inner_observed(&changed),
                );
            }
        } else {
            self.reconcile_package_routes_for_importers_inner(&changed);
        }
        self.restore_rebound_package_sources(retained);
    }

    // Route-owned entry points are only a subset of a package's registered
    // relative sources. Keep that bounded topology across an atomic rebind
    // when removing its final owner would otherwise discard the whole index.
    pub(in crate::batch::virtual_project) fn take_rebound_package_sources_with_consumption(
        &mut self,
        keys: &FxHashSet<PackageRouteKey>,
        observe: bool,
        facts: &mut Consumed<()>,
    ) -> FxHashMap<PathBuf, PackageSources> {
        let roots = keys
            .iter()
            .filter_map(|key| {
                let binding = self.package_routes.get(key)?;
                Some((binding, binding.route.as_ref()?))
            })
            .flat_map(|(binding, route)| {
                route
                    .all_routes()
                    .into_iter()
                    .map(move |route| (binding, route))
            })
            .map(|(binding, route)| {
                Self::root_owner_canonical(
                    &route.package_root,
                    Some((&binding.importer_path, FactRole::LocalImporter)),
                    observe,
                    facts,
                )
            })
            .filter(|root| {
                self.package_route_roots
                    .get(root)
                    .is_some_and(|owners| owners.iter().all(|owner| keys.contains(owner)))
            })
            .collect::<FxHashSet<_>>();
        roots
            .into_iter()
            .filter_map(|root| {
                self.package_source_index
                    .remove(&root)
                    .map(|sources| (root, sources))
            })
            .collect()
    }

    fn restore_rebound_package_sources(&mut self, retained: FxHashMap<PathBuf, PackageSources>) {
        for (root, sources) in retained {
            let Some(owners) = self.package_route_roots.get(&root) else {
                continue;
            };
            let live_sources = sources.into_iter().filter(|(source, (_, virtual_path))| {
                self.original_index.get(source) == Some(virtual_path)
                    && self.virtual_files.contains_key(virtual_path)
            });
            self.package_source_index
                .entry(root)
                .or_default()
                .extend(live_sources);
            let owners = owners.iter().cloned().collect::<Vec<_>>();
            self.mark_package_shadow_dependents(owners);
        }
    }
}
