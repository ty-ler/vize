//! Original source regeneration with the complete authoritative overlay scope.
use crate::batch::virtual_project::VirtualProject;
use crate::corsa_bridge::vue_dependencies_alias::context::build::consumption::NativeFacts;
use std::path::{Path, PathBuf};
use vize_carton::{FxHashMap, FxHashSet, String};

pub(super) struct Replacement {
    pub(super) host: PathBuf,
    pub(super) known: FxHashSet<PathBuf>,
    pub(super) regenerated: FxHashSet<PathBuf>,
    pub(super) deleted: FxHashSet<PathBuf>,
    pub(super) frontier: Vec<PathBuf>,
    pub(super) supplied: FxHashMap<PathBuf, String>,
}

pub(super) fn replace(
    mirror: &mut VirtualProject,
    host: &Path,
    content: &str,
    overlays: &FxHashMap<PathBuf, &str>,
    requested: &[(PathBuf, &str)],
    disk_changes: &[PathBuf],
    facts: &mut NativeFacts,
) -> Option<Replacement> {
    let host = vize_carton::path::canonicalize_non_verbatim(host);
    mirror.find_by_original(&host)?;
    let known = mirror
        .registered_original_paths_sorted()
        .into_iter()
        .collect::<FxHashSet<_>>();
    let vue_sources = known
        .iter()
        .filter(|path| {
            mirror
                .find_by_original(path)
                .is_some_and(|file| file.source_map.sfc_map.is_some())
        })
        .cloned()
        .collect::<FxHashSet<_>>();
    let mut supplied = requested
        .iter()
        .map(|(path, text)| {
            (
                vize_carton::path::canonicalize_non_verbatim(path),
                String::from(*text),
            )
        })
        .collect::<FxHashMap<_, _>>();
    // Keep every authoritative overlay, including an open unrelated source
    // that can become newly reachable during this very walk.
    supplied.extend(
        overlays
            .iter()
            .map(|(path, text)| (path.clone(), String::from(*text))),
    );
    supplied.insert(host.clone(), String::from(content));
    let mut replacements = FxHashMap::<PathBuf, Option<String>>::default();
    let mut authored = FxHashSet::default();
    for path in known.iter().filter(|path| {
        vue_sources.contains(*path) || supplied.contains_key(*path) || disk_changes.contains(path)
    }) {
        let file = mirror.find_by_original(path)?;
        let previous = mirror.original_content_for_virtual(&file.virtual_path)?;
        let current = match supplied.get(path) {
            Some(source) => Some(source.clone()),
            None if path.is_file() => Some(String::from(std::fs::read_to_string(path).ok()?)),
            None => None,
        };
        if current.as_deref() != Some(previous) {
            authored.insert(path.clone());
        }
        if vue_sources.contains(path) || authored.contains(path) {
            replacements.insert(path.clone(), current);
        }
    }
    let changed = replacements.keys().cloned().collect::<FxHashSet<_>>();
    if !vue_sources.is_subset(&changed) {
        return None;
    }
    let mut frontier = mirror.dependency_owners_for_sources(&authored);
    let register = crate::corsa_bridge::preparation_trace::Phase::start(
        "alias_register_inputs",
        requested.len() + 1,
    );
    let mut ordered = replacements.into_iter().collect::<Vec<_>>();
    ordered.sort_by(|left, right| left.0.cmp(&right.0));
    let deleted = ordered
        .iter()
        .filter(|(_, body)| body.is_none())
        .map(|(path, _)| path.clone())
        .collect::<FxHashSet<_>>();
    let mut regenerated = FxHashSet::default();
    for (path, source) in ordered {
        if let Some(source) = source {
            facts.record_owned(
                mirror
                    .register_path_with_content_observed(&path, &source)
                    .ok()?,
            );
            regenerated.insert(path.clone());
            // Actual regenerated Vue module bytes can change imports as a
            // consequence of imported props, even when its own body is equal.
            frontier.push(path);
        } else {
            facts.record_owned(mirror.remove_source_and_dependencies_observed(&path));
        }
    }
    register.finish();
    if vue_sources
        .iter()
        .any(|path| !regenerated.contains(path) && !deleted.contains(path))
    {
        return None;
    }
    frontier.retain(|path| mirror.find_by_original(path).is_some());
    frontier.sort();
    frontier.dedup();
    Some(Replacement {
        host,
        known,
        regenerated,
        deleted,
        frontier,
        supplied,
    })
}

pub(super) fn supplied_are_current(
    mirror: &VirtualProject,
    supplied: &FxHashMap<PathBuf, String>,
) -> bool {
    supplied.iter().all(|(path, source)| {
        mirror.find_by_original(path).is_none_or(|file| {
            mirror.original_content_for_virtual(&file.virtual_path) == Some(source.as_str())
        })
    })
}
