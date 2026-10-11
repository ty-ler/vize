use super::{CorsaResult, FxHashSet, VirtualProject};
use crate::batch::virtual_project::package_source_index::{
    RegisteredPackageGeneration, RegisteredPackageRoots, empty, finish,
};
use crate::package_route::stamp::Consumed;

impl VirtualProject {
    pub(crate) fn register_package_route_targets(&mut self) -> CorsaResult<()> {
        self.register_package_route_targets_consumed(false, None, None)
            .map(|_| ())
    }

    #[cfg(test)]
    pub(crate) fn register_package_route_targets_observed(
        &mut self,
    ) -> CorsaResult<Consumed<RegisteredPackageRoots>> {
        let facts = self.register_package_route_targets_consumed(true, None, None)?;
        let value = self.snapshot_registered_package_roots();
        Ok(finish(facts, value))
    }

    pub(crate) fn register_package_route_targets_observed_with_inputs(
        &mut self,
        inputs: &Consumed<()>,
    ) -> CorsaResult<Consumed<RegisteredPackageRoots>> {
        let facts = self.register_package_route_targets_consumed(true, Some(inputs), None)?;
        let value = self.snapshot_registered_package_roots();
        Ok(finish(facts, value))
    }

    pub(crate) fn register_package_route_targets_observed_retaining_generation(
        &mut self,
        inputs: &Consumed<()>,
        generation: &RegisteredPackageGeneration,
    ) -> CorsaResult<Consumed<RegisteredPackageRoots>> {
        let facts =
            self.register_package_route_targets_consumed(true, Some(inputs), Some(generation))?;
        Ok(finish(facts, self.snapshot_registered_package_roots()))
    }

    fn register_package_route_targets_consumed(
        &mut self,
        observe: bool,
        inputs: Option<&Consumed<()>>,
        generation: Option<&RegisteredPackageGeneration>,
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
            let fresh = targets
                .iter()
                .filter(|path| {
                    let retained = generation.zip(inputs).is_some_and(|(generation, inputs)| {
                        inputs.qualified
                            && generation.sources.contains(*path)
                            && self.registered_package_roots_are_current(&generation.roots)
                            && self.find_by_original(path).is_some_and(|file| {
                                self.original_content_for_virtual(&file.virtual_path)
                                    .is_some_and(|body| {
                                        inputs.stamps.iter().any(|stamp| {
                                            stamp.has_registered_body(path, body.as_bytes())
                                        })
                                    })
                            })
                    });
                    !retained
                })
                .cloned()
                .collect::<Vec<_>>();
            self.register_paths_with_consumption(&fresh, observe, &mut facts)?;
            self.reconcile_package_routes_for_importers_with_consumption(
                &targets, observe, &mut facts, inputs,
            );
            processed.extend(targets);
        }
        // This packet proves registration/index operations; native codegen/config authority is separate.
        Ok(finish(facts, ()))
    }
}
