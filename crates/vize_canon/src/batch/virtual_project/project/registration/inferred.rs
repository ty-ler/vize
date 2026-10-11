//! Retain the original inferred registration's complete positive or negative result.

use super::{CorsaError, CorsaResult, Path, VirtualProject, empty, finish};
use crate::package_route::stamp::{Consumed, FactOwner, FactRole, InputStamp, Shared};

impl VirtualProject {
    pub(in crate::batch::virtual_project) fn register_inferred_path_observed(
        &mut self,
        path: &Path,
        content: Option<&str>,
        importer: Option<&Shared<FactOwner>>,
    ) -> Consumed<CorsaResult<()>> {
        let mut facts = empty(true);
        let result = match content {
            Some(content) => {
                Self::observe_registered_source(path, content, true, &mut facts);
                self.register_path_with_content_with_consumption(path, content, true, &mut facts)
                    .map(|_| ())
            }
            None => self.register_path_with_consumption(path, true, &mut facts),
        };
        if result.is_err() {
            // The original builder rejects readable non-program types through
            // this exact PathError branch. Its path classification is pure;
            // repeat no filesystem operation and invent no registered source.
            let unsupported = matches!(&result, Err(CorsaError::PathError { path: failed }) if failed == path)
                && path.extension().is_none_or(|extension| extension != "vue")
                && super::super::source_type_for_path(path).is_none()
                && self.find_by_original(path).is_none();
            let owner = importer.filter(|owner| {
                owner.role == FactRole::DependencyImporter
                    && owner.path.is_absolute()
                    && self.find_by_original(&owner.path).is_some()
            });
            facts.qualified &= unsupported && owner.is_some() && !facts.stamps.is_empty();
            if unsupported && let Some(owner) = owner {
                for stamp in &mut facts.stamps {
                    // The file was never registered. These actual consumed
                    // bytes belong to its requesting importer, not a fictitious
                    // authored-source node or a completed target walk.
                    if stamp.path() == path && stamp.is_authored_body_fact() {
                        *stamp = stamp.clone().with_owner(Shared::clone(owner));
                    } else {
                        facts.qualified = false;
                    }
                }
            }
            if let Err(CorsaError::Io(error)) = &result {
                let stamp = InputStamp::observed_read_failure(path.to_path_buf(), error.kind());
                facts.stamps.push(match importer {
                    Some(owner) => stamp.with_owner(Shared::clone(owner)),
                    None => stamp,
                });
            }
        }
        finish(facts, result)
    }
}

#[cfg(test)]
mod tests {
    use super::{FactOwner, FactRole, Shared, VirtualProject};

    #[test]
    fn absent_wrong_and_unregistered_importer_scopes_keep_the_actual_negative_cold() {
        for scope in 0..3 {
            let storage = tempfile::tempdir().unwrap();
            let root = storage.path().canonicalize().unwrap();
            let importer = root.join("Importer.ts");
            let asset = root.join("icon.svg");
            std::fs::write(&importer, "export {};\n").unwrap();
            std::fs::write(&asset, "<svg />\n").unwrap();
            let mut original = VirtualProject::new(&root).unwrap();
            let mut candidate = VirtualProject::new(&root).unwrap();
            for project in [&mut original, &mut candidate] {
                project.register_path(&importer).unwrap();
            }
            let owner = Shared::new(FactOwner {
                path: if scope == 2 {
                    root.join("Unknown.ts")
                } else {
                    importer
                },
                role: if scope == 1 {
                    FactRole::AuthoredSource
                } else {
                    FactRole::DependencyImporter
                },
            });
            let expected = original.register_path(&asset).unwrap_err();
            let actual = candidate.register_inferred_path_observed(
                &asset,
                None,
                (scope != 0).then_some(&owner),
            );
            assert!(!actual.qualified);
            assert_eq!(actual.value.unwrap_err().to_string(), expected.to_string());
            assert!(candidate.find_by_original(&asset).is_none());
            assert!(!actual.stamps.is_empty());
            assert!(
                actual
                    .stamps
                    .iter()
                    .all(|stamp| stamp.is_authored_body_fact())
            );
        }
    }

    #[test]
    fn successful_registration_keeps_its_complete_original_source_packet() {
        let storage = tempfile::tempdir().unwrap();
        let root = storage.path().canonicalize().unwrap();
        let source = root.join("Actual.ts");
        std::fs::write(&source, "export const actual = 1;\n").unwrap();
        let mut original = VirtualProject::new(&root).unwrap();
        let mut candidate = VirtualProject::new(&root).unwrap();
        let expected = original.register_path_observed(&source).unwrap();
        let actual = candidate.register_inferred_path_observed(&source, None, None);
        actual.value.unwrap();
        assert_eq!(actual.qualified, expected.qualified);
        assert_eq!(actual.stamps, expected.stamps);
        assert_eq!(
            candidate.registered_original_paths_sorted(),
            original.registered_original_paths_sorted()
        );
        assert_eq!(
            candidate.find_by_original(&source).unwrap().content,
            original.find_by_original(&source).unwrap().content
        );
    }
}
