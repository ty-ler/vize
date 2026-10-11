//! Reconcile one exclusive graph through its original owner operations.
use crate::corsa_bridge::vue_dependencies_alias::context::cache::fingerprint::consumed::SourceChanges;
use crate::corsa_bridge::vue_dependencies_alias::{
    AliasContext, context::build::consumption::NativeFacts,
};
use crate::package_route::stamp::{InputStamp, package_aggregates, package_aggregates_match_old};
use std::path::{Path, PathBuf};
use vize_carton::{FxHashMap, FxHashSet};
mod inputs;
mod packages;

#[expect(
    clippy::too_many_arguments,
    reason = "same original input and owner scope"
)]
pub(super) fn apply_observed(
    context: &mut AliasContext,
    host: &Path,
    content: &str,
    overlays: &FxHashMap<PathBuf, &str>,
    requested: &[(PathBuf, &str)],
    changes: &SourceChanges,
    seeds: &[PathBuf],
    resolver: &mut crate::PackageRouteResolver,
    previous: (&[InputStamp], bool),
    facts: &mut NativeFacts,
) -> Option<()> {
    let mirror = context.mirror.as_mut()?;
    let original = mirror
        .registered_original_paths_sorted()
        .into_iter()
        .collect::<FxHashSet<_>>();
    // No package binding or directory-wide route is substituted for this
    // complete original callback-output join, including deleted old owners.
    let old_aggregate = package_aggregates_match_old(
        previous.0,
        previous.1,
        &original,
        &context.package_routes,
        &context.route_inputs,
    );
    #[cfg(test)]
    if let Err(error) = &old_aggregate {
        eprintln!("original patch old aggregate refusal: {error:?}");
    }
    old_aggregate.ok()?;
    let replacement = inputs::replace(
        mirror,
        host,
        content,
        overlays,
        requested,
        &changes.changed,
        facts,
    );
    #[cfg(test)]
    if replacement.is_none() {
        eprintln!("original patch input replacement refusal");
    }
    let replacement = replacement?;
    // Deletion was proved by the original authored-body validation. A later
    // directory/non-file race cannot invent an additional deletion exception.
    if replacement
        .deleted
        .iter()
        .any(|path| !changes.deleted.contains(path))
    {
        #[cfg(test)]
        eprintln!(
            "original patch deletion proof refusal: actual={:?}; validated={:?}",
            replacement.deleted, changes.deleted
        );
        return None;
    }
    let protected = seeds.iter().cloned().collect::<FxHashSet<_>>();
    if !replacement.deleted.is_disjoint(&protected) {
        #[cfg(test)]
        eprintln!("original patch protected deletion refusal");
        return None;
    }
    let completed = packages::reconcile(
        mirror,
        &replacement.frontier,
        overlays,
        &protected,
        resolver,
        (facts, &replacement.package_generation),
    );
    #[cfg(test)]
    if completed.is_none() {
        eprintln!("original patch package reconciliation refusal");
    }
    let mut completed = completed?;
    let current = mirror
        .registered_original_paths_sorted()
        .into_iter()
        .collect::<FxHashSet<_>>();
    if !protected.is_subset(&current)
        || !inputs::supplied_are_current(mirror, &replacement.supplied)
    {
        #[cfg(test)]
        eprintln!(
            "original patch supplied/root refusal: protected={protected:?}; current={current:?}"
        );
        return None;
    }
    let removed = replacement
        .known
        .difference(&current)
        .cloned()
        .collect::<Vec<_>>();
    // Truly absent importers release their old callback contributions; a
    // visited target or a failed registration never grants this authority.
    completed.extend(removed.iter().cloned());
    completed.sort();
    completed.dedup();
    let replaced = replacement.regenerated.into_iter().collect::<Vec<_>>();
    let routes = crate::corsa_bridge::preparation_trace::Phase::start("alias_package_routes", 1);
    let editors = facts.record_owned(mirror.finalize_package_routes_observed().ok()?);
    routes.finish();
    facts.retain_previous_with_completed_editor(
        previous.0,
        (&completed, &editors),
        &replaced,
        &removed,
        &changes.deleted,
        &changes.deleted_probes,
    );
    facts.remove_retired_owners(&current);
    // Final admission includes the actual later alias reload and shadow /
    // rewrite predicates. Earlier construction facts cannot replace them.
    let witness = facts.witness();
    let owned = mirror.registered_sources_have_root_ownership(&protected, &witness);
    let current_facts = owned
        && super::super::fingerprint::consumed::reconciled_are_current(
            &witness,
            &current,
            &replacement.host,
            content.as_bytes(),
            overlays,
            requested,
        );
    if !owned || !current_facts {
        #[cfg(test)]
        eprintln!(
            "original patch final witness refusal: owned={owned}; current_facts={current_facts}; qualified={}; current={current:?}; protected={protected:?}",
            witness.qualified
        );
        return None;
    }
    let aggregate = package_aggregates(&witness.stamps, witness.qualified, &current).ok()?;
    context.package_routes = aggregate.routes;
    context.route_inputs = aggregate.inputs;
    Some(())
}
