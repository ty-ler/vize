//! Reconcile importer-scoped package routes after persistent source edits.

use std::path::{Path, PathBuf};

use oxc_span::SourceType;
use vize_carton::FxHashSet;

use super::VirtualProject;
use super::dependency_scan::{resolve_dependency, resolve_dependency_observed};
use super::package_route_reachability::{PackageRouteReachability, package_route_reaches_vue};
use crate::package_route::stamp::Shared;
use crate::package_route::stamp::{Consumed, FactOwner, FactRole};

impl VirtualProject {
    pub(super) fn reconcile_package_routes_for_importers_inner(
        &mut self,
        changed: &FxHashSet<PathBuf>,
    ) {
        self.reconcile_package_routes_for_importers_consumed(
            changed,
            false,
            super::package_source_index::empty(false),
        );
    }

    pub(super) fn reconcile_package_routes_for_importers_inner_observed(
        &mut self,
        changed: &FxHashSet<PathBuf>,
    ) -> Consumed<()> {
        self.reconcile_package_routes_for_importers_consumed(
            changed,
            true,
            super::package_source_index::empty(false),
        )
    }

    #[cfg(test)]
    pub(super) fn reconcile_package_routes_for_importers_inner_observed_with_inputs(
        &mut self,
        changed: &FxHashSet<PathBuf>,
        inputs: &Consumed<()>,
    ) -> Consumed<()> {
        self.reconcile_package_routes_for_importers_consumed(
            changed,
            true,
            Consumed {
                value: (),
                stamps: inputs.stamps.clone(),
                qualified: inputs.qualified,
            },
        )
    }

    pub(super) fn reconcile_package_routes_for_importers_inner_observed_from_qualified_inputs(
        &mut self,
        changed: &FxHashSet<PathBuf>,
        inherited_qualified: bool,
    ) -> Consumed<()> {
        self.reconcile_package_routes_for_importers_consumed(
            changed,
            true,
            super::package_source_index::empty(inherited_qualified),
        )
    }

    fn reconcile_package_routes_for_importers_consumed(
        &mut self,
        changed: &FxHashSet<PathBuf>,
        observe: bool,
        mut facts: Consumed<()>,
    ) -> Consumed<()> {
        if changed.is_empty() {
            return facts;
        }
        let removed_keys = changed
            .iter()
            .flat_map(|importer| {
                self.package_route_importers
                    .get(importer)
                    .into_iter()
                    .flatten()
                    .cloned()
            })
            .collect::<Vec<_>>();
        let previous = removed_keys.len();
        for key in removed_keys {
            if observe {
                take_registration(&mut facts, self.remove_package_route_binding_observed(&key));
            } else {
                self.remove_package_route_binding(&key);
            }
        }

        let importers = changed
            .iter()
            .filter_map(|path| {
                let file = self.find_by_original(path)?;
                let source_type = if file
                    .virtual_path
                    .extension()
                    .is_some_and(|extension| extension == "tsx")
                {
                    SourceType::tsx()
                } else {
                    SourceType::ts()
                };
                Some((path.clone(), file.content.clone(), source_type))
            })
            .collect::<Vec<_>>();
        let mut aliases = if observe {
            self.dependency_alias_map_observed()
        } else {
            Consumed {
                value: self.dependency_alias_map(),
                stamps: Vec::new(),
                qualified: false,
            }
        };
        if observe {
            assign_configuration(&mut aliases, &self.project_root);
        }
        facts.stamps.extend(aliases.stamps.iter().cloned());
        facts.qualified &= aliases.qualified;
        let mut resolution = if observe {
            self.package_resolution_settings_observed()
        } else {
            Consumed {
                value: self.package_resolution_settings(),
                stamps: Vec::new(),
                qualified: false,
            }
        };
        if observe {
            assign_configuration(&mut resolution, &self.project_root);
        }
        facts.stamps.extend(resolution.stamps.iter().cloned());
        facts.qualified &= resolution.qualified;
        let source_options = crate::PackageSourceOptions::new(
            self.source_policy.allows_javascript(),
            self.jsx_typecheck,
        );
        let mut discovered = Vec::new();
        let mut resolver = self
            .package_route_resolver
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        for (importer, content, source_type) in importers {
            let importer_dir = importer.parent().unwrap_or(importer.as_path());
            for (specifier, occurrence_mode) in self
                .rewriter
                .collect_all_specifier_occurrences(&content, source_type)
            {
                if is_vue_runtime_support_specifier(&specifier) {
                    continue;
                }
                if specifier.starts_with('.') || Path::new(specifier.as_str()).is_absolute() {
                    continue;
                }
                let mut local = if observe {
                    let local = resolve_dependency_observed(
                        &specifier,
                        importer_dir,
                        &self.project_root,
                        &aliases.value,
                    );
                    Consumed {
                        value: local.value.0,
                        stamps: local.stamps,
                        qualified: local.qualified && aliases.qualified,
                    }
                } else {
                    Consumed {
                        value: resolve_dependency(
                            &specifier,
                            importer_dir,
                            &self.project_root,
                            &aliases.value,
                        ),
                        stamps: Vec::new(),
                        qualified: false,
                    }
                };
                if observe {
                    Self::assign_root_importer(&mut local, &importer);
                }
                if take_registration(&mut facts, local).is_some() {
                    continue;
                }
                let mut context = if observe {
                    super::package_resolution::PackageResolutionSettings::context_with_configuration_observed(
                        &resolution, &mut resolver, &importer, occurrence_mode,
                    )
                } else {
                    Consumed {
                        value: resolution
                            .value
                            .context(&mut resolver, &importer, occurrence_mode),
                        stamps: Vec::new(),
                        qualified: false,
                    }
                };
                if observe {
                    Self::assign_root_importer(&mut context, &importer);
                }
                let (context, context_inputs) = take_registration(&mut facts, context);
                let mut lookup = if observe {
                    resolver.lookup_with_context_observed(
                        importer_dir,
                        &specifier,
                        source_options,
                        context.clone(),
                    )
                } else {
                    Consumed {
                        value: resolver.lookup_with_context(
                            importer_dir,
                            &specifier,
                            source_options,
                            context.clone(),
                        ),
                        stamps: Vec::new(),
                        qualified: false,
                    }
                };
                if observe {
                    Self::assign_root_importer(&mut lookup, &importer);
                }
                let raw_lookup_qualified = lookup.qualified;
                let lookup = take_registration(&mut facts, lookup);
                let watchable_negative = lookup.is_watchable_negative();
                let (route, mut invalidation_paths) = lookup.into_parts();
                let has_route = route.is_some();
                let reachability =
                    route
                        .as_ref()
                        .map_or_else(PackageRouteReachability::default, |route| {
                            if observe {
                                let mut scanned = super::package_route_reachability::package_route_reaches_vue_observed(
                                    route, &aliases.value, &resolution.value, &mut resolver,
                                    source_options, super::package_route_reachability::ReachabilityAuthority {
                                        aliases_qualified: aliases.qualified,
                                        configuration: Some(&resolution),
                                        route_qualified: raw_lookup_qualified,
                                    },
                                );
                                Self::assign_root_importer(&mut scanned, &importer);
                                take_registration(&mut facts, scanned).reachability
                            } else {
                                package_route_reaches_vue(
                                    route, &aliases.value, &resolution.value, &mut resolver, source_options,
                                )
                            }
                        });
                if has_route {
                    reachability.record_work(&mut resolver);
                }
                // Private `#` mappings require the authored scope manifest in
                // the mirror even when they resolve only ordinary `.ts` files.
                // The synthetic root manifest has no `imports` map.
                let needs_shadow = (specifier.starts_with('#') && has_route)
                    || reachability.requires_shadow()
                    || route
                        .as_ref()
                        .is_some_and(crate::PackageRoute::requires_workspace_source_shadow);
                if !route_requires_invalidation_binding(has_route, watchable_negative) {
                    continue;
                }
                invalidation_paths.extend(reachability.inputs);
                invalidation_paths.extend(resolution.value.input_paths().iter().cloned());
                invalidation_paths.extend(context_inputs);
                invalidation_paths.push(importer.clone());
                invalidation_paths.sort();
                invalidation_paths.dedup();
                discovered.push(crate::PackageRouteBinding {
                    importer_path: importer.clone(),
                    specifier,
                    occurrence_mode,
                    context,
                    route: needs_shadow.then_some(route).flatten(),
                    invalidation_paths,
                });
            }
        }
        drop(resolver);
        let discovered_count = discovered.len();
        for binding in discovered {
            if observe {
                take_registration(
                    &mut facts,
                    self.insert_package_route_binding_observed(binding),
                );
            } else {
                self.insert_package_route_binding(binding);
            }
        }
        self.package_route_refresh_keys
            .retain(|key| !changed.contains(&key.importer_path));
        self.package_routes_need_refresh = !self.package_route_refresh_keys.is_empty();
        let reconciled = previous.max(discovered_count);
        if reconciled > 0
            && let Ok(mut resolver) = self.package_route_resolver.lock()
        {
            resolver.record_refresh_scope(self.package_routes.len(), reconciled, reconciled);
        }
        facts
    }
}

fn assign_configuration<T>(packet: &mut Consumed<T>, root: &Path) {
    let owner = Shared::new(FactOwner {
        path: root.to_path_buf(),
        role: FactRole::Configuration,
    });
    for stamp in &mut packet.stamps {
        if stamp.owner().is_none() {
            *stamp = stamp.clone().with_owner(owner.clone());
        }
    }
}

fn take_registration<T>(facts: &mut Consumed<()>, consumed: Consumed<T>) -> T {
    facts.stamps.extend(consumed.stamps);
    facts.qualified &= consumed.qualified;
    consumed.value
}

fn route_requires_invalidation_binding(has_route: bool, watchable_negative: bool) -> bool {
    has_route || watchable_negative
}

/// Whether a module specifier belongs to Vue's shared runtime/type support.
///
/// Canon supplies these types to virtual documents. They are terminal support
/// edges rather than importer-scoped component packages, whether the edge came
/// from generated helpers, a package declaration, or a `vue/...` subpath
/// (Nuxt SSR's `vue/dist/vue.cjs.js`). `vue-router` is not a subpath.
pub fn is_vue_runtime_support_specifier(specifier: &str) -> bool {
    specifier == "vue"
        || specifier.starts_with("vue/")
        || specifier.starts_with("@vue/")
        || specifier == "vite/client"
}

#[cfg(test)]
#[path = "package_route_discovery/runtime_support_tests.rs"]
mod runtime_support_tests;

#[cfg(test)]
#[path = "package_route_discovery/consumed_owner_tests.rs"]
mod consumed_owner_tests;
