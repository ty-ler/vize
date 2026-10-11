use super::{CorsaResult, FxHashSet, VirtualProject};
use crate::batch::virtual_project::package_source_index::{RegisteredPackageRoots, empty, finish};
use crate::package_route::stamp::Consumed;

impl VirtualProject {
    pub(crate) fn register_package_route_targets(&mut self) -> CorsaResult<()> {
        self.register_package_route_targets_consumed(false, None)
            .map(|_| ())
    }

    #[cfg(test)]
    pub(crate) fn register_package_route_targets_observed(
        &mut self,
    ) -> CorsaResult<Consumed<RegisteredPackageRoots>> {
        let facts = self.register_package_route_targets_consumed(true, None)?;
        let value = self.snapshot_registered_package_roots();
        Ok(finish(facts, value))
    }

    pub(crate) fn register_package_route_targets_observed_with_inputs(
        &mut self,
        inputs: &Consumed<()>,
    ) -> CorsaResult<Consumed<RegisteredPackageRoots>> {
        let facts = self.register_package_route_targets_consumed(true, Some(inputs))?;
        let value = self.snapshot_registered_package_roots();
        Ok(finish(facts, value))
    }

    fn register_package_route_targets_consumed(
        &mut self,
        observe: bool,
        inputs: Option<&Consumed<()>>,
    ) -> CorsaResult<Consumed<()>> {
        let mut facts = empty(observe);
        if self.package_routes_need_refresh {
            self.refresh_package_routes_with_consumption(observe, &mut facts);
            if observe && inputs.is_none() {
                facts.qualified = false;
            } // policy witness is absent
            self.package_routes_need_refresh = false;
        }
        // A package source can itself import another export of the same
        // package. Discover those routes after registering each wave of
        // sources so its own package boundary is available in the virtual
        // project, even when the app only imports the package root.
        let mut processed = FxHashSet::default();
        loop {
            let mut targets = self
                .package_route_source_paths()
                .into_iter()
                .filter(|path| !processed.contains(path))
                .collect::<Vec<_>>();
            if targets.is_empty() {
                break;
            }
            targets.sort();
            self.register_paths_with_consumption(&targets, observe, &mut facts)?;
            self.reconcile_package_routes_for_importers_with_consumption(
                &targets, observe, &mut facts, inputs,
            );
            processed.extend(targets);
        }
        // This packet proves registration/index operations; native codegen/config authority is separate.
        Ok(finish(facts, ()))
    }
}
