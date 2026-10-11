//! Consumed facts from the original operation, without a second observation.

use super::InputStamp;

#[cfg(any(feature = "native", test))]
pub(crate) mod membership;
use std::{
    path::{Path, PathBuf},
    sync::Arc,
};

/// Temporary metadata paired with an existing private operation's result.
/// Unknown facts cannot be recovered by a later filesystem capture.
pub(crate) struct Consumed<T> {
    pub(crate) value: T,
    pub(crate) stamps: Vec<InputStamp>,
    pub(crate) qualified: bool,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash)]
pub(crate) enum FactRole {
    Configuration,
    AuthoredSource,
    LocalImporter,
}

/// One owner value is shared by facts emitted by the same original operation.
/// Full path/role equality is required; pointer identity is never authority.
#[derive(Debug, Eq, PartialEq, Hash)]
pub(crate) struct FactOwner {
    pub(crate) path: PathBuf,
    pub(crate) role: FactRole,
}

#[derive(Clone, Debug, Eq, PartialEq, Hash)]
pub(super) enum InputFact {
    #[cfg(any(feature = "native", test))]
    PackageContribution(membership::PackageContribution),
    Exists(bool),
    TryExists(Result<bool, std::io::ErrorKind>),
    IsFile(bool),
    CanonicalPath(PathBuf),
    ConsumedBody(u64),
    ReadFailure(std::io::ErrorKind),
    MetadataLen(Result<u64, std::io::ErrorKind>),
    CanonicalFile {
        selected: PathBuf,
        is_file: bool,
    },
}

impl InputStamp {
    pub(crate) fn observed_source(path: PathBuf, body: &[u8]) -> Self {
        Self::observed_predicate(path, InputFact::ConsumedBody(super::digest(body)))
    }

    /// Record the error returned by the original UTF-8 read itself. This
    /// cannot be substituted with a later existence or file predicate.
    pub(crate) fn observed_read_failure(path: PathBuf, kind: std::io::ErrorKind) -> Self {
        Self::observed_predicate(path, InputFact::ReadFailure(kind))
    }

    /// Only the length or error kind consumed by the original metadata call.
    /// This records supplied data and makes no new filesystem observation.
    pub(crate) fn observed_metadata_len(
        path: PathBuf,
        result: Result<u64, std::io::ErrorKind>,
    ) -> Self {
        Self::observed_predicate(path, InputFact::MetadataLen(result))
    }

    pub(crate) fn observed_exists(path: PathBuf, exists: bool) -> Self {
        Self::observed_predicate(path, InputFact::Exists(exists))
    }

    /// Exact supplied result of the original try_exists call; no observation.
    pub(crate) fn observed_try_exists(
        path: PathBuf,
        result: Result<bool, std::io::ErrorKind>,
    ) -> Self {
        Self::observed_predicate(path, InputFact::TryExists(result))
    }

    pub(crate) fn observed_is_file(path: PathBuf, is_file: bool) -> Self {
        Self::observed_predicate(path, InputFact::IsFile(is_file))
    }

    pub(crate) fn observed_canonical_path(path: PathBuf, selected: PathBuf) -> Self {
        Self::observed_predicate(path, InputFact::CanonicalPath(selected))
    }

    pub(crate) fn observed_canonical_file(path: PathBuf, selected: PathBuf, is_file: bool) -> Self {
        Self::observed_predicate(path, InputFact::CanonicalFile { selected, is_file })
    }

    fn observed_predicate(path: PathBuf, fact: InputFact) -> Self {
        Self {
            path,
            modified: None,
            len: None,
            kind: None,
            content_digest: None,
            symlink_target: None,
            source_content: false,
            fact: Some(fact),
            owner: None,
            consumed_only: true,
        }
    }

    pub(crate) fn with_owner(mut self, owner: Arc<FactOwner>) -> Self {
        self.owner = Some(owner);
        self
    }

    pub(crate) fn owner(&self) -> Option<&FactOwner> {
        self.owner.as_deref()
    }

    /// Ownership describes replacement, rather than the filesystem fact.
    pub(super) fn same_observation(&self, mut current: Self) -> bool {
        current.owner.clone_from(&self.owner);
        current.fact.clone_from(&self.fact);
        current.consumed_only = self.consumed_only;
        *self == current
    }

    pub(super) fn fact_is_current(&self) -> bool {
        self.current_consumed_fact()
            .is_some_and(|current| current.fact == self.fact)
    }

    /// Return the actual fact from this one validation operation. A caller
    /// must use this returned value for an exception decision; it cannot
    /// recapture a later fact and call that the validation result.
    pub(crate) fn current_consumed_fact(&self) -> Option<Self> {
        let fact = match self.fact.as_ref()? {
            #[cfg(any(feature = "native", test))]
            InputFact::PackageContribution(_) => return Some(self.clone()),
            InputFact::Exists(_) => InputFact::Exists(self.path.exists()),
            InputFact::TryExists(_) => {
                InputFact::TryExists(self.path.try_exists().map_err(|error| error.kind()))
            }
            InputFact::IsFile(_) => InputFact::IsFile(self.path.is_file()),
            InputFact::CanonicalPath(_) => {
                InputFact::CanonicalPath(vize_carton::path::canonicalize_non_verbatim(&self.path))
            }
            InputFact::ConsumedBody(_) => match std::fs::read(&self.path) {
                Ok(body) => InputFact::ConsumedBody(super::digest(&body)),
                Err(error) => InputFact::ReadFailure(error.kind()),
            },
            InputFact::ReadFailure(_) => match std::fs::read_to_string(&self.path) {
                Ok(body) => InputFact::ConsumedBody(super::digest(body.as_bytes())),
                Err(error) => InputFact::ReadFailure(error.kind()),
            },
            InputFact::MetadataLen(_) => InputFact::MetadataLen(
                std::fs::metadata(&self.path)
                    .map(|metadata| metadata.len())
                    .map_err(|error| error.kind()),
            ),
            InputFact::CanonicalFile { selected: old, .. } => {
                let selected = vize_carton::path::canonicalize_non_verbatim(&self.path);
                if selected != *old {
                    // Preserve the original short circuit: a retargeted
                    // identity was refused before the is_file predicate.
                    InputFact::CanonicalPath(selected)
                } else {
                    let is_file = selected.is_file();
                    InputFact::CanonicalFile { selected, is_file }
                }
            }
        };
        let mut current = self.clone();
        current.fact = Some(fact);
        Some(current)
    }

    /// Preserve the resolver's original metadata validation, including its
    /// inherited freshness boundaries. Consumed-only facts cannot strengthen it.
    pub(crate) fn route_cache_is_current(&self) -> bool {
        self.consumed_only
            || self.same_observation(Self::capture_input(
                self.path.clone(),
                None,
                self.source_content,
            ))
    }

    pub(crate) fn route_cache_is_current_with_cache(
        &self,
        cache: &mut super::InputStampCache,
    ) -> bool {
        if self.consumed_only {
            return true;
        }
        if self.source_content {
            return self.route_cache_is_current();
        }
        self.same_observation(cache.capture(&self.path))
    }

    /// Attach the original read's body without replacing the original validator.
    pub(crate) fn with_consumed_source(mut self, body: &[u8]) -> Self {
        self.fact = Some(InputFact::ConsumedBody(super::digest(body)));
        self
    }

    /// Retain the error kind from the original read without changing metadata.
    pub(crate) fn with_consumed_read_failure(mut self, kind: std::io::ErrorKind) -> Self {
        self.fact = Some(InputFact::ReadFailure(kind));
        self
    }

    pub(crate) fn retained_consumed_source(&self) -> Option<Self> {
        match self.fact.as_ref() {
            Some(fact @ (InputFact::ConsumedBody(_) | InputFact::ReadFailure(_))) => {
                let mut source = Self::observed_predicate(self.path.clone(), fact.clone());
                source.owner.clone_from(&self.owner);
                Some(source)
            }
            _ => None,
        }
    }

    /// Borrow only a selection returned by an original canonical operation.
    /// This performs no new observation and does not grant freshness itself.
    #[cfg(any(feature = "native", test))]
    pub(crate) fn consumed_canonical_selection(&self) -> Option<(&Path, &Path)> {
        match self.fact.as_ref()? {
            InputFact::CanonicalPath(selected) if self.consumed_only => {
                Some((&self.path, selected))
            }
            _ => None,
        }
    }

    pub(crate) fn is_consumed_only(&self) -> bool {
        self.consumed_only
    }

    /// An expected lookup key only, never an observation or authority grant.
    /// The caller must find this exact key among new actual operation records.
    pub(crate) fn expected_deleted_probe_replacement(
        &self,
        deleted: &vize_carton::FxHashSet<PathBuf>,
    ) -> Option<Self> {
        let fact = match self.fact.as_ref()? {
            InputFact::CanonicalFile {
                selected,
                is_file: true,
            } if deleted.contains(selected) => InputFact::CanonicalFile {
                selected: selected.clone(),
                is_file: false,
            },
            InputFact::IsFile(true) if deleted.contains(&self.path) => InputFact::IsFile(false),
            _ => return None,
        };
        let mut expected = self.clone();
        expected.fact = Some(fact);
        Some(expected)
    }

    /// A lookup key for an independent resolver result, never an observation.
    /// Only an actual preflight canonical false record may use this key.
    pub(crate) fn expected_deleted_canonical_resolver_probe(
        &self,
        deleted: &vize_carton::FxHashSet<PathBuf>,
    ) -> Option<Self> {
        if !self.consumed_only || self.owner()?.role != FactRole::LocalImporter {
            return None;
        }
        match self.fact.as_ref()? {
            InputFact::CanonicalFile {
                selected,
                is_file: false,
            } if deleted.contains(selected) => {}
            _ => return None,
        }
        let mut expected = self.clone();
        expected.fact = Some(InputFact::IsFile(false));
        Some(expected)
    }

    /// `current` is the fact returned by the original validation operation.
    /// This is only a pre-patch exception; a completed owner and current final
    /// facts are still required. Retargeted canonical identities always refuse.
    pub(crate) fn changed_only_by_deleted_target(&self, current: &Self, deleted: &Path) -> bool {
        if self.path != current.path {
            return false;
        }
        match (self.fact.as_ref(), current.fact.as_ref()) {
            (
                Some(InputFact::CanonicalFile {
                    selected,
                    is_file: true,
                }),
                Some(InputFact::CanonicalFile {
                    selected: now,
                    is_file: false,
                }),
            ) => selected == deleted && now == selected,
            (Some(InputFact::IsFile(true)), Some(InputFact::IsFile(false))) => self.path == deleted,
            _ => false,
        }
    }
}

mod native;
pub(crate) use native::SourceRevisionFact;

#[cfg(test)]
mod tests;

#[cfg(test)]
mod cache_preservation_tests;

#[cfg(test)]
mod validation_tests;

#[cfg(test)]
mod metadata_tests;

#[cfg(test)]
mod try_exists_tests;
