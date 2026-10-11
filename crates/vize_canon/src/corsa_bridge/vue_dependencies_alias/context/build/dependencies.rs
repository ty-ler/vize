//! The original host specifier prepass and first dependency walk.
use super::super::routes::{PackageCallback, ReachabilityEntry, RouteDiscovery};
use super::{NativeFacts, bridge_error};
use crate::batch::virtual_project::{
    VirtualProject,
    dependency_scan::{resolve_dependency, resolve_dependency_observed},
};
use crate::corsa_bridge::types::CorsaBridgeError;
use crate::package_route::stamp::{Consumed, FactRole};
use std::path::{Path, PathBuf};
use vize_carton::FxHashMap;

#[expect(
    clippy::too_many_arguments,
    reason = "the original discovery receives its same operation-local owners"
)]
#[expect(clippy::disallowed_types, reason = "dependency API uses std String")]
pub(super) fn register_host(
    project: &mut VirtualProject,
    source_path: &Path,
    overlays: &FxHashMap<PathBuf, &str>,
    package_resolution: &Consumed<
        crate::batch::virtual_project::package_resolution::PackageResolutionSettings,
    >,
    resolver: &mut crate::PackageRouteResolver,
    package_routes: &mut FxHashMap<(PathBuf, vize_carton::String), crate::PackageRoute>,
    package_reachability: &mut FxHashMap<
        (
            PathBuf,
            PathBuf,
            vize_carton::String,
            crate::PackageResolutionContext,
            u8,
        ),
        ReachabilityEntry,
    >,
    package_bindings: &mut Vec<crate::PackageRouteBinding>,
    route_inputs: &mut Vec<PathBuf>,
    aliases: &Consumed<Vec<(std::string::String, std::string::String)>>,
    facts: &mut NativeFacts,
    root: &Path,
    observe: bool,
) -> Result<(), CorsaBridgeError> {
    let virtual_file = project.find_by_original(source_path).ok_or_else(|| {
        CorsaBridgeError::CommunicationError(vize_carton::cstr!(
            "Canon did not retain registered host {}",
            source_path.display()
        ))
    })?;
    let source_type = if virtual_file
        .virtual_path
        .extension()
        .is_some_and(|extension| extension == "tsx")
    {
        oxc_span::SourceType::tsx()
    } else {
        oxc_span::SourceType::ts()
    };
    let host_specifiers = crate::batch::ImportRewriter::new()
        .collect_all_specifier_occurrences(&virtual_file.content, source_type);
    {
        let mut discovery = if observe {
            RouteDiscovery::new_observed(
                package_resolution,
                resolver,
                package_routes,
                package_reachability,
                package_bindings,
                route_inputs,
                aliases,
            )
        } else {
            RouteDiscovery::new(
                &package_resolution.value,
                resolver,
                package_routes,
                package_reachability,
                package_bindings,
                route_inputs,
                &aliases.value,
            )
        };
        let mut resolve_package =
            |importer: &Path, specifier: &str, mode: crate::PackageResolutionMode| {
                if observe {
                    PackageCallback::into_shadow_result(
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
        let mut specifiers = host_specifiers
            .iter()
            .filter_map(|(specifier, mode)| {
                let importer_dir = source_path.parent().unwrap_or(source_path);
                let local = if observe {
                    facts
                        .record(
                            resolve_dependency_observed(
                                specifier,
                                importer_dir,
                                root,
                                &aliases.value,
                            ),
                            FactRole::DependencyImporter,
                            source_path,
                        )
                        .0
                } else {
                    resolve_dependency(specifier, importer_dir, root, &aliases.value)
                };
                if local.is_some() {
                    return None;
                }
                facts
                    .record(
                        resolve_package(source_path, specifier.as_str(), *mode),
                        FactRole::LocalImporter,
                        source_path,
                    )
                    .then(|| specifier.clone())
            })
            .collect::<Vec<_>>();
        specifiers.sort();
        specifiers.dedup();
        if observe {
            let walk = project
                .register_reachable_dependencies_with_package_resolver_observed(
                    overlays,
                    &specifiers,
                    &mut resolve_package,
                    None,
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

    Ok(())
}
