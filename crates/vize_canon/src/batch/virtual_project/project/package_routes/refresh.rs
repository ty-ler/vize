//! Original bounded refresh, extracted without changing its option tuple.
use crate::batch::virtual_project::package_source_index::{empty, take};
use crate::package_route::stamp::Consumed;

use super::super::super::VirtualProject;

impl VirtualProject {
    pub(super) fn refresh_package_routes(&mut self) {
        let mut facts = empty(false);
        self.refresh_package_routes_with_consumption(false, &mut facts);
    }

    pub(in crate::batch::virtual_project) fn refresh_package_routes_with_consumption(
        &mut self,
        observe: bool,
        facts: &mut Consumed<()>,
    ) {
        let resolution = if observe {
            take(facts, self.package_resolution_settings_observed())
        } else {
            self.package_resolution_settings()
        };
        let mut resolver = match self.package_route_resolver.lock() {
            Ok(resolver) => resolver,
            Err(_) => {
                if observe {
                    facts.qualified = false;
                }
                return;
            }
        };
        let total = self.package_routes.len();
        let refresh_keys = std::mem::take(&mut self.package_route_refresh_keys);
        let mut refreshed = Vec::with_capacity(refresh_keys.len());
        for key in &refresh_keys {
            let Some(mut binding) = self.package_routes.get(key).cloned() else {
                continue;
            };
            let importer_dir = binding
                .importer_path
                .parent()
                .unwrap_or(binding.importer_path.as_path());
            let (context, context_inputs) = if observe {
                let mut child = resolution.context_consumed(
                    &mut resolver,
                    &binding.importer_path,
                    binding.occurrence_mode,
                    true,
                );
                Self::assign_root_importer(&mut child, &binding.importer_path);
                take(facts, child)
            } else {
                resolution.context(
                    &mut resolver,
                    &binding.importer_path,
                    binding.occurrence_mode,
                )
            };
            let lookup = if observe {
                let mut child = resolver.lookup_with_context_observed(
                    importer_dir,
                    &binding.specifier,
                    crate::PackageSourceOptions::new(
                        self.source_policy.allows_javascript(),
                        self.jsx_typecheck,
                    ),
                    context.clone(),
                );
                Self::assign_root_importer(&mut child, &binding.importer_path);
                take(facts, child)
            } else {
                resolver.lookup_with_context(
                    importer_dir,
                    &binding.specifier,
                    crate::PackageSourceOptions::new(
                        self.source_policy.allows_javascript(),
                        self.jsx_typecheck,
                    ),
                    context.clone(),
                )
            };
            let (route, mut invalidation_paths) = lookup.into_parts();
            invalidation_paths.extend(resolution.input_paths().iter().cloned());
            invalidation_paths.extend(context_inputs);
            invalidation_paths.push(binding.importer_path.clone());
            binding.context = context;
            if route.is_none() {
                invalidation_paths.extend(binding.invalidation_paths.iter().cloned());
            }
            binding.route = route;
            invalidation_paths.sort();
            invalidation_paths.dedup();
            binding.invalidation_paths = invalidation_paths;
            refreshed.push(binding);
        }
        let considered = refreshed.len();
        resolver.record_refresh_scope(total, considered, considered);
        drop(resolver);
        for binding in refreshed {
            self.insert_package_route_binding_with_consumption(binding, observe, facts);
        }
    }
}
