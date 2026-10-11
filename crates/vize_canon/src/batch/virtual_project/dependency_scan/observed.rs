//! Temporary consumed facts and actual edge-reconciliation completion.
use super::resolution;
use crate::package_route::stamp::Shared;
use crate::package_route::stamp::{Consumed, FactOwner, FactRole, InputStamp};
use std::path::{Path, PathBuf};

pub(super) struct WalkFacts {
    enabled: bool,
    stamps: Vec<InputStamp>,
    completed: Vec<PathBuf>,
    qualified: bool,
    namespace: Option<Shared<FactOwner>>,
    owner: Option<Shared<FactOwner>>,
}

impl WalkFacts {
    pub(super) fn disabled() -> Self {
        Self {
            enabled: false,
            stamps: Vec::new(),
            completed: Vec::new(),
            qualified: false,
            namespace: None,
            owner: None,
        }
    }

    #[expect(clippy::disallowed_types, reason = "dependency API uses std String")]
    pub(super) fn from_aliases(
        aliases: Consumed<Vec<(std::string::String, std::string::String)>>,
        root: &Path,
    ) -> (Vec<(std::string::String, std::string::String)>, Self) {
        let namespace = Shared::new(FactOwner {
            path: root.to_path_buf(),
            role: FactRole::Configuration,
        });
        (
            aliases.value,
            Self {
                enabled: true,
                stamps: aliases
                    .stamps
                    .into_iter()
                    .map(|stamp| {
                        if stamp.owner().is_none() {
                            stamp.with_owner(Shared::clone(&namespace))
                        } else {
                            stamp
                        }
                    })
                    .collect(),
                completed: Vec::new(),
                qualified: aliases.qualified,
                namespace: Some(Shared::clone(&namespace)),
                owner: Some(namespace),
            },
        )
    }

    pub(super) fn unknown(&mut self) {
        self.qualified = false;
    }

    pub(super) fn unknown_at(&mut self, reason: u8) {
        if self.qualified {
            crate::corsa_bridge::preparation_trace::Phase::native_fact_guard(
                reason,
                self.stamps.len(),
            );
        }
        self.unknown();
    }

    fn append<T>(&mut self, consumed: Consumed<T>) -> T {
        if self.qualified && !consumed.qualified {
            crate::corsa_bridge::preparation_trace::Phase::native_fact_guard(
                80,
                consumed.stamps.len(),
            );
        }
        self.qualified &= consumed.qualified;
        self.stamps.extend(
            consumed
                .stamps
                .into_iter()
                .map(|stamp| match self.owner.as_ref() {
                    Some(owner) if stamp.owner().is_none() => {
                        stamp.with_owner(Shared::clone(owner))
                    }
                    _ => stamp,
                }),
        );
        consumed.value
    }

    pub(super) fn package_result(&mut self, result: Consumed<bool>) -> bool {
        self.append(result)
    }

    pub(super) fn registration(&mut self, result: Consumed<()>) {
        if self.qualified && !result.qualified {
            crate::corsa_bridge::preparation_trace::Phase::native_fact_guard(
                81,
                result.stamps.len(),
            );
        }
        self.qualified &= result.qualified;
        // Source/index canonical observations are already owned by the actual
        // registered source; the current importer must not take their identity.
        self.stamps.extend(result.stamps);
    }

    pub(super) fn registered_roots<T>(&mut self, roots: &Consumed<T>) {
        if self.enabled {
            self.qualified &= roots.qualified;
            // These facts already have the actual binding/source owner from
            // the original registration operation, not the current importer.
            self.stamps.extend(roots.stamps.iter().cloned());
        }
    }

    pub(super) fn begin_importer(&mut self, path: &Path, original: Option<&[u8]>) {
        if !self.enabled {
            return;
        }
        self.owner = Some(Shared::new(FactOwner {
            path: path.to_path_buf(),
            role: FactRole::LocalImporter,
        }));
        let Some(body) = original else {
            self.unknown_at(77);
            return;
        };
        self.stamps.push(
            InputStamp::observed_source(path.to_path_buf(), body).with_owner(Shared::new(
                FactOwner {
                    path: path.to_path_buf(),
                    role: FactRole::AuthoredSource,
                },
            )),
        );
    }

    pub(super) fn complete(&mut self, importer: &Path) {
        if self.enabled {
            self.completed.push(importer.to_path_buf());
        }
        self.owner.clone_from(&self.namespace);
    }

    /// The caller checks an actual registered original before this SAME key operation.
    /// This source identity grants neither a body nor importer completion.
    pub(super) fn registered_key(&mut self, path: &Path, registered: bool) -> Option<PathBuf> {
        if !self.enabled {
            return resolution::canonical_key(path);
        }
        if !registered {
            self.unknown_at(78);
            return self.canonical_key(path);
        }
        let previous = self.owner.replace(Shared::new(FactOwner {
            path: path.to_path_buf(),
            role: FactRole::AuthoredSource,
        }));
        let key = self.canonical_key(path);
        self.owner = previous;
        key
    }

    pub(super) fn canonical_key(&mut self, path: &Path) -> Option<PathBuf> {
        if !self.enabled {
            return resolution::canonical_key(path);
        }
        self.append(resolution::canonical_key_observed(path))
    }

    pub(super) fn alias_may_reach_first_party(
        &mut self,
        pattern: &str,
        target: &str,
        root: &Path,
    ) -> bool {
        if !self.enabled {
            return resolution::alias_may_reach_first_party(pattern, target, root);
        }
        self.append(resolution::alias_may_reach_first_party_observed(
            pattern, target, root,
        ))
    }

    pub(super) fn probe_candidates(&mut self, path: &Path) -> Option<PathBuf> {
        if !self.enabled {
            return resolution::probe_candidates(path);
        }
        self.append(resolution::probe_candidates_observed(path))
    }

    #[expect(clippy::disallowed_types, reason = "dependency API uses std String")]
    pub(super) fn resolve_dependency(
        &mut self,
        specifier: &str,
        dir: &Path,
        root: &Path,
        aliases: &[(std::string::String, std::string::String)],
    ) -> Option<PathBuf> {
        if !self.enabled {
            return resolution::resolve_dependency(specifier, dir, root, aliases);
        }
        self.append(resolution::resolve_dependency_observed(
            specifier, dir, root, aliases,
        ))
        .0
    }

    pub(super) fn finish(self) -> Consumed<Vec<PathBuf>> {
        Consumed {
            value: self.completed,
            stamps: self.stamps,
            qualified: self.qualified,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{Consumed, FactOwner, FactRole, InputStamp, WalkFacts};
    use std::{io::ErrorKind, path::Path, sync::Arc};

    fn owned_facts() -> Vec<InputStamp> {
        vec![
            InputStamp::observed_source("/owned/tsconfig.json".into(), b"configuration")
                .with_owner(Arc::new(FactOwner {
                    path: "/owned/configuration".into(),
                    role: FactRole::Configuration,
                })),
            InputStamp::observed_source("/owned/source.ts".into(), b"authored").with_owner(
                Arc::new(FactOwner {
                    path: "/owned/source.ts".into(),
                    role: FactRole::AuthoredSource,
                }),
            ),
            InputStamp::observed_canonical_file(
                "/owned/probe.ts".into(),
                "/owned/selected.ts".into(),
                true,
            )
            .with_owner(Arc::new(FactOwner {
                path: "/owned/importer.vue".into(),
                role: FactRole::LocalImporter,
            })),
        ]
    }

    #[test]
    fn aliases_preserve_complete_owned_facts_and_default_only_unowned_facts() {
        let root = Path::new("/current/project");
        let aliases = vec![("@/*".into(), "./src/*".into())];
        let mut input = owned_facts();
        let unowned = InputStamp::observed_read_failure(
            "/current/missing-config.json".into(),
            ErrorKind::NotFound,
        );
        input.push(unowned.clone());
        let mut expected = owned_facts();
        expected.push(unowned.with_owner(Arc::new(FactOwner {
            path: root.to_path_buf(),
            role: FactRole::Configuration,
        })));
        for qualified in [true, false] {
            let (actual_aliases, facts) = WalkFacts::from_aliases(
                Consumed {
                    value: aliases.clone(),
                    stamps: input.clone(),
                    qualified,
                },
                root,
            );
            assert_eq!(actual_aliases, aliases);
            let result = facts.finish();
            assert_eq!(result.stamps, expected);
            assert_eq!(result.qualified, qualified);
            assert!(result.value.is_empty());
        }
    }

    #[test]
    fn importer_append_preserves_complete_owned_facts_order_and_qualification() {
        let root = Path::new("/current/project");
        let importer = Path::new("/current/importer.vue");
        let (_, mut facts) = WalkFacts::from_aliases(
            Consumed {
                value: Vec::new(),
                stamps: Vec::new(),
                qualified: true,
            },
            root,
        );
        facts.begin_importer(importer, Some(b"actual authored importer"));
        let mut input = owned_facts();
        let unowned = InputStamp::observed_is_file("/current/target.ts".into(), false);
        input.push(unowned.clone());
        assert!(facts.package_result(Consumed {
            value: true,
            stamps: input,
            qualified: false,
        }));
        facts.complete(importer);
        let after = InputStamp::observed_exists("/current/package.json".into(), false);
        assert!(!facts.package_result(Consumed {
            value: false,
            stamps: vec![after.clone()],
            qualified: true,
        }));
        let mut expected = vec![
            InputStamp::observed_source(importer.to_path_buf(), b"actual authored importer")
                .with_owner(Arc::new(FactOwner {
                    path: importer.to_path_buf(),
                    role: FactRole::AuthoredSource,
                })),
        ];
        expected.extend(owned_facts());
        expected.push(unowned.with_owner(Arc::new(FactOwner {
            path: importer.to_path_buf(),
            role: FactRole::LocalImporter,
        })));
        expected.push(after.with_owner(Arc::new(FactOwner {
            path: root.to_path_buf(),
            role: FactRole::Configuration,
        })));
        let result = facts.finish();
        assert_eq!(result.stamps, expected);
        assert_eq!(result.value, vec![importer.to_path_buf()]);
        assert!(!result.qualified);
    }

    #[test]
    fn disabled_append_keeps_complete_facts_without_inventing_an_owner() {
        let mut facts = WalkFacts::disabled();
        let mut input = owned_facts();
        input.push(InputStamp::observed_metadata_len(
            "/unowned/input.json".into(),
            Ok(17),
        ));
        assert_eq!(
            facts.append(Consumed {
                value: 17,
                stamps: input.clone(),
                qualified: true,
            }),
            17
        );
        let result = facts.finish();
        assert_eq!(result.stamps, input);
        assert!(result.value.is_empty());
        assert!(!result.qualified);
    }
}
