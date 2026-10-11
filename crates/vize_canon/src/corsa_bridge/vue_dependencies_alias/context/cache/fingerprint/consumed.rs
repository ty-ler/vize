//! Strong native validation of facts retained from the original operations.

use crate::package_route::stamp::{Consumed, FactRole, InputStamp, SourceRevisionFact};
use std::path::{Path, PathBuf};
use vize_carton::{FxHashMap, FxHashSet};

/// These keys are the exact original source identities, already selected by
/// the caller. The guard never normalizes paths or substitutes generated text.
pub(super) struct AuthoredInputs<'a> {
    pub(super) host_path: &'a Path,
    pub(super) host_body: &'a [u8],
    pub(super) overlays: &'a FxHashMap<PathBuf, &'a str>,
    pub(super) requested: &'a [(PathBuf, &'a str)],
}

impl AuthoredInputs<'_> {
    fn body(&self, path: &Path) -> Option<&[u8]> {
        if path == self.host_path {
            return Some(self.host_body);
        }
        if let Some(body) = self.overlays.get(path) {
            return Some(body.as_bytes());
        }
        self.requested
            .iter()
            .rev()
            .find(|(source, _)| source == path)
            .map(|(_, body)| body.as_bytes())
    }
}

#[derive(Debug, PartialEq, Eq)]
pub(in crate::corsa_bridge::vue_dependencies_alias::context) struct SourceChanges {
    /// Deleted originals are also changed originals.
    pub(in crate::corsa_bridge::vue_dependencies_alias::context) changed: Vec<PathBuf>,
    pub(in crate::corsa_bridge::vue_dependencies_alias::context) deleted: Vec<PathBuf>,
    /// Actual preflight results only; an independent new resolver fact and
    /// final validation are required before any canonical record is retained.
    pub(in crate::corsa_bridge::vue_dependencies_alias::context) deleted_probes: Vec<InputStamp>,
}

#[derive(Debug, PartialEq, Eq)]
pub(super) enum Refusal {
    UnknownAuthority,
    ChangedFact(PathBuf),
}

/// This pre-patch result cannot authorize materialization. The caller must
/// retain its original settings, metadata, overlay and generation guards and
/// replace changed owners through their actual completed original operations.
pub(super) fn validate(
    stamps: &[InputStamp],
    qualified: bool,
    known: &FxHashSet<PathBuf>,
    inputs: &AuthoredInputs<'_>,
) -> Result<Consumed<SourceChanges>, Refusal> {
    if !qualified || !known.contains(inputs.host_path) {
        return Err(Refusal::UnknownAuthority);
    }
    // Legacy entries stay unobserved here and retain their original validator.
    let consumed: Vec<_> = stamps
        .iter()
        .filter(|stamp| stamp.is_consumed_only())
        .collect();
    for stamp in &consumed {
        let Some(owner) = stamp.owner() else {
            return Err(Refusal::UnknownAuthority);
        };
        match owner.role {
            FactRole::AuthoredSource => {
                if owner.path != stamp.path() || !known.contains(&owner.path) {
                    return Err(Refusal::UnknownAuthority);
                }
            }
            FactRole::LocalImporter if !known.contains(&owner.path) => {
                return Err(Refusal::UnknownAuthority);
            }
            _ => {}
        }
    }
    if known.iter().any(|source| {
        !consumed
            .iter()
            .any(|stamp| stamp.path() == source && stamp.is_authored_body_fact())
    }) {
        return Err(Refusal::UnknownAuthority);
    }
    let mut current = vec![None; consumed.len()];
    let mut changed = Vec::new();
    let mut deleted = Vec::new();
    let mut deleted_probes = Vec::new();
    // Bodies first: a probe cannot invent deletion from its boolean result.
    for (index, stamp) in consumed.iter().enumerate() {
        if !stamp.is_authored_body_fact() {
            continue;
        }
        let now = stamp
            .current_consumed_fact_with_source(inputs.body(stamp.path()))
            .ok_or_else(|| Refusal::ChangedFact(stamp.path().to_path_buf()))?;
        match stamp.source_revision_fact(&now, &[]) {
            SourceRevisionFact::Unchanged => {}
            SourceRevisionFact::AuthoredBody => changed.push(stamp.path().to_path_buf()),
            SourceRevisionFact::DeletedBody => {
                changed.push(stamp.path().to_path_buf());
                deleted.push(stamp.path().to_path_buf());
            }
            _ => return Err(Refusal::ChangedFact(stamp.path().to_path_buf())),
        }
        *current.get_mut(index).ok_or(Refusal::UnknownAuthority)? = Some(now);
    }
    changed.sort();
    changed.dedup();
    deleted.sort();
    deleted.dedup();
    for (index, stamp) in consumed.iter().enumerate() {
        if current
            .get(index)
            .ok_or(Refusal::UnknownAuthority)?
            .is_some()
        {
            continue;
        }
        let now = stamp
            .current_consumed_fact_with_source(None)
            .ok_or_else(|| Refusal::ChangedFact(stamp.path().to_path_buf()))?;
        if now.has_non_not_found_read_failure() {
            return Err(Refusal::ChangedFact(stamp.path().to_path_buf()));
        }
        match stamp.source_revision_fact(&now, &deleted) {
            SourceRevisionFact::Unchanged => {}
            SourceRevisionFact::DeletedProbe => deleted_probes.push(now.clone()),
            _ => return Err(Refusal::ChangedFact(stamp.path().to_path_buf())),
        }
        *current.get_mut(index).ok_or(Refusal::UnknownAuthority)? = Some(now);
    }
    let stamps = current
        .into_iter()
        .collect::<Option<Vec<_>>>()
        .ok_or(Refusal::UnknownAuthority)?;
    Ok(Consumed {
        value: SourceChanges {
            changed,
            deleted,
            deleted_probes,
        },
        stamps,
        qualified,
    })
}

/// Final admission uses the same strong validator after actual ownership
/// reconciliation. No pre-patch exception or later metadata capture can stand
/// in for current returned operation facts.
pub(in crate::corsa_bridge::vue_dependencies_alias::context) fn reconciled_are_current(
    packet: &Consumed<()>,
    known: &FxHashSet<PathBuf>,
    host: &Path,
    body: &[u8],
    overlays: &FxHashMap<PathBuf, &str>,
    requested: &[(PathBuf, &str)],
) -> bool {
    let inputs = AuthoredInputs {
        host_path: host,
        host_body: body,
        overlays,
        requested,
    };
    validate(&packet.stamps, packet.qualified, known, &inputs)
        .is_ok_and(|current| current.value.changed.is_empty() && current.value.deleted.is_empty())
}

#[cfg(test)]
mod tests;

#[cfg(test)]
pub(super) mod refusal_tests;
