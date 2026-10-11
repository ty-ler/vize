//! Package-route recording and bounded dependency-specifier discovery.

use std::path::{Path, PathBuf};

use vize_carton::{FxHashMap, String as CompactString};

use crate::batch::virtual_project::VirtualProject;
use crate::package_route::stamp::{Consumed, InputStamp, record_editor_route_write};
#[path = "routes/callback.rs"]
mod callback;
use crate::batch::virtual_project::package_resolution::PackageResolutionSettings;
pub(super) use callback::{PackageCallback, PackageOccurrence, ReachabilityEntry};
use callback::{ReachabilityFacts, ReachabilityOrigin, retain_package_inputs};

#[expect(clippy::disallowed_types, reason = "serde_json keys are std String")] // Compiler-option aliases originate in serde_json maps.
type CompilerAlias = (std::string::String, std::string::String);

type ReachabilityCacheKey = (
    PathBuf,
    PathBuf,
    CompactString,
    crate::PackageResolutionContext,
    u8,
);

pub(super) struct RouteDiscovery<'a> {
    settings: &'a PackageResolutionSettings,
    resolver: &'a mut crate::PackageRouteResolver,
    routes: &'a mut FxHashMap<(PathBuf, CompactString), crate::PackageRoute>,
    reachability: &'a mut FxHashMap<ReachabilityCacheKey, ReachabilityEntry>,
    bindings: &'a mut Vec<crate::PackageRouteBinding>,
    inputs: &'a mut Vec<PathBuf>,
    aliases: &'a [CompilerAlias],
    settings_consumed: Option<&'a Consumed<PackageResolutionSettings>>,
    aliases_authority: Option<(&'a [InputStamp], bool)>,
}

impl<'a> RouteDiscovery<'a> {
    pub(super) fn new(
        settings: &'a PackageResolutionSettings,
        resolver: &'a mut crate::PackageRouteResolver,
        routes: &'a mut FxHashMap<(PathBuf, CompactString), crate::PackageRoute>,
        reachability: &'a mut FxHashMap<ReachabilityCacheKey, ReachabilityEntry>,
        bindings: &'a mut Vec<crate::PackageRouteBinding>,
        inputs: &'a mut Vec<PathBuf>,
        aliases: &'a [CompilerAlias],
    ) -> Self {
        Self {
            settings,
            resolver,
            routes,
            reachability,
            bindings,
            inputs,
            aliases,
            settings_consumed: None,
            aliases_authority: None,
        }
    }

    pub(super) fn new_observed(
        settings: &'a Consumed<PackageResolutionSettings>,
        resolver: &'a mut crate::PackageRouteResolver,
        routes: &'a mut FxHashMap<(PathBuf, CompactString), crate::PackageRoute>,
        reachability: &'a mut FxHashMap<ReachabilityCacheKey, ReachabilityEntry>,
        bindings: &'a mut Vec<crate::PackageRouteBinding>,
        inputs: &'a mut Vec<PathBuf>,
        aliases: &'a Consumed<Vec<CompilerAlias>>,
    ) -> Self {
        let mut discovery = Self::new(
            &settings.value,
            resolver,
            routes,
            reachability,
            bindings,
            inputs,
            &aliases.value,
        );
        discovery.settings_consumed = Some(settings);
        discovery.aliases_authority = Some((&aliases.stamps, aliases.qualified));
        discovery
    }

    pub(super) fn resolve(
        &mut self,
        importer: &Path,
        specifier: &str,
        mode: crate::PackageResolutionMode,
    ) -> bool {
        PackageCallback::into_shadow_result(self.resolve_observed(importer, specifier, mode)).value
    }

    pub(super) fn resolve_observed(
        &mut self,
        importer: &Path,
        specifier: &str,
        mode: crate::PackageResolutionMode,
    ) -> Consumed<PackageCallback> {
        if crate::batch::virtual_project::is_vue_runtime_support_specifier(specifier) {
            return Consumed {
                value: PackageCallback::RuntimeSupport,
                stamps: Vec::new(),
                qualified: true,
            };
        }
        let importer_dir = importer.parent().unwrap_or(importer);
        let input_start = self.inputs.len();
        let context = match self.settings_consumed {
            Some(settings) => PackageResolutionSettings::context_with_configuration_observed(
                settings,
                self.resolver,
                importer,
                mode,
            ),
            None => self
                .settings
                .context_observed(self.resolver, importer, mode),
        };
        let context_qualified = context.qualified;
        let mut stamps = context.stamps;
        let settings_qualified = self
            .settings_consumed
            .is_some_and(|settings| settings.qualified);
        let aliases_qualified = self
            .aliases_authority
            .is_some_and(|(_, qualified)| qualified);
        if let Some(settings) = self.settings_consumed {
            stamps.extend_from_slice(&settings.stamps);
        }
        if let Some((facts, _)) = self.aliases_authority {
            stamps.extend_from_slice(facts);
        }
        let mut qualified = context_qualified && settings_qualified && aliases_qualified;
        let (context, context_inputs) = context.value;
        let source_options = crate::PackageSourceOptions::new(true, true);
        let lookup = self.resolver.lookup_with_context_observed(
            importer_dir,
            specifier,
            source_options,
            context.clone(),
        );
        stamps.extend(lookup.stamps);
        let raw_lookup_qualified = lookup.qualified;
        qualified &= raw_lookup_qualified;
        let lookup = lookup.value;
        let raw_lookup = lookup.clone();
        let watchable_negative = lookup.is_watchable_negative();
        let (route, consulted) = lookup.into_parts();
        if route.is_some() || watchable_negative {
            self.inputs.extend(consulted.iter().cloned());
            self.inputs
                .extend(self.settings.input_paths().iter().cloned());
            self.inputs.extend(context_inputs.iter().cloned());
        }
        let cached_reachability = route
            .as_ref()
            .map_or_else(ReachabilityEntry::empty, |route| {
                let key = (
                    logical_absolute(importer),
                    route.manifest_path.clone(),
                    CompactString::from(specifier),
                    context.clone(),
                    crate::batch::PACKAGE_REACHABILITY_BUDGET_REVISION,
                );
                self.reachability
                    .entry(key)
                    .or_insert_with(|| {
                        let scanned = VirtualProject::package_route_reaches_vue_observed(
                            route,
                            self.aliases,
                            self.settings,
                            self.resolver,
                            crate::PackageSourceOptions::new(true, true),
                            crate::batch::virtual_project::ReachabilityAuthority {
                                aliases_qualified,
                                configuration: self.settings_consumed,
                                route_qualified: raw_lookup_qualified,
                            },
                        );
                        scanned.value.reachability.record_work(self.resolver);
                        // Retain actual miss input facts, never a later filesystem recapture.
                        let mut retained_stamps = stamps.clone();
                        retained_stamps.extend(scanned.stamps);
                        ReachabilityEntry {
                            value: scanned.value.reachability,
                            facts: Consumed {
                                value: ReachabilityFacts {
                                    failures: scanned.value.failures,
                                    origin: Some(ReachabilityOrigin {
                                        source_options,
                                        route: route.clone(),
                                        context: context.clone(),
                                        context_inputs: context_inputs.clone(),
                                        settings: self.settings.clone(),
                                        aliases: self.aliases.to_vec(),
                                        settings_qualified,
                                        aliases_qualified,
                                        context_qualified,
                                        raw_lookup_qualified,
                                    }),
                                },
                                stamps: retained_stamps,
                                qualified: qualified && scanned.qualified,
                            },
                        }
                    })
                    .clone()
            });
        // A retained miss is not relabeled by a newer caller domain.
        let same_origin = route.is_none()
            || cached_reachability
                .facts
                .value
                .origin
                .as_ref()
                .is_some_and(|origin| {
                    origin.source_options == source_options
                        && origin.context == context
                        && origin.context_inputs == context_inputs
                        && origin.settings == *self.settings
                        && origin.aliases.as_slice() == self.aliases
                        && route.as_ref() == Some(&origin.route)
                });
        qualified &= same_origin;
        stamps.extend(cached_reachability.facts.stamps);
        qualified &= cached_reachability.facts.qualified;
        let failures = cached_reachability.facts.value.failures;
        let reachability_origin = cached_reachability.facts.value.origin;
        let reachability = cached_reachability.value;
        let retained_reachability = reachability.clone();
        // Private imports need their authored manifest even for plain TS targets: the mirror's synthetic package boundary has no imports map.
        let needs_shadow = (specifier.starts_with('#') && route.is_some())
            || reachability.requires_shadow()
            || route
                .as_ref()
                .is_some_and(crate::PackageRoute::requires_workspace_source_shadow);
        let track_reachability = reachability.requires_tracking();
        self.inputs.extend(reachability.inputs);
        if needs_shadow && let Some(route) = route.as_ref() {
            let key = (logical_absolute(importer_dir), specifier.into());
            self.routes.insert(key.clone(), route.clone());
            record_editor_route_write(&mut stamps, importer, key.0, key.1, route);
        }
        let mut emitted_binding = None;
        if needs_shadow || track_reachability || watchable_negative {
            let binding = crate::PackageRouteBinding {
                importer_path: importer.to_path_buf(),
                specifier: specifier.into(),
                occurrence_mode: mode,
                context: context.clone(),
                route: needs_shadow.then_some(route).flatten(),
                invalidation_paths: consulted
                    .into_iter()
                    .chain(self.settings.input_paths().iter().cloned())
                    .chain(context_inputs.iter().cloned())
                    .chain(std::iter::once(importer.to_path_buf()))
                    .collect(),
            };
            emitted_binding = Some(binding.clone());
            self.bindings.push(binding);
        }
        let (route_inputs, inputs_complete) =
            retain_package_inputs(&mut stamps, importer, self.inputs, input_start);
        qualified &= inputs_complete;
        Consumed {
            value: PackageCallback::Occurrence(PackageOccurrence {
                source_options,
                context,
                context_inputs,
                raw_lookup,
                reachability: retained_reachability,
                failures,
                reachability_origin,
                needs_shadow,
                track_reachability,
                watchable_negative,
                route_inputs,
                binding: emitted_binding,
                binding_registered: false,
            }),
            stamps,
            qualified,
        }
    }
}

pub(super) fn package_specifiers_from_frontier(
    project: &VirtualProject,
    scanned: &mut vize_carton::FxHashSet<PathBuf>,
) -> Vec<CompactString> {
    let rewriter = crate::batch::ImportRewriter::new();
    let mut specifiers = project
        .virtual_files_sorted()
        .into_iter()
        .filter(|file| scanned.insert(file.original_path.clone()))
        .flat_map(|file| {
            let source_type = if file
                .virtual_path
                .extension()
                .is_some_and(|extension| extension == "tsx")
            {
                oxc_span::SourceType::tsx()
            } else {
                oxc_span::SourceType::ts()
            };
            rewriter.collect_all_specifiers(&file.content, source_type)
        })
        .filter(|specifier| {
            !specifier.starts_with('.') && !Path::new(specifier.as_str()).is_absolute()
        })
        .collect::<Vec<_>>();
    specifiers.sort();
    specifiers.dedup();
    specifiers
}

pub(super) fn logical_absolute(path: &Path) -> PathBuf {
    if path.is_absolute() {
        path.to_path_buf()
    } else {
        std::env::current_dir()
            .map(|cwd| cwd.join(path))
            .unwrap_or_else(|_| path.to_path_buf())
    }
}

#[cfg(test)]
#[path = "routes_tests.rs"]
mod tests;

#[cfg(test)]
#[path = "routes_budget_tests.rs"]
mod budget_tests;

#[cfg(test)]
mod private_import_tests;

#[cfg(test)]
#[path = "routes/cache_provenance_tests.rs"]
mod cache_provenance_tests;

#[cfg(test)]
#[path = "routes/membership_tests.rs"]
mod membership_tests;
