//! Native source exceptions require the actual validation result and owner.

use super::{FactRole, InputFact};
use crate::package_route::stamp::InputStamp;
use std::{io::ErrorKind, path::PathBuf};

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum SourceRevisionFact {
    Unchanged,
    AuthoredBody,
    DeletedBody,
    DeletedProbe,
    Incompatible,
}

impl InputStamp {
    /// Exact authored ownership is recorded by the original source operation.
    /// Generated text and filename classifications cannot establish it.
    pub(crate) fn is_authored_body_fact(&self) -> bool {
        matches!(self.fact, Some(InputFact::ConsumedBody(_)))
            && self.owner.as_ref().is_some_and(|owner| {
                owner.role == FactRole::AuthoredSource && owner.path == self.path
            })
    }

    pub(crate) fn has_non_not_found_read_failure(&self) -> bool {
        matches!(&self.fact, Some(InputFact::ReadFailure(kind)) if *kind != ErrorKind::NotFound)
    }

    /// Supplied bytes are authoritative only at the existing native caller's
    /// exact current host/overlay/requested-source lookup. No path inference
    /// or disk recapture can substitute for that lookup.
    pub(crate) fn current_consumed_fact_with_source(
        &self,
        supplied: Option<&[u8]>,
    ) -> Option<Self> {
        if let Some(body) = supplied
            && self.is_authored_body_fact()
        {
            let mut current = self.clone();
            current.fact = Some(InputFact::ConsumedBody(super::super::digest(body)));
            return Some(current);
        }
        self.current_consumed_fact()
    }

    /// This does not authorize reuse: the native owner must also prove known
    /// source membership, namespace/settings equality and complete replacement
    /// of every changed importer's facts through its original finished walk.
    pub(crate) fn source_revision_fact(
        &self,
        current: &Self,
        deleted_sources: &[PathBuf],
    ) -> SourceRevisionFact {
        if self.path != current.path || self.owner != current.owner {
            return SourceRevisionFact::Incompatible;
        }
        if self.fact == current.fact {
            return SourceRevisionFact::Unchanged;
        }
        let Some(owner) = self.owner.as_ref() else {
            return SourceRevisionFact::Incompatible;
        };
        if owner.role == FactRole::AuthoredSource && owner.path == self.path {
            match (&self.fact, &current.fact) {
                (Some(InputFact::ConsumedBody(_)), Some(InputFact::ConsumedBody(_))) => {
                    return SourceRevisionFact::AuthoredBody;
                }
                (
                    Some(InputFact::ConsumedBody(_)),
                    Some(InputFact::ReadFailure(ErrorKind::NotFound)),
                ) => return SourceRevisionFact::DeletedBody,
                _ => {}
            }
        }
        if (owner.role == FactRole::LocalImporter
            || (owner.role == FactRole::AuthoredSource && owner.path == self.path))
            && deleted_sources
                .iter()
                .any(|deleted| self.changed_only_by_deleted_target(current, deleted))
        {
            return SourceRevisionFact::DeletedProbe;
        }
        SourceRevisionFact::Incompatible
    }
}

#[cfg(test)]
mod tests {
    use super::{InputFact, SourceRevisionFact};
    use crate::package_route::stamp::{FactOwner, FactRole, InputStamp};
    use std::{
        io::ErrorKind,
        path::{Path, PathBuf},
        sync::Arc,
    };

    fn source(path: &Path, body: &[u8]) -> InputStamp {
        InputStamp::observed_source(path.to_path_buf(), body).with_owner(Arc::new(FactOwner {
            path: path.to_path_buf(),
            role: FactRole::AuthoredSource,
        }))
    }

    #[test]
    fn original_buffer_bytes_survive_a_different_disk_view_without_acknowledging_it() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("open.vue");
        std::fs::write(&path, "disk").unwrap();
        let stamp = source(&path, b"unsaved");
        let current = stamp
            .current_consumed_fact_with_source(Some(b"unsaved"))
            .unwrap();
        assert_eq!(
            stamp.source_revision_fact(&current, &[]),
            SourceRevisionFact::Unchanged
        );
        let disk = stamp.current_consumed_fact_with_source(None).unwrap();
        assert_eq!(
            stamp.source_revision_fact(&disk, &[]),
            SourceRevisionFact::AuthoredBody
        );
    }

    #[test]
    fn missing_closed_source_uses_the_original_validation_read_failure() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("closed.vue");
        std::fs::write(&path, "before").unwrap();
        let stamp = source(&path, b"before");
        std::fs::remove_file(&path).unwrap();
        let current = stamp.current_consumed_fact_with_source(None).unwrap();
        assert_eq!(
            stamp.source_revision_fact(&current, &[]),
            SourceRevisionFact::DeletedBody
        );
        // A genuinely current open buffer is not a deleted body.
        let open = stamp
            .current_consumed_fact_with_source(Some(b"new unsaved"))
            .unwrap();
        assert_eq!(
            stamp.source_revision_fact(&open, &[]),
            SourceRevisionFact::AuthoredBody
        );
    }

    #[test]
    fn configuration_and_unowned_bodies_cannot_use_source_exceptions() {
        let path = PathBuf::from("/exact/tsconfig.json");
        let unowned = InputStamp::observed_source(path.clone(), b"before");
        let current = unowned
            .current_consumed_fact_with_source(Some(b"after"))
            .unwrap();
        assert_eq!(
            unowned.source_revision_fact(&current, &[]),
            SourceRevisionFact::Incompatible
        );
        let configured = unowned.with_owner(Arc::new(FactOwner {
            path,
            role: FactRole::Configuration,
        }));
        let current = configured
            .current_consumed_fact_with_source(Some(b"after"))
            .unwrap();
        assert_eq!(
            configured.source_revision_fact(&current, &[]),
            SourceRevisionFact::Incompatible
        );
    }

    #[test]
    fn only_a_retained_importer_probe_can_follow_an_actual_deleted_body() {
        let target = PathBuf::from("/exact/target.vue");
        let probe = InputStamp::observed_canonical_file(target.clone(), target.clone(), true)
            .with_owner(Arc::new(FactOwner {
                path: PathBuf::from("/exact/importer.vue"),
                role: FactRole::LocalImporter,
            }));
        let mut current = probe.clone();
        current.fact = Some(InputFact::CanonicalFile {
            selected: target.clone(),
            is_file: false,
        });
        assert_eq!(
            probe.source_revision_fact(&current, &[]),
            SourceRevisionFact::Incompatible
        );
        assert_eq!(
            probe.source_revision_fact(&current, &[target]),
            SourceRevisionFact::DeletedProbe
        );
    }

    #[test]
    fn canonical_retarget_and_read_errors_refuse_the_deletion_exception() {
        let path = PathBuf::from("/exact/target.vue");
        let stamp = source(&path, b"before");
        for kind in [
            ErrorKind::PermissionDenied,
            ErrorKind::InvalidData,
            ErrorKind::IsADirectory,
        ] {
            let mut current = stamp.clone();
            current.fact = Some(InputFact::ReadFailure(kind));
            assert_eq!(
                stamp.source_revision_fact(&current, &[]),
                SourceRevisionFact::Incompatible
            );
        }
        let probe = InputStamp::observed_canonical_file(path.clone(), path.clone(), true)
            .with_owner(Arc::new(FactOwner {
                path: PathBuf::from("/exact/importer.vue"),
                role: FactRole::LocalImporter,
            }));
        let mut current = probe.clone();
        current.fact = Some(InputFact::CanonicalPath(PathBuf::from("/other/target.vue")));
        assert_eq!(
            probe.source_revision_fact(&current, &[path]),
            SourceRevisionFact::Incompatible
        );
    }

    #[test]
    fn own_file_predicate_requires_the_exact_deleted_body_and_rejects_creation() {
        let path = PathBuf::from("/exact/authored.vue");
        let stamp =
            InputStamp::observed_is_file(path.clone(), true).with_owner(Arc::new(FactOwner {
                path: path.clone(),
                role: FactRole::AuthoredSource,
            }));
        assert!(!stamp.is_authored_body_fact());
        let mut missing = stamp.clone();
        missing.fact = Some(InputFact::IsFile(false));
        assert_eq!(
            stamp.source_revision_fact(&missing, &[]),
            SourceRevisionFact::Incompatible
        );
        assert_eq!(
            stamp.source_revision_fact(&missing, &[path.clone()]),
            SourceRevisionFact::DeletedProbe
        );
        assert_eq!(
            missing.source_revision_fact(&stamp, &[path.clone()]),
            SourceRevisionFact::Incompatible
        );
        assert!(source(&path, b"actual source").is_authored_body_fact());
        let configured = source(&path, b"config").with_owner(Arc::new(FactOwner {
            path,
            role: FactRole::Configuration,
        }));
        assert!(!configured.is_authored_body_fact());
    }
}
