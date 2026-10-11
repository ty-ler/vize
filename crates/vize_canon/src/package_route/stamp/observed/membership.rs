//! Exact callback output membership, distinct from filesystem authority.

use super::{FactOwner, FactRole, InputFact};
use crate::{PackageRoute, package_route::stamp::InputStamp};
use std::{
    hash::{Hash, Hasher},
    path::{Path, PathBuf},
    sync::Arc,
};
use vize_carton::String;

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) enum PackageContribution {
    InputMember,
    RouteWrite {
        specifier: String,
        route: Arc<PackageRoute>,
    },
}

// Whole route Eq resolves collision buckets; public PackageRoute needs no Hash.
impl Hash for PackageContribution {
    fn hash<H: Hasher>(&self, state: &mut H) {
        match self {
            Self::InputMember => 0_u8.hash(state),
            Self::RouteWrite { specifier, .. } => {
                1_u8.hash(state);
                specifier.hash(state);
            }
        }
    }
}

#[derive(Debug, Eq, PartialEq)]
pub(crate) enum PackageContributionRef<'a> {
    Input(&'a Path),
    Route {
        directory: &'a Path,
        specifier: &'a String,
        route: &'a PackageRoute,
    },
}

impl InputStamp {
    /// Supplied original output data only: no existence/read/canonical probe.
    pub(crate) fn observed_package_input_member(path: PathBuf) -> Self {
        Self::observed_predicate(
            path,
            InputFact::PackageContribution(PackageContribution::InputMember),
        )
    }

    pub(crate) fn observed_editor_route_write(
        directory: PathBuf,
        specifier: String,
        route: Arc<PackageRoute>,
    ) -> Self {
        Self::observed_predicate(
            directory,
            InputFact::PackageContribution(PackageContribution::RouteWrite { specifier, route }),
        )
    }

    pub(crate) fn package_contribution(&self) -> Option<PackageContributionRef<'_>> {
        match self.fact.as_ref()? {
            InputFact::PackageContribution(PackageContribution::InputMember) => {
                Some(PackageContributionRef::Input(&self.path))
            }
            InputFact::PackageContribution(PackageContribution::RouteWrite {
                specifier,
                route,
            }) => Some(PackageContributionRef::Route {
                directory: &self.path,
                specifier,
                route,
            }),
            _ => None,
        }
    }
}

pub(crate) fn record_package_input_members(
    stamps: &mut Vec<InputStamp>,
    importer: &Path,
    inputs: &[PathBuf],
) {
    let owner = Arc::new(FactOwner {
        path: importer.to_path_buf(),
        role: FactRole::LocalImporter,
    });
    stamps.extend(inputs.iter().map(|path| {
        InputStamp::observed_package_input_member(path.clone()).with_owner(Arc::clone(&owner))
    }));
}

pub(crate) fn record_editor_route_write(
    stamps: &mut Vec<InputStamp>,
    importer: &Path,
    directory: PathBuf,
    specifier: String,
    route: &PackageRoute,
) {
    let owner = Arc::new(FactOwner {
        path: importer.to_path_buf(),
        role: FactRole::LocalImporter,
    });
    stamps.push(
        InputStamp::observed_editor_route_write(directory, specifier, Arc::new(route.clone()))
            .with_owner(owner),
    );
}

mod aggregate;
pub(crate) use aggregate::{
    PackageAggregateError, PackageAggregates, package_aggregates, package_aggregates_match_old,
};

#[cfg(test)]
mod tests;
