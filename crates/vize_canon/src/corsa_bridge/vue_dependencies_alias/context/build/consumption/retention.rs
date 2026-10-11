//! Proof-bounded retirement after actual original owner operations.

use super::{FactRole, InputStamp, NativeFacts};
use std::{hash::BuildHasher, path::PathBuf};
use vize_carton::FxHashSet;

impl NativeFacts {
    /// Only actual callback completion releases contribution markers. Other
    /// importer facts survive until actual retirement or a cold rebuild.
    /// A visited target never grants source replacement or callback completion.
    #[cfg(test)]
    pub(in crate::corsa_bridge::vue_dependencies_alias::context) fn retain_previous(
        &mut self,
        stamps: &[InputStamp],
        completed_importers: &[PathBuf],
        replaced_sources: &[PathBuf],
        removed_sources: &[PathBuf],
    ) {
        self.retain_previous_with_deleted(
            stamps,
            completed_importers,
            replaced_sources,
            removed_sources,
            &[],
        );
    }

    #[cfg(test)]
    pub(in crate::corsa_bridge::vue_dependencies_alias::context) fn retain_previous_with_deleted(
        &mut self,
        stamps: &[InputStamp],
        completed_importers: &[PathBuf],
        replaced_sources: &[PathBuf],
        removed_sources: &[PathBuf],
        proven_deleted_sources: &[PathBuf],
    ) {
        self.retain_previous_with_validated_deleted(
            stamps,
            completed_importers,
            replaced_sources,
            removed_sources,
            proven_deleted_sources,
            &[],
        );
    }

    #[cfg(test)]
    pub(in crate::corsa_bridge::vue_dependencies_alias::context) fn retain_previous_with_validated_deleted(
        &mut self,
        stamps: &[InputStamp],
        completed_importers: &[PathBuf],
        replaced_sources: &[PathBuf],
        removed_sources: &[PathBuf],
        proven_deleted_sources: &[PathBuf],
        validated_probes: &[InputStamp],
    ) {
        self.retain_previous_with_completed_editor(
            stamps,
            (completed_importers, &[]),
            replaced_sources,
            removed_sources,
            proven_deleted_sources,
            validated_probes,
        );
    }

    pub(in crate::corsa_bridge::vue_dependencies_alias::context) fn retain_previous_with_completed_editor(
        &mut self,
        stamps: &[InputStamp],
        completed_importers: (&[PathBuf], &[PathBuf]),
        replaced_sources: &[PathBuf],
        removed_sources: &[PathBuf],
        proven_deleted_sources: &[PathBuf],
        validated_probes: &[InputStamp],
    ) {
        if !self.observe {
            return;
        }
        // Freeze the independent new resolver prefix before any preflight
        // carrier or old record is inserted. Carriers cannot self-authorize.
        let resolver_count = self.stamps.len();
        let deleted = proven_deleted_sources
            .iter()
            .cloned()
            .collect::<FxHashSet<_>>();
        for stamp in validated_probes {
            if let Some(expected) = stamp.expected_deleted_canonical_resolver_probe(&deleted)
                && self.contains_before(&expected, resolver_count)
            {
                self.insert(stamp.clone());
            }
        }
        let actual_count = self.stamps.len();
        let completed = completed_importers.0.iter().collect::<FxHashSet<_>>();
        let editors = completed_importers.1.iter().collect::<FxHashSet<_>>();
        let replaced = replaced_sources
            .iter()
            .chain(removed_sources)
            .collect::<FxHashSet<_>>();
        for stamp in stamps.iter().filter(|stamp| stamp.is_consumed_only()) {
            let Some(owner) = stamp.owner() else {
                self.qualified = false;
                self.insert(stamp.clone());
                continue;
            };
            let released = match owner.role {
                FactRole::Configuration => false,
                // Callback completion replaces its exact output membership;
                // it does not replace other shadow / rewrite observations.
                FactRole::LocalImporter => {
                    (completed.contains(&owner.path) && stamp.package_contribution().is_some())
                        || self.deleted_probe_was_actually_replaced(stamp, &deleted, actual_count)
                }
                // This exact original walk has replaced its whole edge/probe
                // scope. Shadow/rewrite observations retain LocalImporter.
                FactRole::DependencyImporter => {
                    completed.contains(&owner.path)
                        || self.deleted_probe_was_actually_replaced(stamp, &deleted, actual_count)
                }
                FactRole::EditorImporter => editors.contains(&owner.path),
                FactRole::AuthoredSource => replaced.contains(&owner.path),
            };
            if !released {
                self.insert(stamp.clone());
            }
        }
    }

    fn deleted_probe_was_actually_replaced(
        &self,
        old: &InputStamp,
        deleted: &FxHashSet<PathBuf>,
        actual_count: usize,
    ) -> bool {
        if !old.is_consumed_only() {
            return false;
        }
        let Some(expected) = old.expected_deleted_probe_replacement(deleted) else {
            return false;
        };
        self.contains_before(&expected, actual_count)
    }

    fn contains_before(&self, expected: &InputStamp, cutoff: usize) -> bool {
        let hash = self.by_hash.hasher().hash_one(expected);
        self.by_hash.get(&hash).is_some_and(|bucket| {
            bucket.iter().any(|index| {
                *index < cutoff
                    && self
                        .stamps
                        .get(*index)
                        .is_some_and(|current| current == expected)
            })
        })
    }
}

#[cfg(test)]
#[path = "tests/private_bucket.rs"]
mod private_bucket;
