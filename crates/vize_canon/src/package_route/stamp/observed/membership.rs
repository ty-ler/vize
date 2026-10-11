//! Exact callback output membership, distinct from filesystem authority.

use super::{FactOwner, FactRole, InputFact};
use crate::package_route::stamp::Shared;
use crate::{PackageRoute, package_route::stamp::InputStamp};
use std::{
    hash::{Hash, Hasher},
    path::{Path, PathBuf},
};
use vize_carton::String;

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) enum PackageContribution {
    InputMember,
    RouteWrite {
        specifier: String,
        route: Shared<PackageRoute>,
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
        route: Shared<PackageRoute>,
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
    let owner = Shared::new(FactOwner {
        path: importer.to_path_buf(),
        role: FactRole::LocalImporter,
    });
    stamps.extend(inputs.iter().map(|path| {
        InputStamp::observed_package_input_member(path.clone()).with_owner(Shared::clone(&owner))
    }));
}

pub(crate) fn record_editor_route_write(
    stamps: &mut Vec<InputStamp>,
    importer: &Path,
    directory: PathBuf,
    specifier: String,
    route: &PackageRoute,
) {
    let owner = Shared::new(FactOwner {
        path: importer.to_path_buf(),
        role: FactRole::LocalImporter,
    });
    stamps.push(
        InputStamp::observed_editor_route_write(directory, specifier, Shared::new(route.clone()))
            .with_owner(owner),
    );
}

#[path = "membership/aggregate.rs"]
mod aggregate;
#[cfg(any(feature = "native", test))]
pub(crate) use aggregate::PackageAggregateError;
pub(crate) use aggregate::{package_aggregates, package_aggregates_match_old};

#[cfg(test)]
#[path = "membership/tests.rs"]
mod tests;
