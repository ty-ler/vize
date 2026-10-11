use std::path::{Path, PathBuf};

use vize_carton::{FxHashMap, String};

use super::search::PackageSearchCache;
use super::stamp::{InputStamp, InputStampCache};
use super::{
    PackagePathCache, PackageResolutionContext, PackageRoute, PackageRouteMetrics,
    PackageSourceOptions,
};
pub use lookup::PackageRouteLookup;

#[path = "cache/consumed_lookup.rs"]
mod consumed_lookup;
#[path = "cache/context.rs"]
mod context;
#[path = "cache_lookup.rs"]
mod lookup;

type ResolutionKey = (
    PathBuf,
    String,
    PackageSourceOptions,
    PackageResolutionContext,
);

const RESOLUTION_CACHE_CAPACITY: usize = 2_048;

#[derive(Clone, Default)]
pub struct PackageRouteResolver {
    // One cache identity is deliberately shared by CLI, Corsa, Maestro, and
    // persistent check-server consumers. A scoped reference cannot outlive
    // those independently owned sessions.
    #[expect(clippy::disallowed_types, reason = "shared across threads")]
    state: std::sync::Arc<std::sync::Mutex<PackageRouteResolverState>>,
}

#[derive(Default)]
struct PackageRouteResolverState {
    resolutions: FxHashMap<ResolutionKey, CachedPackageRouteLookup>,
    search: PackageSearchCache,
    canonical_paths: PackagePathCache,
    stamp_snapshots: InputStampCache,
    validation_epoch: u64,
    cache_hits: u64,
    cache_misses: u64,
    refresh_considered_routes: u64,
    refresh_affected_routes: u64,
    last_refresh_considered_routes: u64,
    last_refresh_affected_routes: u64,
    last_refresh_total_routes: u64,
    clock: u64,
    resolution_evictions: u64,
    reachability_checks: u64,
    reachability_budget_exceeded: u64,
    last_reachability_files: u64,
    last_reachability_bytes: u64,
    last_reachability_edges: u64,
    last_reachability_parses: u64,
    last_reachability_packages: u64,
}

struct CachedPackageRouteLookup {
    lookup: PackageRouteLookup,
    stamps: Vec<InputStamp>,
    qualified: bool,
    last_used: u64,
    last_validated_epoch: u64,
}

impl PackageRouteResolver {
    pub fn begin_validation_epoch(&mut self) {
        let mut state = self
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        state.validation_epoch = state.validation_epoch.wrapping_add(1).max(1);
        state.canonical_paths.clear();
        state.stamp_snapshots.clear();
        state.search.begin_validation_epoch();
    }

    /// Derive one importer occurrence context through the resolver-owned
    /// manifest cache. The returned inputs join the binding's reverse index.
    pub fn resolution_context(
        &mut self,
        importer: &Path,
        occurrence_mode: super::PackageResolutionMode,
        module_resolution: Option<&str>,
        module: Option<&str>,
        active_conditions: impl IntoIterator<Item = impl Into<String>>,
    ) -> (PackageResolutionContext, Vec<PathBuf>) {
        self.resolution_context_observed(
            importer,
            occurrence_mode,
            module_resolution,
            module,
            active_conditions,
        )
        .value
    }

    pub fn resolve(
        &mut self,
        importer_dir: &Path,
        specifier: &str,
        options: PackageSourceOptions,
    ) -> Option<PackageRoute> {
        self.lookup(importer_dir, specifier, options).route
    }

    /// Resolve a route while retaining every positive or negative filesystem
    /// input consulted. Editor caches and reverse indexes use these paths to
    /// observe a package link or manifest created after an unresolved open.
    pub fn lookup(
        &mut self,
        importer_dir: &Path,
        specifier: &str,
        options: PackageSourceOptions,
    ) -> PackageRouteLookup {
        self.lookup_with_context(importer_dir, specifier, options, Default::default())
    }

    pub fn lookup_with_context(
        &mut self,
        importer_dir: &Path,
        specifier: &str,
        options: PackageSourceOptions,
        context: PackageResolutionContext,
    ) -> PackageRouteLookup {
        self.lookup_with_context_observed(importer_dir, specifier, options, context)
            .value
    }

    pub fn clear(&mut self) {
        let mut state = self
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        state.resolutions.clear();
        state.search.clear();
        state.canonical_paths.clear();
        state.stamp_snapshots.clear();
        state.validation_epoch = 0;
        state.cache_hits = 0;
        state.cache_misses = 0;
        state.refresh_considered_routes = 0;
        state.refresh_affected_routes = 0;
        state.last_refresh_considered_routes = 0;
        state.last_refresh_affected_routes = 0;
        state.last_refresh_total_routes = 0;
        state.clock = 0;
        state.resolution_evictions = 0;
        state.reachability_checks = 0;
        state.reachability_budget_exceeded = 0;
        state.last_reachability_files = 0;
        state.last_reachability_bytes = 0;
        state.last_reachability_edges = 0;
        state.last_reachability_parses = 0;
        state.last_reachability_packages = 0;
    }

    #[cfg(feature = "native")]
    pub(crate) fn record_reachability_work(
        &mut self,
        files: usize,
        bytes: usize,
        edges: usize,
        parses: usize,
        packages: usize,
        budget_exceeded: bool,
    ) {
        let mut state = self
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        state.reachability_checks += 1;
        state.reachability_budget_exceeded += u64::from(budget_exceeded);
        state.last_reachability_files = files as u64;
        state.last_reachability_bytes = bytes as u64;
        state.last_reachability_edges = edges as u64;
        state.last_reachability_parses = parses as u64;
        state.last_reachability_packages = packages as u64;
    }

    #[cfg(feature = "native")]
    pub(crate) fn record_refresh_scope(
        &mut self,
        total: usize,
        considered: usize,
        affected: usize,
    ) {
        let mut state = self
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        state.refresh_considered_routes += considered as u64;
        state.refresh_affected_routes += affected as u64;
        state.last_refresh_considered_routes = considered as u64;
        state.last_refresh_affected_routes = affected as u64;
        state.last_refresh_total_routes = total as u64;
    }

    pub fn metrics(&self) -> PackageRouteMetrics {
        let state = self
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        PackageRouteMetrics {
            cache_hits: state.cache_hits,
            cache_misses: state.cache_misses,
            manifest_reads: state.search.manifest_reads(),
            refresh_considered_routes: state.refresh_considered_routes,
            refresh_affected_routes: state.refresh_affected_routes,
            last_refresh_considered_routes: state.last_refresh_considered_routes,
            last_refresh_affected_routes: state.last_refresh_affected_routes,
            last_refresh_total_routes: state.last_refresh_total_routes,
            resolution_cache_entries: state.resolutions.len() as u64,
            manifest_cache_entries: state.search.len() as u64,
            resolution_cache_evictions: state.resolution_evictions,
            manifest_cache_evictions: state.search.evictions(),
            reachability_checks: state.reachability_checks,
            reachability_budget_exceeded: state.reachability_budget_exceeded,
            last_reachability_files: state.last_reachability_files,
            last_reachability_bytes: state.last_reachability_bytes,
            last_reachability_edges: state.last_reachability_edges,
            last_reachability_parses: state.last_reachability_parses,
            last_reachability_packages: state.last_reachability_packages,
        }
    }

    #[cfg(test)]
    fn debug_validation_cache_counts(&self) -> (usize, usize, usize) {
        let state = self
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        (
            state.canonical_paths.len(),
            state.stamp_snapshots.len(),
            state.stamp_snapshots.captures(),
        )
    }
}

#[cfg(test)]
#[path = "cache_tests.rs"]
mod tests;
