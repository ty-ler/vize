//! Only authored-source revisions may take ownership of a cached graph.

use std::path::{Path, PathBuf};

use vize_carton::{FxHashMap, FxHashSet};

use super::{ContextFingerprint, consumed};
use crate::corsa_bridge::vue_dependencies_alias::AliasContext;

#[derive(Debug, PartialEq, Eq)]
pub(in crate::corsa_bridge::vue_dependencies_alias::context) enum SourceGuard {
    Settings,
    RequestedSources,
    ClosedOverlay,
    AddedOverlay,
    Configuration,
    PackageInput,
    ResolutionInput,
    UnknownAuthority,
}

#[cfg(test)]
mod tests {
    use super::super::consumed::refusal_tests::source_change_fixture;
    use super::SourceGuard;
    use vize_carton::FxHashMap;

    #[test]
    fn requested_root_removal_and_package_input_exception_require_actual_deleted_body() {
        for mode in 0..7 {
            let (_storage, host, target, context, mut old) = source_change_fixture();
            let mut current = old.clone();
            if mode != 6 {
                current.requested_paths.clear();
            }
            let mut overlays = FxHashMap::default();
            let mut requested = Vec::new();
            if mode != 1 {
                std::fs::remove_file(&target).unwrap();
            }
            match mode {
                2 => {
                    overlays.insert(target.clone(), "still open");
                    current.overlay_paths.push(target.clone());
                }
                3 => {
                    std::fs::create_dir(&target).unwrap();
                }
                4 => {
                    old.consumed_inputs_qualified = false;
                }
                5 => {
                    requested.push((target.clone(), "still requested"));
                }
                6 => {
                    requested.push((target.clone(), "still requested"));
                }
                _ => {}
            }
            let result =
                old.source_changes(&current, &context, &overlays, &host, b"host", &requested);
            if mode == 0 {
                let changes = result.unwrap();
                assert_eq!(changes.changed, vec![target.clone()]);
                assert_eq!(changes.deleted, vec![target]);
            } else {
                let expected = match mode {
                    1 | 2 => SourceGuard::RequestedSources,
                    3 | 6 => SourceGuard::PackageInput,
                    _ => SourceGuard::UnknownAuthority,
                };
                assert_eq!(result.unwrap_err(), expected);
            }
        }
    }

    #[test]
    fn requested_additions_duplicate_shifts_and_uncertain_exact_identities_stay_cold() {
        for mode in 0..3 {
            let (_storage, host, target, context, mut old) = source_change_fixture();
            let mut current = old.clone();
            let requested = match mode {
                0 => {
                    current.requested_paths.push(host.clone());
                    current.requested_paths.sort();
                    vec![(host.clone(), "host"), (target.clone(), "target")]
                }
                1 => {
                    old.requested_paths.push(target.clone());
                    vec![(target.clone(), "target")]
                }
                _ => {
                    let uncertain = target.parent().unwrap().join("logical/../target.ts");
                    std::fs::create_dir(target.parent().unwrap().join("logical")).unwrap();
                    assert_eq!(
                        vize_carton::path::canonicalize_non_verbatim(&uncertain),
                        target
                    );
                    old.requested_paths = vec![uncertain.clone()];
                    current.requested_paths = old.requested_paths.clone();
                    vec![(uncertain, "target")]
                }
            };
            let expected = if mode == 2 {
                SourceGuard::UnknownAuthority
            } else {
                SourceGuard::RequestedSources
            };
            assert_eq!(
                old.source_changes(
                    &current,
                    &context,
                    &FxHashMap::default(),
                    &host,
                    b"host",
                    &requested
                )
                .unwrap_err(),
                expected
            );
        }
        assert_eq!(SourceGuard::UnknownAuthority.code(), 12);
    }
}

impl SourceGuard {
    pub(in crate::corsa_bridge::vue_dependencies_alias::context) fn code(&self) -> u8 {
        match self {
            Self::Settings => 1,
            Self::RequestedSources => 2,
            Self::ClosedOverlay => 3,
            Self::AddedOverlay => 4,
            Self::Configuration => 5,
            Self::PackageInput => 6,
            Self::ResolutionInput => 7,
            // Existing cache takeover guards retain numeric codes 8 through 11.
            Self::UnknownAuthority => 12,
        }
    }
}

impl ContextFingerprint {
    pub(in crate::corsa_bridge::vue_dependencies_alias::context) fn source_changes(
        &self,
        current: &Self,
        context: &AliasContext,
        overlays: &FxHashMap<PathBuf, &str>,
        source_path: &Path,
        source_body: &[u8],
        requested: &[(PathBuf, &str)],
    ) -> Result<consumed::SourceChanges, SourceGuard> {
        if self.generation_options != current.generation_options {
            return Err(SourceGuard::Settings);
        }
        if current
            .requested_paths
            .iter()
            .any(|path| !self.requested_paths.contains(path))
        {
            return Err(SourceGuard::RequestedSources);
        }
        let mirror = context.mirror.as_ref().ok_or(SourceGuard::Settings)?;
        let known = mirror
            .registered_original_paths_sorted()
            .into_iter()
            .collect::<FxHashSet<_>>();
        let configurations = mirror
            .governing_config_paths()
            .into_iter()
            .collect::<FxHashSet<_>>();
        // A closed existing buffer must return to disk through the cold path.
        // A deleted known source, however, can release its old graph owners.
        for path in &self.overlay_paths {
            if !overlays.contains_key(path) && (path.is_file() || !known.contains(path)) {
                return Err(SourceGuard::ClosedOverlay);
            }
        }
        if current
            .overlay_paths
            .iter()
            .any(|path| !self.overlay_paths.contains(path) && !known.contains(path))
        {
            return Err(SourceGuard::AddedOverlay);
        }
        // Requested registration canonicalizes its keys in the cold producer.
        // This guard has no such operation: uncertain identities remain cold.
        let mut requested_paths = requested
            .iter()
            .map(|(path, _)| path.clone())
            .collect::<Vec<_>>();
        requested_paths.sort();
        if requested_paths != current.requested_paths
            || requested_paths.iter().any(|path| !known.contains(path))
        {
            return Err(SourceGuard::UnknownAuthority);
        }
        let inputs = consumed::AuthoredInputs {
            host_path: source_path,
            host_body: source_body,
            overlays,
            requested,
        };
        let validated = consumed::validate(
            &self.stamps,
            self.consumed_inputs_qualified,
            &known,
            &inputs,
        )
        .map_err(|refusal| {
            #[cfg(test)]
            if let consumed::Refusal::ChangedFact(path) = &refusal {
                let original = self
                    .stamps
                    .iter()
                    .filter(|stamp| stamp.path() == path)
                    .collect::<Vec<_>>();
                eprintln!(
                    "original native fact refusal: {refusal:?}; returned facts: {original:?}"
                );
            }
            match refusal {
                consumed::Refusal::UnknownAuthority => SourceGuard::UnknownAuthority,
                consumed::Refusal::ChangedFact(path) if configurations.contains(&path) => {
                    SourceGuard::Configuration
                }
                consumed::Refusal::ChangedFact(path) if context.route_inputs.contains(&path) => {
                    SourceGuard::PackageInput
                }
                consumed::Refusal::ChangedFact(_) => SourceGuard::ResolutionInput,
            }
        })?;
        let mut changes = validated.value;
        // Supplied package bodies are also route inputs. Their changed body
        // must use the complete cold producer even when disk metadata stayed
        // current; only actual validated deletions have a narrow exception.
        if changes
            .changed
            .iter()
            .any(|path| context.route_inputs.contains(path) && !changes.deleted.contains(path))
        {
            return Err(SourceGuard::PackageInput);
        }
        // Only actual missing authored bodies can remove old requested roots.
        // Surviving duplicate counts and all other membership shifts stay cold.
        let retained_requested = self
            .requested_paths
            .iter()
            .filter(|path| !changes.deleted.contains(path))
            .collect::<Vec<_>>();
        if retained_requested != current.requested_paths.iter().collect::<Vec<_>>()
            || changes.deleted.iter().any(|path| {
                path == source_path
                    || overlays.contains_key(path)
                    || requested.iter().any(|(supplied, _)| supplied == path)
            })
        {
            return Err(SourceGuard::RequestedSources);
        }
        let mut observed = crate::package_route::stamp::InputStampCache::default();
        for stamp in &self.stamps {
            if stamp.is_consumed_only() {
                continue;
            }
            if stamp.is_current_with_cache(&mut observed) {
                continue;
            }
            let path = stamp.path();
            // Missing probes, higher-priority companions, configs and package
            // inputs still invalidate the complete producer. Never turn a
            // newly created resolution target into a silently reused graph.
            if configurations.contains(path) {
                return Err(SourceGuard::Configuration);
            }
            if context
                .route_inputs
                .iter()
                .any(|input| input.as_path() == path)
                && !(known.contains(path) && changes.deleted.iter().any(|deleted| deleted == path))
            {
                return Err(SourceGuard::PackageInput);
            }
            let source = if known.contains(path) {
                path
            } else {
                let mut selected = None;
                for fact in &validated.stamps {
                    let Some((logical, target, true)) = fact.consumed_canonical_file_selection()
                    else {
                        continue;
                    };
                    let Some(owner) = fact.owner() else {
                        continue;
                    };
                    if logical != path
                        || !known.contains(target)
                        || !known.contains(&owner.path)
                        || !matches!(
                            owner.role,
                            crate::package_route::stamp::FactRole::LocalImporter
                                | crate::package_route::stamp::FactRole::DependencyImporter
                        )
                    {
                        continue;
                    }
                    if selected.is_some_and(|previous| previous != target) {
                        return Err(SourceGuard::ResolutionInput);
                    }
                    selected = Some(target);
                }
                selected.ok_or(SourceGuard::ResolutionInput)?
            };
            changes.changed.push(source.to_path_buf());
        }
        changes.changed.sort();
        changes.changed.dedup();
        Ok(changes)
    }
}
