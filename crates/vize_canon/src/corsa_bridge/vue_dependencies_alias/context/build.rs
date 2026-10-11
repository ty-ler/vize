//! Fail-closed construction of one editor alias/package-route snapshot.

use std::path::{Path, PathBuf};

use vize_carton::{FxHashMap, FxHashSet};

use super::AliasContext;
use super::routes::{RouteDiscovery, package_specifiers_from_frontier};
use crate::corsa_bridge::types::CorsaBridgeError;
use crate::package_route::stamp::{Consumed, FactRole};

pub(super) mod consumption;
mod dependencies;
mod settings;
mod source_inputs;
use consumption::NativeFacts;
pub(super) use settings::{configured_project, configured_project_observed};

pub(super) struct SourceRevision<'a> {
    pub requested_sources: &'a [(PathBuf, &'a str)],
    pub overlay_identity: u64,
}

pub(super) fn build(
    source_path: &Path,
    content: &str,
    overlays: &FxHashMap<PathBuf, &str>,
    revision: SourceRevision<'_>,
    resolver: &mut crate::PackageRouteResolver,
    options: crate::corsa_bridge::vue_document::CorsaVueVirtualDocumentOptions,
    environment: crate::corsa_bridge::vue_document::CorsaProjectEnvironment<'_>,
) -> Result<AliasContext, CorsaBridgeError> {
    build_consumed(
        source_path,
        content,
        overlays,
        revision,
        resolver,
        options,
        environment,
        false,
    )
    .map(|consumed| consumed.value)
}

pub(super) fn build_observed(
    source_path: &Path,
    content: &str,
    overlays: &FxHashMap<PathBuf, &str>,
    revision: SourceRevision<'_>,
    resolver: &mut crate::PackageRouteResolver,
    options: crate::corsa_bridge::vue_document::CorsaVueVirtualDocumentOptions,
    environment: crate::corsa_bridge::vue_document::CorsaProjectEnvironment<'_>,
) -> Result<crate::package_route::stamp::Consumed<AliasContext>, CorsaBridgeError> {
    build_consumed(
        source_path,
        content,
        overlays,
        revision,
        resolver,
        options,
        environment,
        true,
    )
}

fn build_consumed(
    source_path: &Path,
    content: &str,
    overlays: &FxHashMap<PathBuf, &str>,
    revision: SourceRevision<'_>,
    resolver: &mut crate::PackageRouteResolver,
    options: crate::corsa_bridge::vue_document::CorsaVueVirtualDocumentOptions,
    environment: crate::corsa_bridge::vue_document::CorsaProjectEnvironment<'_>,
    observe: bool,
) -> Result<crate::package_route::stamp::Consumed<AliasContext>, CorsaBridgeError> {
    // A caller may reach the same file through a logical symlink spelling
    // (`/var` vs `/private/var` on macOS). Package routes already use physical
    // source identity, so normalize the host once before deriving its mirror
    // path and nearest package scope. Mixing the two spellings splits a
    // package-private `imports` manifest from its generated source companions.
    use crate::batch::virtual_project::VirtualProject;
    let source_packet = VirtualProject::canonical_configuration_path(source_path, observe);
    let source_path = source_packet.value;
    let source_path = source_path.as_path();
    let project_packet = if observe {
        configured_project_observed(source_path, options, environment)?
    } else {
        Consumed {
            value: configured_project(source_path, options, environment)?,
            stamps: Vec::new(),
            qualified: false,
        }
    };
    let root = project_packet.value.project_root().to_path_buf();
    let mut facts = NativeFacts::new(observe);
    facts.record(
        Consumed {
            value: (),
            stamps: source_packet.stamps,
            qualified: source_packet.qualified,
        },
        FactRole::Configuration,
        &root,
    );
    let mut project = facts.record(project_packet, FactRole::Configuration, &root);
    let package_resolution = if observe {
        project.package_resolution_settings_observed()
    } else {
        Consumed {
            value: project.package_resolution_settings(),
            stamps: Vec::new(),
            qualified: false,
        }
    };
    let package_resolution = facts.factory(package_resolution, FactRole::Configuration, &root);
    let aliases = if observe {
        project.dependency_alias_map_observed()
    } else {
        Consumed {
            value: project.dependency_alias_map(),
            stamps: Vec::new(),
            qualified: false,
        }
    };
    let aliases = facts.factory(aliases, FactRole::Configuration, &root);
    let mut package_routes = FxHashMap::default();
    let mut package_reachability = FxHashMap::default();
    let mut package_bindings = Vec::new();
    let mut route_inputs = Vec::new();

    let seed_paths = source_inputs::register(
        &mut project,
        source_path,
        content,
        overlays,
        &revision,
        environment,
        &mut facts,
        &root,
        observe,
    )?;
    let reachable_phase =
        crate::corsa_bridge::preparation_trace::Phase::start("alias_reachable_dependencies", 1);
    dependencies::register_host(
        &mut project,
        source_path,
        overlays,
        &package_resolution,
        resolver,
        &mut package_routes,
        &mut package_reachability,
        &mut package_bindings,
        &mut route_inputs,
        &aliases,
        &mut facts,
        &root,
        observe,
    )?;

    reachable_phase.finish();
    let routes_phase =
        crate::corsa_bridge::preparation_trace::Phase::start("alias_package_routes", 1);
    let mut scanned_package_sources = FxHashSet::default();
    loop {
        if observe {
            facts.record(
                project.set_package_routes_observed(package_bindings.clone()),
                FactRole::Configuration,
                &root,
            );
        } else {
            project.set_package_routes(package_bindings.clone());
        }
        let registration = if observe {
            Some(
                project
                    .register_package_route_targets_observed_with_inputs(&facts.witness())
                    .map_err(bridge_error)?,
            )
        } else {
            project
                .register_package_route_targets()
                .map_err(bridge_error)?;
            None
        };
        let specifiers = package_specifiers_from_frontier(&project, &mut scanned_package_sources);
        if specifiers.is_empty() {
            if let Some(registration) = registration {
                facts.record_owned(registration);
            }
            break;
        }
        {
            let mut discovery = if observe {
                RouteDiscovery::new_observed(
                    &package_resolution,
                    resolver,
                    &mut package_routes,
                    &mut package_reachability,
                    &mut package_bindings,
                    &mut route_inputs,
                    &aliases,
                )
            } else {
                RouteDiscovery::new(
                    &package_resolution.value,
                    resolver,
                    &mut package_routes,
                    &mut package_reachability,
                    &mut package_bindings,
                    &mut route_inputs,
                    &aliases.value,
                )
            };
            let mut resolve_package =
                |importer: &Path, specifier: &str, mode: crate::PackageResolutionMode| {
                    if observe {
                        super::routes::PackageCallback::into_shadow_result(
                            discovery.resolve_observed(importer, specifier, mode),
                        )
                    } else {
                        Consumed {
                            value: discovery.resolve(importer, specifier, mode),
                            stamps: Vec::new(),
                            qualified: false,
                        }
                    }
                };
            if observe {
                let walk = project
                    .register_reachable_dependencies_with_package_resolver_observed(
                        overlays,
                        &specifiers,
                        &mut resolve_package,
                        registration.as_ref(),
                    )
                    .map_err(bridge_error)?;
                facts.record_owned(walk);
            } else {
                let mut legacy =
                    |importer: &Path, specifier: &str, mode: crate::PackageResolutionMode| {
                        resolve_package(importer, specifier, mode).value
                    };
                project
                    .register_reachable_dependencies_with_package_resolver(
                        overlays,
                        &specifiers,
                        &mut legacy,
                    )
                    .map_err(bridge_error)?;
            }
        }
        if let Some(registration) = registration {
            facts.record_owned(registration);
        }
        package_bindings.sort_by(|left, right| {
            (&left.importer_path, &left.specifier).cmp(&(&right.importer_path, &right.specifier))
        });
        package_bindings.dedup_by(|left, right| left == right);
    }
    if observe {
        facts.record(
            project.set_package_routes_observed(package_bindings),
            FactRole::Configuration,
            &root,
        );
    } else {
        project.set_package_routes(package_bindings);
    }
    if observe {
        facts.record_owned(
            project
                .register_package_route_targets_observed_with_inputs(&facts.witness())
                .map_err(bridge_error)?,
        );
    } else {
        project
            .register_package_route_targets()
            .map_err(bridge_error)?;
    }
    if observe {
        facts.record_owned(
            project
                .finalize_package_routes_observed()
                .map_err(bridge_error)?,
        );
    } else {
        project.finalize_package_routes().map_err(bridge_error)?;
    }
    routes_phase.finish();
    route_inputs.sort();
    route_inputs.dedup();
    // Keep the session-private identity: restoring an authored path after a
    // rename or deletion would leave live overlays in the previous project.
    let mirror = Some(project);

    let value = AliasContext {
        project_root: root,
        aliases: aliases.value,
        package_routes,
        route_inputs,
        seed_paths,
        #[cfg(test)]
        graph_reused: false,
        mirror,
        virtual_ts_options: environment.virtual_ts_options.clone(),
        query_surface: Default::default(),
    };
    if observe {
        let witness = facts.witness();
        let known = value
            .mirror
            .as_ref()
            .map(|project| {
                project
                    .registered_original_paths_sorted()
                    .into_iter()
                    .collect::<FxHashSet<_>>()
            })
            .unwrap_or_default();
        let complete_output = crate::package_route::stamp::package_aggregates_match_old(
            &witness.stamps,
            witness.qualified,
            &known,
            &value.package_routes,
            &value.route_inputs,
        );
        if let Err(ref refusal) = complete_output {
            use crate::package_route::stamp::PackageAggregateError;
            let reason = match refusal {
                PackageAggregateError::Unqualified => 21,
                PackageAggregateError::NoSources => 22,
                PackageAggregateError::MissingSourceBody(_) => 23,
                PackageAggregateError::MissingOwner(_) => 24,
                PackageAggregateError::WrongOwnerRole(_) => 25,
                PackageAggregateError::UnknownOwner(_) => 26,
                PackageAggregateError::NonAbsolute(_) => 27,
                PackageAggregateError::DirectoryMismatch(_) => 28,
                PackageAggregateError::RouteConflict(_, _) => 29,
                PackageAggregateError::OldInputs => 30,
                PackageAggregateError::OldRoutes => 31,
            };
            crate::corsa_bridge::preparation_trace::Phase::native_fact_guard(reason, known.len());
        }
        let current_inputs = super::cache::reconciled_are_current(
            &witness,
            &known,
            source_path,
            content.as_bytes(),
            overlays,
            revision.requested_sources,
        );
        if complete_output.is_err() || !current_inputs {
            facts.incomplete();
        }
    }
    Ok(facts.finish(value))
}

fn bridge_error(error: impl std::fmt::Display) -> CorsaBridgeError {
    CorsaBridgeError::CommunicationError(vize_carton::cstr!("{error}"))
}

#[cfg(test)]
mod jsconfig_tests;
