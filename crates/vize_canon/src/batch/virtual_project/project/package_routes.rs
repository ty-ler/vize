//! Authoritative package-route indexes and bounded refresh.

use std::path::{Path, PathBuf};

use vize_carton::FxHashSet;

use crate::batch::error::CorsaResult;

use super::super::VirtualProject;

#[path = "package_routes/refresh.rs"]
mod refresh;

mod bindings;
#[cfg(any(feature = "native", test))]
mod closure;

mod registration;
mod retirement;
pub(crate) use retirement::PackageBindingRetirement;

impl VirtualProject {
    /// Internal carrier from the one original reachability operation.
    #[expect(
        clippy::disallowed_types,
        reason = "compiler aliases originate in serde_json"
    )]
    pub(crate) fn package_route_reaches_vue_observed(
        route: &crate::PackageRoute,
        aliases: &[(std::string::String, std::string::String)],
        resolution: &super::super::package_resolution::PackageResolutionSettings,
        resolver: &mut crate::PackageRouteResolver,
        source_options: crate::PackageSourceOptions,
        aliases_qualified: bool,
        configuration: Option<
            &crate::package_route::stamp::Consumed<
                super::super::package_resolution::PackageResolutionSettings,
            >,
        >,
        route_qualified: bool,
    ) -> crate::package_route::stamp::Consumed<
        super::super::package_route_reachability::ConsumedReachability,
    > {
        super::super::package_route_reachability::package_route_reaches_vue_observed(
            route,
            aliases,
            resolution,
            resolver,
            source_options,
            aliases_qualified,
            configuration,
            route_qualified,
        )
    }

    pub(crate) fn clear_package_route_bindings_for_rebuild(&mut self) {
        let keys = self.package_routes.keys().cloned().collect::<Vec<_>>();
        for key in keys {
            self.remove_package_route_binding(&key);
        }
        self.package_route_refresh_keys.clear();
        self.package_routes_need_refresh = false;
    }

    pub(crate) fn package_route_keys_for_changes(
        &self,
        changed: &[PathBuf],
    ) -> FxHashSet<crate::package_route::PackageRouteKey> {
        let mut affected = FxHashSet::default();
        for path in changed {
            let logical = if path.is_absolute() {
                path.clone()
            } else {
                self.project_root.join(path)
            };
            if let Some(keys) = self.package_route_reverse.get(&logical) {
                affected.extend(keys.iter().cloned());
            }
            let canonical = crate::package_route::stamp::canonicalize_changed_path(&logical);
            if canonical != logical
                && let Some(keys) = self.package_route_reverse.get(&canonical)
            {
                affected.extend(keys.iter().cloned());
            }
            if let Some(keys) = self.package_route_importers.get(&canonical) {
                affected.extend(keys.iter().cloned());
            }
        }
        affected
    }

    pub(crate) fn refresh_package_route_keys(
        &mut self,
        keys: FxHashSet<crate::package_route::PackageRouteKey>,
    ) {
        self.package_route_refresh_keys = keys;
        self.package_routes_need_refresh = !self.package_route_refresh_keys.is_empty();
        if self.package_routes_need_refresh {
            self.refresh_package_routes();
            self.package_routes_need_refresh = false;
        }
    }

    pub(crate) fn package_route_metrics(&self) -> crate::PackageRouteMetrics {
        self.package_route_resolver
            .lock()
            .map(|resolver| resolver.metrics())
            .unwrap_or_default()
    }

    #[cfg(test)]
    pub(crate) fn package_routes_snapshot(&self) -> Vec<crate::PackageRouteBinding> {
        let mut bindings = self.package_routes.values().cloned().collect::<Vec<_>>();
        bindings.sort_by_key(crate::PackageRouteBinding::key);
        bindings
    }

    pub(crate) fn workspace_package_route_identity(
        &self,
        importer: &Path,
        specifier: &str,
    ) -> Option<&Path> {
        self.package_routes
            .values()
            .find(|binding| {
                binding.importer_path == importer
                    && binding.specifier == specifier
                    && binding
                        .route
                        .as_ref()
                        .is_some_and(|route| route.workspace_source)
            })
            .and_then(|binding| binding.route.as_ref())
            .map(|route| route.package_root.as_path())
    }

    pub(crate) fn finalize_package_routes(&mut self) -> CorsaResult<()> {
        self.rebuild_package_shadows()?;
        self.finalize_module_imports();
        Ok(())
    }

    /// Retain the facts consumed by the same final shadow and import passes.
    pub(crate) fn finalize_package_routes_observed(
        &mut self,
    ) -> CorsaResult<crate::package_route::stamp::Consumed<()>> {
        let shadow = self.rebuild_package_shadows_observed()?;
        let editor = if self.editor_document_options.is_some() {
            self.finalize_editor_imports_observed()
        } else {
            // Other callers retain their original finalizer. Its raw reads
            // have no complete native operation witness and cannot qualify.
            self.finalize_module_imports();
            crate::package_route::stamp::Consumed {
                value: (),
                stamps: Vec::new(),
                qualified: false,
            }
        };
        let mut stamps = shadow.stamps;
        stamps.extend(editor.stamps);
        Ok(crate::package_route::stamp::Consumed {
            value: (),
            stamps,
            qualified: shadow.qualified && editor.qualified,
        })
    }
}

#[cfg(test)]
mod union_controls;
