//! Temporary consumed facts and actual edge-reconciliation completion.
use super::resolution;
use crate::package_route::stamp::Shared;
use crate::package_route::stamp::{Consumed, FactOwner, FactRole, InputStamp};
use std::path::{Path, PathBuf};
use vize_carton::FxHashMap;

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
            role: FactRole::DependencyImporter,
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
        overlays: &FxHashMap<PathBuf, &str>,
    ) -> bool {
        let packet = resolution::alias_may_reach_with_overlays_consumed(
            pattern,
            target,
            root,
            overlays,
            self.enabled,
        );
        if self.enabled {
            self.append(packet)
        } else {
            packet.value
        }
    }

    pub(super) fn probe_candidates(
        &mut self,
        path: &Path,
        overlays: &FxHashMap<PathBuf, &str>,
    ) -> Option<PathBuf> {
        let packet =
            resolution::probe_candidates_with_overlays_consumed(path, overlays, self.enabled);
        if self.enabled {
            self.append(packet)
        } else {
            packet.value
        }
    }

    #[expect(clippy::disallowed_types, reason = "dependency API uses std String")]
    pub(super) fn resolve_dependency(
        &mut self,
        specifier: &str,
        dir: &Path,
        root: &Path,
        aliases: &[(std::string::String, std::string::String)],
        overlays: &FxHashMap<PathBuf, &str>,
    ) -> Option<PathBuf> {
        let packet = resolution::resolve_dependency_with_overlays_consumed(
            specifier,
            dir,
            root,
            aliases,
            overlays,
            self.enabled,
        );
        if self.enabled {
            self.append(packet).0
        } else {
            packet.value.0
        }
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
mod tests;
