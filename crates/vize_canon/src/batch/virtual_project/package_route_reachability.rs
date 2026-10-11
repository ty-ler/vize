//! Deterministically bounded Vue reachability for importer-scoped packages.

use std::cmp::Reverse;
use std::collections::BinaryHeap;
use std::path::{Path, PathBuf};

use vize_carton::FxHashSet;

use super::dependency_scan::resolve_dependency_observed;
use super::is_vue_runtime_support_specifier;
use crate::package_route::stamp::Consumed;

/// Cache and evidence identity for the fixed reachability work contract.
pub const PACKAGE_REACHABILITY_BUDGET_REVISION: u8 = 2;

// One route may inspect at most 128 package identities, source candidates, or
// parses, 512 unique edges, 128 KiB per source, and 512 KiB total. Metadata is
// checked before a source is read, so generated/minified bundles cannot consume
// the parse budget. Queued candidates are bounded separately because seeding a
// package enumerates its whole source and dependency list before any file is
// popped, and every queued path is retained as an invalidation input.
const DEFAULT_BUDGET: ReachabilityBudget = ReachabilityBudget {
    max_packages: 128,
    max_files: 128,
    max_queued_files: 4096,
    max_file_bytes: 128 * 1024,
    max_total_bytes: 512 * 1024,
    max_edges: 512,
    max_parses: 128,
};

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub enum ReachabilityOutcome {
    #[default]
    DoesNotReachVue,
    ReachesVue,
    BudgetExceeded,
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct ReachabilityWork {
    pub files: usize,
    pub bytes: usize,
    pub edges: usize,
    pub parses: usize,
    pub packages: usize,
}

#[derive(Clone, Debug, Default)]
pub struct PackageRouteReachability {
    pub outcome: ReachabilityOutcome,
    pub inputs: Vec<PathBuf>,
    pub work: ReachabilityWork,
}

impl PackageRouteReachability {
    pub fn requires_shadow(&self) -> bool {
        self.outcome == ReachabilityOutcome::ReachesVue
    }

    pub fn requires_tracking(&self) -> bool {
        self.outcome != ReachabilityOutcome::DoesNotReachVue
    }

    pub fn record_work(&self, resolver: &mut crate::PackageRouteResolver) {
        resolver.record_reachability_work(
            self.work.files,
            self.work.bytes,
            self.work.edges,
            self.work.parses,
            self.work.packages,
            self.outcome == ReachabilityOutcome::BudgetExceeded,
        );
    }
}

/// Operation-local read failures; no error authority is inferred from kind alone.
pub(crate) struct ConsumedReachability {
    pub(crate) reachability: PackageRouteReachability,
    pub(crate) failures: Vec<(PathBuf, &'static str, std::io::ErrorKind)>,
}

#[derive(Clone, Copy, Debug)]
struct ReachabilityBudget {
    max_packages: usize,
    max_files: usize,
    max_queued_files: usize,
    max_file_bytes: usize,
    max_total_bytes: usize,
    max_edges: usize,
    max_parses: usize,
}

#[path = "package_route_reachability_route_graph.rs"]
mod route_graph;
#[path = "package_route_reachability/scan.rs"]
mod scan;
use scan::{scan_package_route_reachability_observed, scan_package_route_reachability_with_budget};

#[expect(clippy::disallowed_types, reason = "serde_json keys are std String")] // Compiler-option aliases originate in serde_json maps.
pub(crate) fn package_route_reaches_vue(
    route: &crate::PackageRoute,
    aliases: &[(std::string::String, std::string::String)],
    resolution: &super::package_resolution::PackageResolutionSettings,
    resolver: &mut crate::PackageRouteResolver,
    source_options: crate::PackageSourceOptions,
) -> PackageRouteReachability {
    package_route_reaches_vue_with_budget(
        route,
        aliases,
        resolution,
        resolver,
        source_options,
        DEFAULT_BUDGET,
    )
}

#[expect(clippy::disallowed_types, reason = "serde_json keys are std String")] // Compiler-option aliases originate in serde_json maps.
pub(crate) fn package_route_reaches_vue_observed(
    route: &crate::PackageRoute,
    aliases: &[(std::string::String, std::string::String)],
    resolution: &super::package_resolution::PackageResolutionSettings,
    resolver: &mut crate::PackageRouteResolver,
    source_options: crate::PackageSourceOptions,
    aliases_qualified: bool,
    configuration: Option<&Consumed<super::package_resolution::PackageResolutionSettings>>,
    route_qualified: bool,
) -> Consumed<ConsumedReachability> {
    package_route_reaches_vue_with_budget_observed(
        route,
        aliases,
        resolution,
        resolver,
        source_options,
        DEFAULT_BUDGET,
        aliases_qualified,
        configuration,
        route_qualified,
    )
}

/// Determine whether one package route reaches a Vue source without allowing
/// an arbitrary dependency graph to delay native project startup.
pub fn scan_package_route_reachability<ResolveLocal, ResolvePackage>(
    route: &crate::PackageRoute,
    resolve_local: ResolveLocal,
    resolve_package: ResolvePackage,
) -> PackageRouteReachability
where
    ResolveLocal: FnMut(&Path, &str) -> (Option<PathBuf>, Vec<PathBuf>),
    ResolvePackage: FnMut(
        &Path,
        &str,
        crate::PackageResolutionMode,
    ) -> (Option<crate::PackageRoute>, Vec<PathBuf>),
{
    scan_package_route_reachability_with_budget(
        route,
        resolve_local,
        resolve_package,
        DEFAULT_BUDGET,
    )
}

#[expect(clippy::disallowed_types, reason = "serde_json keys are std String")] // Compiler-option aliases originate in serde_json maps.
fn package_route_reaches_vue_with_budget(
    route: &crate::PackageRoute,
    aliases: &[(std::string::String, std::string::String)],
    resolution: &super::package_resolution::PackageResolutionSettings,
    resolver: &mut crate::PackageRouteResolver,
    source_options: crate::PackageSourceOptions,
    budget: ReachabilityBudget,
) -> PackageRouteReachability {
    package_route_reaches_vue_with_budget_observed(
        route,
        aliases,
        resolution,
        resolver,
        source_options,
        budget,
        false,
        None,
        false,
    )
    .value
    .reachability
}

#[expect(clippy::disallowed_types, reason = "serde_json keys are std String")] // Compiler-option aliases originate in serde_json maps.
fn package_route_reaches_vue_with_budget_observed(
    route: &crate::PackageRoute,
    aliases: &[(std::string::String, std::string::String)],
    resolution: &super::package_resolution::PackageResolutionSettings,
    resolver: &mut crate::PackageRouteResolver,
    source_options: crate::PackageSourceOptions,
    budget: ReachabilityBudget,
    aliases_qualified: bool,
    configuration: Option<&Consumed<super::package_resolution::PackageResolutionSettings>>,
    route_qualified: bool,
) -> Consumed<ConsumedReachability> {
    scan_package_route_reachability_observed(
        route,
        |importer, specifier| {
            let importer_dir = importer.parent().unwrap_or(importer);
            let mut local =
                resolve_dependency_observed(specifier, importer_dir, &route.package_root, aliases);
            local.qualified &= aliases_qualified;
            local
        },
        |importer, specifier, mode| {
            let importer_dir = importer.parent().unwrap_or(importer);
            let context = match configuration.filter(|settings| settings.value == *resolution) {
                Some(settings) => super::package_resolution::PackageResolutionSettings::context_with_configuration_observed(
                    settings, resolver, importer, mode,
                ),
                None => resolution.context_observed(resolver, importer, mode),
            };
            let (context_value, mut inputs) = context.value;
            let lookup = resolver.lookup_with_context_observed(
                importer_dir,
                specifier,
                source_options,
                context_value,
            );
            let (nested, consulted) = lookup.value.into_parts();
            inputs.extend(consulted);
            let mut stamps = context.stamps;
            stamps.extend(lookup.stamps);
            Consumed {
                value: (nested, inputs),
                stamps,
                qualified: context.qualified && lookup.qualified,
            }
        },
        budget,
        route_qualified
            && aliases_qualified
            && configuration
                .is_some_and(|settings| settings.qualified && settings.value == *resolution),
    )
}

fn enqueue(
    queue: &mut BinaryHeap<(u8, Reverse<PathBuf>)>,
    queued: &mut FxHashSet<PathBuf>,
    path: PathBuf,
) {
    if queued.insert(path.clone()) {
        queue.push((source_priority(&path), Reverse(path)));
    }
}

fn source_priority(path: &Path) -> u8 {
    match path.extension().and_then(|extension| extension.to_str()) {
        Some("vue") => 3,
        Some("ts" | "tsx" | "mts" | "cts") => 2,
        Some("js" | "jsx" | "mjs" | "cjs") => 1,
        _ => 0,
    }
}

fn finish(
    outcome: ReachabilityOutcome,
    mut inputs: Vec<PathBuf>,
    work: ReachabilityWork,
    budget: ReachabilityBudget,
) -> PackageRouteReachability {
    inputs.sort();
    inputs.dedup();
    debug_assert!(
        outcome == ReachabilityOutcome::BudgetExceeded
            || (work.files <= budget.max_files
                && work.packages <= budget.max_packages
                && work.bytes <= budget.max_total_bytes
                && work.edges <= budget.max_edges
                && work.parses <= budget.max_parses)
    );
    PackageRouteReachability {
        outcome,
        inputs,
        work,
    }
}

#[cfg(test)]
#[path = "package_route_reachability_tests.rs"]
mod tests;
