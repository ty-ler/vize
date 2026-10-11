//! Pure coverage of the existing retained callback contribution vector.

use super::{FactRole, InputFact, InputStamp, PackageContributionRef, PathBuf};
use crate::PackageRoute;
use std::path::Path;
use vize_carton::{FxHashMap, FxHashSet, String};

type Routes = FxHashMap<(PathBuf, String), PackageRoute>;

#[derive(Debug, Eq, PartialEq)]
pub(crate) struct PackageAggregates {
    pub(crate) routes: Routes,
    pub(crate) inputs: Vec<PathBuf>,
}

struct PackageAggregateView<'a> {
    routes: FxHashMap<(&'a Path, &'a String), &'a PackageRoute>,
    inputs: Vec<&'a Path>,
}

#[derive(Debug, Eq, PartialEq)]
pub(crate) enum PackageAggregateError {
    Unqualified,
    NoSources,
    MissingSourceBody(PathBuf),
    MissingOwner(PathBuf),
    WrongOwnerRole(PathBuf),
    UnknownOwner(PathBuf),
    NonAbsolute(PathBuf),
    DirectoryMismatch(PathBuf),
    RouteConflict(PathBuf, String),
    OldInputs,
    OldRoutes,
}

/// Coverage does not validate current bodies/configuration/resolution. The
/// caller still requires those original guards and actual owner completion.
pub(crate) fn package_aggregates(
    stamps: &[InputStamp],
    qualified: bool,
    owners: &FxHashSet<PathBuf>,
) -> Result<PackageAggregates, PackageAggregateError> {
    validate_coverage(stamps, qualified, owners)?;
    let mut routes = FxHashMap::default();
    let mut inputs = Vec::new();
    for stamp in stamps {
        let Some(contribution) = checked_contribution(stamp, owners)? else {
            continue;
        };
        match contribution {
            PackageContributionRef::Input(path) => inputs.push(path.to_path_buf()),
            PackageContributionRef::Route {
                directory,
                specifier,
                route,
            } => {
                let key = (directory.to_path_buf(), specifier.clone());
                match routes.get(&key) {
                    Some(previous) if previous != route => {
                        return Err(PackageAggregateError::RouteConflict(key.0, key.1));
                    }
                    Some(_) => {}
                    None => {
                        routes.insert(key, route.clone());
                    }
                }
            }
        }
    }
    inputs.sort();
    inputs.dedup();
    Ok(PackageAggregates { routes, inputs })
}

fn package_aggregate_view<'a>(
    stamps: &'a [InputStamp],
    qualified: bool,
    owners: &FxHashSet<PathBuf>,
) -> Result<PackageAggregateView<'a>, PackageAggregateError> {
    validate_coverage(stamps, qualified, owners)?;
    let mut routes = FxHashMap::default();
    let mut inputs = Vec::new();
    for stamp in stamps {
        let Some(contribution) = checked_contribution(stamp, owners)? else {
            continue;
        };
        match contribution {
            PackageContributionRef::Input(path) => inputs.push(path),
            PackageContributionRef::Route {
                directory,
                specifier,
                route,
            } => {
                let key = (directory, specifier);
                match routes.get(&key) {
                    Some(previous) if *previous != route => {
                        return Err(PackageAggregateError::RouteConflict(
                            directory.to_path_buf(),
                            specifier.clone(),
                        ));
                    }
                    Some(_) => {}
                    None => {
                        routes.insert(key, route);
                    }
                }
            }
        }
    }
    inputs.sort();
    inputs.dedup();
    Ok(PackageAggregateView { routes, inputs })
}

fn validate_coverage(
    stamps: &[InputStamp],
    qualified: bool,
    owners: &FxHashSet<PathBuf>,
) -> Result<(), PackageAggregateError> {
    if !qualified {
        return Err(PackageAggregateError::Unqualified);
    }
    if owners.is_empty() {
        return Err(PackageAggregateError::NoSources);
    }
    // Temporary borrowed coverage only; no persistent owner index or new read.
    let covered = stamps
        .iter()
        .filter_map(|stamp| {
            (stamp.consumed_only
                && matches!(stamp.fact.as_ref(), Some(InputFact::ConsumedBody(_)))
                && stamp.owner().is_some_and(|owner| {
                    owner.role == FactRole::AuthoredSource && owner.path == stamp.path
                }))
            .then_some(stamp.path.as_path())
        })
        .collect::<FxHashSet<_>>();
    for path in owners {
        if !path.is_absolute() {
            return Err(PackageAggregateError::NonAbsolute(path.clone()));
        }
        if !covered.contains(&path.as_path()) {
            return Err(PackageAggregateError::MissingSourceBody(path.clone()));
        }
    }
    Ok(())
}

fn checked_contribution<'a>(
    stamp: &'a InputStamp,
    owners: &FxHashSet<PathBuf>,
) -> Result<Option<PackageContributionRef<'a>>, PackageAggregateError> {
    let Some(contribution) = stamp.package_contribution() else {
        return Ok(None);
    };
    let owner = stamp
        .owner()
        .ok_or_else(|| PackageAggregateError::MissingOwner(stamp.path.clone()))?;
    if owner.role != FactRole::LocalImporter {
        return Err(PackageAggregateError::WrongOwnerRole(owner.path.clone()));
    }
    if !owner.path.is_absolute() || !stamp.path.is_absolute() {
        return Err(PackageAggregateError::NonAbsolute(stamp.path.clone()));
    }
    if !owners.contains(&owner.path) {
        return Err(PackageAggregateError::UnknownOwner(owner.path.clone()));
    }
    if let PackageContributionRef::Route { directory, .. } = contribution
        && directory != owner.path.parent().unwrap_or(owner.path.as_path())
    {
        return Err(PackageAggregateError::DirectoryMismatch(owner.path.clone()));
    }
    Ok(Some(contribution))
}

/// Compare complete retained outputs without cloning their complete routes.
/// This view preserves the original coverage and error order; it grants no
/// configuration, body or resolver freshness beyond those separate guards.
pub(crate) fn verify_package_aggregates_match_old(
    stamps: &[InputStamp],
    qualified: bool,
    original_owners: &FxHashSet<PathBuf>,
    original_routes: &Routes,
    original_inputs: &[PathBuf],
) -> Result<(), PackageAggregateError> {
    let view = package_aggregate_view(stamps, qualified, original_owners)?;
    if !view
        .inputs
        .iter()
        .copied()
        .eq(original_inputs.iter().map(PathBuf::as_path))
    {
        return Err(PackageAggregateError::OldInputs);
    }
    if view.routes.len() != original_routes.len()
        || original_routes
            .iter()
            .any(|((directory, specifier), route)| {
                view.routes.get(&(directory.as_path(), specifier)) != Some(&route)
            })
    {
        return Err(PackageAggregateError::OldRoutes);
    }
    Ok(())
}

/// Join whole OLD output against ORIGINAL pre-patch owners, including strongly
/// validated deleted originals. Final current coverage calls package_aggregates
/// with the current registry only after actual edge/binding retirement.
#[cfg(test)]
pub(crate) fn package_aggregates_match_old(
    stamps: &[InputStamp],
    qualified: bool,
    original_owners: &FxHashSet<PathBuf>,
    original_routes: &Routes,
    original_inputs: &[PathBuf],
) -> Result<PackageAggregates, PackageAggregateError> {
    let aggregates = package_aggregates(stamps, qualified, original_owners)?;
    if aggregates.inputs != original_inputs {
        return Err(PackageAggregateError::OldInputs);
    }
    if aggregates.routes != *original_routes {
        return Err(PackageAggregateError::OldRoutes);
    }
    Ok(aggregates)
}
