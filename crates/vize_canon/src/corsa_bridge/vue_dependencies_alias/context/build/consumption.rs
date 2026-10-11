//! Operation-local facts for the existing native project construction.

use crate::package_route::stamp::Shared;
use crate::package_route::stamp::{Consumed, FactOwner, FactRole, InputStamp};
use std::{
    hash::{Hash, Hasher},
    path::{Path, PathBuf},
};
use vize_carton::{FxHashMap, FxHashSet};

/// This is a temporary return carrier, never another resolver/cache owner.
pub(in crate::corsa_bridge::vue_dependencies_alias::context) struct NativeFacts {
    observe: bool,
    qualified: bool,
    stamps: Vec<InputStamp>,
    by_hash: FxHashMap<u64, Vec<usize>>,
}

impl NativeFacts {
    pub(in crate::corsa_bridge::vue_dependencies_alias::context) fn new(observe: bool) -> Self {
        Self {
            observe,
            qualified: observe,
            stamps: Vec::new(),
            by_hash: FxHashMap::default(),
        }
    }

    pub(in crate::corsa_bridge::vue_dependencies_alias::context) fn incomplete(&mut self) {
        self.qualified = false;
    }

    /// Every original operation still runs. Only exactly identical complete
    /// facts coalesce; a different A/B value or owner remains a separate guard.
    fn insert(&mut self, stamp: InputStamp) {
        if !self.observe {
            return;
        }
        let mut hasher = std::hash::DefaultHasher::new();
        stamp.hash(&mut hasher);
        let bucket = self.by_hash.entry(hasher.finish()).or_default();
        if bucket.iter().any(|index| {
            self.stamps
                .get(*index)
                .is_some_and(|existing| *existing == stamp)
        }) {
            return;
        }
        bucket.push(self.stamps.len());
        self.stamps.push(stamp);
    }

    pub(in crate::corsa_bridge::vue_dependencies_alias::context) fn record<T>(
        &mut self,
        packet: Consumed<T>,
        role: FactRole,
        path: &Path,
    ) -> T {
        if !self.observe {
            return packet.value;
        }
        if self.qualified && !packet.qualified {
            let reason = match role {
                FactRole::Configuration => 40,
                FactRole::AuthoredSource => 41,
                FactRole::LocalImporter => 42,
            };
            crate::corsa_bridge::preparation_trace::Phase::native_fact_guard(
                reason,
                packet.stamps.len(),
            );
        }
        self.qualified &= packet.qualified && path.is_absolute();
        let owner = Shared::new(FactOwner {
            path: path.to_path_buf(),
            role,
        });
        for stamp in packet.stamps {
            // The raw cache's metadata-only validator remains its original
            // responsibility. Native admission needs consumed operation facts.
            if stamp.is_consumed_only() {
                self.insert(if stamp.owner().is_some() {
                    stamp
                } else {
                    stamp.with_owner(Shared::clone(&owner))
                });
            } else if let Some(body) = stamp.retained_consumed_source() {
                self.insert(if body.owner().is_some() {
                    body
                } else {
                    body.with_owner(Shared::clone(&owner))
                });
            }
        }
        packet.value
    }

    /// Label the actual factory result before borrowed downstream operations.
    /// Preowned dynamic source/importer facts keep their original identities.
    pub(in crate::corsa_bridge::vue_dependencies_alias::context) fn factory<T>(
        &mut self,
        mut packet: Consumed<T>,
        role: FactRole,
        path: &Path,
    ) -> Consumed<T> {
        if self.observe {
            let owner = Shared::new(FactOwner {
                path: path.to_path_buf(),
                role,
            });
            for stamp in &mut packet.stamps {
                if stamp.owner().is_none() {
                    *stamp = stamp.clone().with_owner(Shared::clone(&owner));
                }
            }
            self.record_view(&packet, role, path);
        }
        packet
    }

    pub(in crate::corsa_bridge::vue_dependencies_alias::context) fn record_view<T>(
        &mut self,
        packet: &Consumed<T>,
        role: FactRole,
        path: &Path,
    ) {
        if !self.observe {
            return;
        }
        let stamps = packet.stamps.clone();
        self.record(
            Consumed {
                value: (),
                stamps,
                qualified: packet.qualified,
            },
            role,
            path,
        );
    }

    pub(in crate::corsa_bridge::vue_dependencies_alias::context) fn record_owned<T>(
        &mut self,
        packet: Consumed<T>,
    ) -> T {
        if !self.observe {
            return packet.value;
        }
        if self.qualified && !packet.qualified {
            crate::corsa_bridge::preparation_trace::Phase::native_fact_guard(
                44,
                packet.stamps.len(),
            );
        }
        self.qualified &= packet.qualified;
        for stamp in packet.stamps {
            let stamp = if stamp.is_consumed_only() {
                stamp
            } else if let Some(body) = stamp.retained_consumed_source() {
                body
            } else {
                // The original raw cache keeps its own metadata validator.
                continue;
            };
            if stamp.owner().is_none() || !stamp.path().is_absolute() {
                if self.qualified {
                    crate::corsa_bridge::preparation_trace::Phase::native_fact_guard(
                        45,
                        self.stamps.len(),
                    );
                }
                self.qualified = false;
            }
            self.insert(stamp);
        }
        packet.value
    }

    pub(in crate::corsa_bridge::vue_dependencies_alias::context) fn body(
        &mut self,
        path: &Path,
        body: &[u8],
    ) {
        if !self.observe {
            return;
        }
        if !path.is_absolute() {
            self.qualified = false;
        }
        self.insert(
            InputStamp::observed_source(path.to_path_buf(), body).with_owner(Shared::new(
                FactOwner {
                    path: path.to_path_buf(),
                    role: FactRole::AuthoredSource,
                },
            )),
        );
    }

    /// Facts owned by a truly retired importer/source cease to be inputs of
    /// the current graph. Configuration owners are never inferred retired.
    pub(in crate::corsa_bridge::vue_dependencies_alias::context) fn remove_retired_owners(
        &mut self,
        current: &FxHashSet<PathBuf>,
    ) {
        let previous = std::mem::take(&mut self.stamps);
        self.by_hash.clear();
        for stamp in previous {
            let retired = stamp.owner().is_some_and(|owner| {
                owner.role != FactRole::Configuration && !current.contains(&owner.path)
            });
            if !retired {
                self.insert(stamp);
            }
        }
    }

    pub(in crate::corsa_bridge::vue_dependencies_alias::context) fn is_qualified(&self) -> bool {
        self.qualified
    }

    /// A borrow of facts from actual completed operations; it cannot grant
    /// qualification independently of this accumulated owner packet.
    pub(in crate::corsa_bridge::vue_dependencies_alias::context) fn witness(&self) -> Consumed<()> {
        Consumed {
            value: (),
            stamps: self.stamps.clone(),
            qualified: self.qualified,
        }
    }

    pub(in crate::corsa_bridge::vue_dependencies_alias::context) fn finish<T>(
        self,
        value: T,
    ) -> Consumed<T> {
        Consumed {
            value,
            stamps: self.stamps,
            qualified: self.qualified,
        }
    }
}

#[cfg(test)]
mod tests;

mod retention;
