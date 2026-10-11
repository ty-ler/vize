//! Preserve the shared resolver operation; pair only facts it actually consumed.

use super::super::stamp::{Consumed, InputStamp, stamp_paths, stamp_paths_with_cache};
use super::super::{logical_absolute, lookup_uncached_observed};
use super::{
    CachedPackageRouteLookup, PackageResolutionContext, PackageRouteLookup, PackageRouteResolver,
    PackageSourceOptions, RESOLUTION_CACHE_CAPACITY,
};
use std::path::Path;

impl PackageRouteResolver {
    pub(crate) fn lookup_with_context_observed(
        &mut self,
        importer_dir: &Path,
        specifier: &str,
        options: PackageSourceOptions,
        context: PackageResolutionContext,
    ) -> Consumed<PackageRouteLookup> {
        let mut state = self
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        // Key on the logical importer directory: resolution walks the logical
        // ancestors, so two importer directories that share a canonical path
        // through a package symlink still see different `node_modules` chains.
        let logical_importer_dir = logical_absolute(importer_dir);
        let key = (
            logical_importer_dir.clone(),
            specifier.into(),
            options,
            context,
        );
        let validation_epoch = state.validation_epoch;
        let cached_entry = state.resolutions.get(&key).map(|cached| {
            (
                cached.last_validated_epoch,
                cached.stamps.clone(),
                cached.lookup.clone(),
                cached.qualified,
            )
        });
        let cached = cached_entry.and_then(|(last_validated_epoch, stamps, lookup, qualified)| {
            let current = validation_epoch != 0 && last_validated_epoch == validation_epoch
                || if validation_epoch == 0 {
                    stamps.iter().all(InputStamp::route_cache_is_current)
                } else {
                    stamps.iter().all(|stamp| {
                        stamp.route_cache_is_current_with_cache(&mut state.stamp_snapshots)
                    })
                };
            if current {
                if validation_epoch != 0
                    && let Some(cached) = state.resolutions.get_mut(&key)
                {
                    cached.last_validated_epoch = validation_epoch;
                }
                Some(Consumed {
                    value: lookup,
                    stamps: stamps
                        .into_iter()
                        .filter(InputStamp::is_consumed_only)
                        .collect(),
                    qualified: importer_dir.is_absolute() && qualified,
                })
            } else {
                None
            }
        });
        if let Some(cached) = cached {
            state.clock = state.clock.wrapping_add(1);
            let clock = state.clock;
            if let Some(entry) = state.resolutions.get_mut(&key) {
                entry.last_used = clock;
            }
            state.cache_hits += 1;
            return cached;
        }
        state.cache_misses += 1;
        state.resolutions.remove(&key);
        if state.validation_epoch == 0 {
            state.canonical_paths.clear();
        }
        let mut canonical_paths = std::mem::take(&mut state.canonical_paths);
        let consumed = lookup_uncached_observed(
            &logical_importer_dir,
            specifier,
            options,
            &mut state.search,
            &mut canonical_paths,
        );
        state.canonical_paths = canonical_paths;
        let lookup = consumed.value;
        let mut stamps = if state.validation_epoch == 0 {
            stamp_paths(&lookup.invalidation_paths)
        } else {
            stamp_paths_with_cache(&lookup.invalidation_paths, &mut state.stamp_snapshots)
        };
        // The existing vector keeps original validation entries first; no
        // consumed fact is deduped or used to strengthen resolver freshness.
        let consumed_stamps = consumed.stamps;
        let qualified = importer_dir.is_absolute() && consumed.qualified;
        stamps.extend(consumed_stamps.iter().cloned());
        if state.resolutions.len() >= RESOLUTION_CACHE_CAPACITY {
            let oldest = state
                .resolutions
                .iter()
                .min_by_key(|(_, cached)| cached.last_used)
                .map(|(key, _)| key.clone());
            if let Some(oldest) = oldest {
                state.resolutions.remove(&oldest);
                state.resolution_evictions += 1;
            }
        }
        state.clock = state.clock.wrapping_add(1);
        let clock = state.clock;
        let validation_epoch = state.validation_epoch;
        state.resolutions.insert(
            key,
            CachedPackageRouteLookup {
                lookup: lookup.clone(),
                stamps,
                qualified,
                last_used: clock,
                last_validated_epoch: validation_epoch,
            },
        );
        Consumed {
            value: lookup,
            stamps: consumed_stamps,
            qualified,
        }
    }
}
