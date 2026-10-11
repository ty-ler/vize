//! Authority retained by one original dependency walk.

use super::ObservedPackageResolver;

#[expect(clippy::disallowed_types, reason = "dependency API uses std String")]
pub(super) struct DependencyConsumption<'a> {
    pub(super) aliases: Option<
        crate::package_route::stamp::Consumed<Vec<(std::string::String, std::string::String)>>,
    >,
    pub(super) resolver: Option<ObservedPackageResolver<'a>>,
    pub(super) registered_roots: Option<
        &'a crate::package_route::stamp::Consumed<
            super::super::package_source_index::RegisteredPackageRoots,
        >,
    >,
}
